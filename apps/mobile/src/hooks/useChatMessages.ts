import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';
import type { Socket } from 'socket.io-client';

import apiClient, { retranslateMessage, processAudio, uploadMedia } from '../services/api';
import type { ChatMessage } from '../components/chat/MessageBubble';
import { useChatMessageCache } from '../contexts/ChatMessageCacheContext';

// ── Payload type coming from ChatInput ───────────────────────────────────────
export interface ChatPayload {
  type: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  content: string;
  mimeType?: string;
  /** Local file URI for AUDIO — allows the optimistic message to play back
   *  the recording from the device before the server URL is available. */
  localUri?: string;
  durationMs?: number;
}

// ── Shape broadcasted by the server via "newMessage" ─────────────────────────
interface NewMessageEvent {
  messageId: string;
  senderId: string;
  contentType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  fileUrl?: string;
  transcription?: string | null;
  originalText?: string | null;
  translations?: {
    english: string;
    singlish: string;
    tanglish: string;
  } | null;
  detectedLanguage?: 'english' | 'singlish' | 'tanglish' | 'mixed' | 'unknown' | null;
  originalTone?: string | null;
  translatedAudioUrls?: {
    english?: string;
    singlish?: string;
    tanglish?: string;
  } | null;
  confidenceScore?: number | null;
  extractedActions?: {
    type: 'MEETING' | 'REMINDER';
    title: string;
    timestamp: string;
    description?: string;
  }[] | null;
}

// ── Shape broadcasted by the server via "messageTranslated" ──────────────────
interface MessageTranslatedEvent {
  messageId: string;
  transcription?: string | null;
  translations: {
    english: string;
    singlish: string;
    tanglish: string;
  } | null;
  detectedLanguage?: 'english' | 'singlish' | 'tanglish' | 'mixed' | 'unknown' | null;
  originalTone?: string | null;
  translatedAudioUrls?: {
    english?: string;
    singlish?: string;
    tanglish?: string;
  } | null;
  confidenceScore: number | null;
  extractedActions?: {
    type: 'MEETING' | 'REMINDER';
    title: string;
    timestamp: string;
    description?: string;
  }[] | null;
}

// ── Shape broadcasted by the server via "translationFailed" ──────────────────
interface TranslationFailedEvent {
  messageId: string;
}

// ── History item shape returned by GET /chat/groups/:id/messages ─────────────
interface HistoryMessage {
  id: string;
  sender: { id: string };
  contentType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  rawContent: string;
  transcription?: string | null;
  translations?: {
    english: string;
    singlish: string;
    tanglish: string;
  } | null;
  detectedLanguage?: 'english' | 'singlish' | 'tanglish' | 'mixed' | 'unknown' | null;
  originalTone?: string | null;
  translatedAudioUrls?: {
    english?: string;
    singlish?: string;
    tanglish?: string;
  } | null;
  confidenceScore?: number | null;
  extractedActions?: {
    type: 'MEETING' | 'REMINDER';
    title: string;
    timestamp: string;
    description?: string;
  }[] | null;
  isEdited?: boolean;
  createdAt: string;
}

// ── Server → Client broadcast for message deletion ────────────────────────────
interface MessagesDeletedEvent {
  messageIds: string[];
  deletedBy: string;
}

interface MessagesHiddenEvent {
  messageIds: string[];
  hiddenBy: string;
}

// ── Server → Client broadcast for message edit ────────────────────────────────
interface MessageEditedEvent {
  messageId: string;
  newContent: string;
  translations: { english: string; singlish: string; tanglish: string } | null;
  detectedLanguage?: 'english' | 'singlish' | 'tanglish' | 'mixed' | 'unknown' | null;
  originalTone?: string | null;
  translatedAudioUrls?: {
    english?: string;
    singlish?: string;
    tanglish?: string;
  } | null;
  confidenceScore: number | null;
  isEdited: boolean;
}

// ── Server → Client error for failed edit ─────────────────────────────────────
interface EditFailedEvent {
  messageId: string;
  reason: string;
}

// ── Server → Client error for failed delete ───────────────────────────────────
interface DeleteFailedEvent {
  reason: string;
}

interface HideFailedEvent {
  reason: string;
}

const PAGE_SIZE = 30;

function showRetryStartedFeedback(): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show('Retry started. AI is translating again.', ToastAndroid.SHORT);
    return;
  }

  Alert.alert('Retry Started', 'AI is translating this message again.');
}

interface MessagePatchContext {
  messages: ChatMessage[];
  indexById: Map<string, number>;
  changed: boolean;
}

type MessagePatch = (ctx: MessagePatchContext) => void;

function buildMessageIndex(messages: ChatMessage[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < messages.length; i += 1) {
    map.set(messages[i].id, i);
  }
  return map;
}

function updateMessageById(
  ctx: MessagePatchContext,
  messageId: string,
  updater: (current: ChatMessage) => ChatMessage,
): void {
  const index = ctx.indexById.get(messageId);
  if (index == null) return;

  const current = ctx.messages[index];
  const next = updater(current);
  if (next === current) return;

  ctx.messages[index] = next;
  ctx.changed = true;
}

// ── Mappers ──────────────────────────────────────────────────────────────────
function historyToChatMessage(msg: HistoryMessage): ChatMessage {
  return {
    id: msg.id,
    senderId: msg.sender.id,
    contentType: msg.contentType,
    rawContent: msg.rawContent,
    translations: msg.translations ?? null,
    detectedLanguage: msg.detectedLanguage ?? null,
    originalTone: msg.originalTone ?? null,
    translatedAudioUrls: msg.translatedAudioUrls ?? null,
    confidenceScore: msg.confidenceScore ?? null,
    extractedActions: msg.extractedActions ?? null,
    isOptimistic: false,
    isEdited: msg.isEdited ?? false,
    // If the message has no translations yet, it's still being translated
    isTranslating: !msg.translations,
    createdAt: msg.createdAt,
  };
}

function serverEventToChatMessage(evt: NewMessageEvent): ChatMessage {
  return {
    id: evt.messageId,
    senderId: evt.senderId,
    contentType: evt.contentType,
    rawContent: evt.fileUrl ?? evt.originalText ?? '',
    translations: evt.translations ?? null,
    detectedLanguage: evt.detectedLanguage ?? null,
    originalTone: evt.originalTone ?? null,
    translatedAudioUrls: evt.translatedAudioUrls ?? null,
    confidenceScore: evt.confidenceScore ?? null,
    extractedActions: evt.extractedActions ?? null,
    isOptimistic: false,
    isEdited: false,
    // Phase 1 messages arrive with translations: null — show AI translating indicator
    isTranslating: !evt.translations,
    createdAt: new Date().toISOString(),
  };
}

function mergeMessagesById(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  if (incoming.length === 0) return existing;

  const merged = [...existing];
  const indexById = buildMessageIndex(merged);

  for (const message of incoming) {
    const existingIndex = indexById.get(message.id);
    if (existingIndex == null) {
      merged.push(message);
      indexById.set(message.id, merged.length - 1);
      continue;
    }
    merged[existingIndex] = message;
  }

  merged.sort((a, b) => {
    const aTime = new Date(a.createdAt ?? 0).getTime();
    const bTime = new Date(b.createdAt ?? 0).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });

  return merged;
}

// ── Hook params ──────────────────────────────────────────────────────────────
interface UseChatMessagesParams {
  groupId: string;
  userId: string | null;
  socket: Socket | null;
  isConnected: boolean;
  /** Ref for rollback on edit-fail — owned by useChatEdit but read here */
  editOriginalRef: React.MutableRefObject<{
    id: string;
    rawContent: string;
    translations: ChatMessage['translations'];
    confidenceScore: number | null;
  } | null>;
  /** Called after a message is appended (new incoming or own optimistic send) */
  onNewMessage?: () => void;
}

export interface UseChatMessagesReturn {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isLoadingHistory: boolean;
  isFetchingOlder: boolean;
  hasMore: boolean;
  loadOlderMessages: () => Promise<void>;
  handleSendMessage: (payload: ChatPayload) => Promise<void>;
  handleRetry: (messageId: string) => Promise<void>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useChatMessages({
  groupId,
  userId,
  socket,
  isConnected,
  editOriginalRef,
  onNewMessage,
}: UseChatMessagesParams): UseChatMessagesReturn {
  const { getChatCache, upsertChatCache } = useChatMessageCache();
  const initialCacheRef = useRef(getChatCache(groupId));

  /**
   * Messages are stored in ASCENDING order — index 0 = oldest message.
   * FlashList renders them top-to-bottom with `startRenderingFromBottom` so
   * the newest messages appear at the visual bottom (standard chat layout).
   * Older messages are prepended to the front when the user scrolls up.
   */
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialCacheRef.current?.messages ?? [],
  );
  const [isLoadingHistory, setIsLoadingHistory] = useState(
    () => !initialCacheRef.current,
  );
  const [isFetchingOlder, setIsFetchingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(
    () => initialCacheRef.current?.hasMore ?? true,
  );
  const queuedPatchesRef = useRef<MessagePatch[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track optimistic IDs for reconciliation
  const optimisticIdsRef   = useRef<Set<string>>(new Set());
  const isFetchingRef      = useRef(false);  // prevent concurrent loadOlderMessages calls
  const hasMoreRef         = useRef(initialCacheRef.current?.hasMore ?? true);
  const oldestCursorRef    = useRef<string | null>(initialCacheRef.current?.oldestCursor ?? null); // createdAt of oldest loaded msg
  const onNewMessageRef    = useRef<(() => void) | undefined>(onNewMessage);
  useEffect(() => { onNewMessageRef.current = onNewMessage; }, [onNewMessage]);

  useEffect(() => {
    const cached = getChatCache(groupId);
    if (!cached) return;

    setMessages(cached.messages);
    setHasMore(cached.hasMore);
    hasMoreRef.current = cached.hasMore;
    oldestCursorRef.current = cached.oldestCursor;
    setIsLoadingHistory(false);
  }, [groupId, getChatCache]);

  const flushQueuedPatches = useCallback(() => {
    flushTimerRef.current = null;
    const patches = queuedPatchesRef.current;
    if (patches.length === 0) return;
    queuedPatchesRef.current = [];

    setMessages((prev) => {
      const ctx: MessagePatchContext = {
        messages: [...prev],
        indexById: buildMessageIndex(prev),
        changed: false,
      };
      for (const patch of patches) {
        patch(ctx);
      }
      return ctx.changed ? ctx.messages : prev;
    });
  }, []);

  const enqueueMessagesPatch = useCallback((patch: MessagePatch) => {
    queuedPatchesRef.current.push(patch);
    if (flushTimerRef.current != null) return;

    // Coalesce frequent socket events into one state commit per frame.
    flushTimerRef.current = setTimeout(flushQueuedPatches, 16);
  }, [flushQueuedPatches]);

  useEffect(() => {
    upsertChatCache(groupId, {
      messages,
      hasMore,
      oldestCursor: oldestCursorRef.current,
    });
  }, [groupId, messages, hasMore, upsertChatCache]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
      }
      queuedPatchesRef.current = [];
    };
  }, []);

  // ── 1. Fetch most-recent PAGE_SIZE messages on mount ─────────────────────
  useEffect(() => {
    let cancelled = false;
    const cached = getChatCache(groupId);

    if (!cached) {
      setMessages([]);
      setIsLoadingHistory(true);
      setHasMore(true);
      hasMoreRef.current = true;
      oldestCursorRef.current = null;
    }

    (async () => {
      try {
        // Server returns DESC order (newest first) when no cursor is provided
        const { data } = await apiClient.get<HistoryMessage[]>(
          `/chat/groups/${groupId}/messages?limit=${PAGE_SIZE}`,
        );

        if (!cancelled) {
          // Server returns DESC (newest first); reverse to ASC for list display
          const mapped = data.map(historyToChatMessage).reverse();
          setMessages((prev) => (cached ? mergeMessagesById(prev, mapped) : mapped));

          if (mapped.length > 0) {
            // Oldest message is now at index 0 — use it as the cursor for loading more
            oldestCursorRef.current = mapped[0].createdAt ?? null;
          }

          const more = data.length === PAGE_SIZE;
          setHasMore(more);
          hasMoreRef.current = more;
        }
      } catch (error) {
        console.error('[useChatMessages] Failed to fetch history:', error);
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groupId, getChatCache]);

  // ── 2. Load older messages (cursor-based infinite scroll) ─────────────────
  const loadOlderMessages = useCallback(async () => {
    if (isFetchingRef.current || !hasMoreRef.current || !oldestCursorRef.current) return;

    isFetchingRef.current = true;
    setIsFetchingOlder(true);

    try {
      const { data } = await apiClient.get<HistoryMessage[]>(
        `/chat/groups/${groupId}/messages?before=${encodeURIComponent(oldestCursorRef.current)}&limit=${PAGE_SIZE}`,
      );

      if (data.length > 0) {
        // Server returns DESC (newest first); reverse to ASC before prepending
        const older = data.map(historyToChatMessage).reverse();
        setMessages((prev) => [...older, ...prev]); // prepend — older items above current

        // Cursor advances to the oldest message in this batch (first after reverse = ASC)
        oldestCursorRef.current = older[0].createdAt ?? null;

        if (data.length < PAGE_SIZE) {
          setHasMore(false);
          hasMoreRef.current = false;
        }
      } else {
        setHasMore(false);
        hasMoreRef.current = false;
      }
    } catch (err) {
      console.error('[useChatMessages] Failed to load older messages:', err);
    } finally {
      isFetchingRef.current = false;
      setIsFetchingOlder(false);
    }
  }, [groupId]);

  // ── 3. Join room & listen for server broadcasts ───────────────────────────
  useEffect(() => {
    if (!socket || !isConnected) return;

    socket.emit('joinRoom', { groupId });

    // ── newMessage (Phase 1 — raw message, possibly without translations) ──
    const handleNewMessage = (evt: NewMessageEvent) => {
      const finalMessage = serverEventToChatMessage(evt);

      enqueueMessagesPatch((ctx) => {
        // If the sender is the current user, reconcile the optimistic entry
        if (evt.senderId === userId) {
          const idx = ctx.messages.findIndex(
            (m) => m.isOptimistic && m.senderId === userId,
          );

          if (idx !== -1) {
            const optimisticId = ctx.messages[idx].id;
            optimisticIdsRef.current.delete(optimisticId);
            ctx.messages[idx] = finalMessage;
            ctx.indexById.delete(optimisticId);
            ctx.indexById.set(finalMessage.id, idx);
            ctx.changed = true;
            return;
          }
        }

        // Otherwise it's from someone else — append at end (ASC order)
        const existingIndex = ctx.indexById.get(finalMessage.id);
        if (existingIndex != null) {
          ctx.messages[existingIndex] = finalMessage;
          ctx.changed = true;
          return;
        }

        ctx.messages.push(finalMessage);
        ctx.indexById.set(finalMessage.id, ctx.messages.length - 1);
        ctx.changed = true;
      });

      // Notify screen so it can scroll to bottom if the user is already there
      if (evt.senderId !== userId) {
        onNewMessageRef.current?.();
      }
    };

    socket.on('newMessage', handleNewMessage);

    // ── messageTranslated (Phase 2 — translations arrived) ──────────────
    const handleMessageTranslated = (evt: MessageTranslatedEvent) => {
      enqueueMessagesPatch((ctx) => updateMessageById(ctx, evt.messageId, (m) => ({
        ...m,
        translations: evt.translations,
        detectedLanguage: evt.detectedLanguage ?? m.detectedLanguage,
        originalTone: evt.originalTone ?? m.originalTone,
        translatedAudioUrls: evt.translatedAudioUrls ?? m.translatedAudioUrls,
        confidenceScore: evt.confidenceScore,
        extractedActions: evt.extractedActions ?? m.extractedActions,
        isTranslating: false,
        isRetrying: false,
      })));
    };

    socket.on('messageTranslated', handleMessageTranslated);

    // ── translationFailed — show retry button ───────────────────────────
    const handleTranslationFailed = (evt: TranslationFailedEvent) => {
      enqueueMessagesPatch((ctx) => updateMessageById(ctx, evt.messageId, (m) => ({
        ...m,
        isTranslating: false,
        isRetrying: false,
      })));
    };

    socket.on('translationFailed', handleTranslationFailed);

    // ── messageFailed ───────────────────────────────────────────────────
    const handleMessageFailed = (evt: { reason?: string }) => {
      enqueueMessagesPatch((ctx) => {
        const idx = ctx.messages.findIndex((m) => m.isOptimistic && m.senderId === userId);
        if (idx === -1) return;

        const optimisticId = ctx.messages[idx].id;
        optimisticIdsRef.current.delete(optimisticId);
        ctx.messages.splice(idx, 1);
        ctx.indexById = buildMessageIndex(ctx.messages);
        ctx.changed = true;
      });
      Alert.alert(
        'Send Failed',
        evt?.reason ?? 'Your message could not be sent. Please try again.',
      );
    };

    socket.on('messageFailed', handleMessageFailed);

    // ── Delete events ───────────────────────────────────────────────────
    const handleMessagesDeleted = (evt: MessagesDeletedEvent) => {
      const ids = new Set(evt.messageIds);
      enqueueMessagesPatch((ctx) => {
        const next = ctx.messages.filter((m) => !ids.has(m.id));
        if (next.length === ctx.messages.length) return;
        ctx.messages = next;
        ctx.indexById = buildMessageIndex(next);
        ctx.changed = true;
      });
    };

    socket.on('messagesDeleted', handleMessagesDeleted);

    const handleMessagesHidden = (evt: MessagesHiddenEvent) => {
      const ids = new Set(evt.messageIds);
      enqueueMessagesPatch((ctx) => {
        const next = ctx.messages.filter((m) => !ids.has(m.id));
        if (next.length === ctx.messages.length) return;
        ctx.messages = next;
        ctx.indexById = buildMessageIndex(next);
        ctx.changed = true;
      });
    };

    socket.on('messagesHidden', handleMessagesHidden);

    const handleDeleteFailed = (evt: DeleteFailedEvent) => {
      Alert.alert('Delete Failed', evt?.reason ?? 'Could not delete the message(s). Please try again.');
    };

    socket.on('deleteFailed', handleDeleteFailed);

    const handleHideFailed = (evt: HideFailedEvent) => {
      Alert.alert('Hide Failed', evt?.reason ?? 'Could not hide the message(s). Please try again.');
    };

    socket.on('hideFailed', handleHideFailed);

    // ── Edit events ─────────────────────────────────────────────────────
    const handleMessageEdited = (evt: MessageEditedEvent) => {
      if (editOriginalRef.current?.id === evt.messageId) {
        editOriginalRef.current = null;
      }
      enqueueMessagesPatch((ctx) => updateMessageById(ctx, evt.messageId, (m) => ({
        ...m,
        rawContent: evt.newContent,
        translations: evt.translations,
        detectedLanguage: evt.detectedLanguage ?? m.detectedLanguage,
        originalTone: evt.originalTone ?? m.originalTone,
        translatedAudioUrls: evt.translatedAudioUrls ?? m.translatedAudioUrls,
        confidenceScore: evt.confidenceScore,
        isEdited: true,
        isRetrying: false,
        isTranslating: false,
      })));
    };

    socket.on('messageEdited', handleMessageEdited);

    const handleEditFailed = (evt: EditFailedEvent) => {
      if (editOriginalRef.current && editOriginalRef.current.id === evt.messageId) {
        const snapshot = editOriginalRef.current;
        enqueueMessagesPatch((ctx) => updateMessageById(ctx, snapshot.id, (m) => ({
          ...m,
          rawContent: snapshot.rawContent,
          translations: snapshot.translations,
          confidenceScore: snapshot.confidenceScore,
          isRetrying: false,
          isTranslating: false,
        })));
        editOriginalRef.current = null;
      }
      Alert.alert('Edit Failed', evt?.reason ?? 'Could not edit the message. Please try again.');
    };

    socket.on('editFailed', handleEditFailed);

    return () => {
      // Keep server-side room membership aligned with this hook lifecycle.
      // This runs on chat unmount and groupId changes.
      socket.emit('leaveRoom', { groupId });

      socket.off('newMessage', handleNewMessage);
      socket.off('messageTranslated', handleMessageTranslated);
      socket.off('translationFailed', handleTranslationFailed);
      socket.off('messageFailed', handleMessageFailed);
      socket.off('messagesDeleted', handleMessagesDeleted);
      socket.off('messagesHidden', handleMessagesHidden);
      socket.off('deleteFailed', handleDeleteFailed);
      socket.off('hideFailed', handleHideFailed);
      socket.off('messageEdited', handleMessageEdited);
      socket.off('editFailed', handleEditFailed);
    };
  }, [socket, isConnected, userId, groupId, editOriginalRef, enqueueMessagesPatch]);

  // ── 4. Reconnect catch-up: re-fetch latest page and merge missed messages ─
  const prevConnectedRef = useRef(false);
  useEffect(() => {
    const justReconnected = isConnected && !prevConnectedRef.current;
    prevConnectedRef.current = isConnected;

    if (!justReconnected || isLoadingHistory) return;

    (async () => {
      try {
        const { data } = await apiClient.get<HistoryMessage[]>(
          `/chat/groups/${groupId}/messages?limit=${PAGE_SIZE}`,
        );
        if (data.length === 0) return;

        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const missed = data
            .map(historyToChatMessage)
            .filter((m) => !existingIds.has(m.id));
          // Missed messages come from a DESC fetch, newest first — append them at end
          return missed.length > 0 ? [...prev, ...missed.reverse()] : prev;
        });
      } catch {
        // Silent — reconnect catch-up is best-effort
      }
    })();
  }, [isConnected, isLoadingHistory, groupId]);

  // ── 5. Sending logic ──────────────────────────────────────────────────────
  const handleSendMessage = useCallback(
    async (payload: ChatPayload) => {
      if (!socket || !userId) return;

      const optimisticId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
        /[xy]/g,
        (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        },
      );
      const optimisticMessage: ChatMessage = {
        id: optimisticId,
        senderId: userId,
        contentType: payload.type,
        rawContent: payload.type === 'AUDIO'
          ? JSON.stringify({ url: payload.localUri ?? '', durationMs: payload.durationMs ?? 0 })
          : payload.content,
        translations: null,
        confidenceScore: null,
        isOptimistic: true,
        createdAt: new Date().toISOString(),
      };

      optimisticIdsRef.current.add(optimisticId);
      // Optimistic message is the newest — append at end (ASC order)
      setMessages((prev) => [...prev, optimisticMessage]);
      onNewMessageRef.current?.();

      try {
        if (payload.type === 'IMAGE') {
          const formData = new FormData();
          const fileName = payload.content.split('/').pop() ?? 'image.jpg';

          formData.append('file', {
            uri: payload.content,
            name: fileName,
            type: payload.mimeType ?? 'image/jpeg',
          } as unknown as Blob);

          const { data } = await apiClient.post<{ url: string }>(
            '/media/upload',
            formData,
            { headers: { 'Content-Type': 'multipart/form-data' } },
          );

          socket.emit('sendMessage', {
            groupId,
            contentType: 'IMAGE',
            fileUrl: data.url,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
        } else if (payload.type === 'AUDIO') {
          // Audio is processed via the dedicated REST endpoint.
          // Phase 1 returns immediately — Phase 2 translates asynchronously.
          await processAudio(
            groupId,
            payload.content,
            payload.mimeType ?? 'audio/mp4',
            payload.durationMs,
          );
        } else if (payload.type === 'DOCUMENT') {
          const { url } = await uploadMedia(
            payload.content,
            payload.mimeType ?? 'application/pdf',
          );

          socket.emit('sendMessage', {
            groupId,
            contentType: 'DOCUMENT',
            fileUrl: url,
            fileMimeType: payload.mimeType ?? 'application/pdf',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
        } else {
          socket.emit('sendMessage', {
            groupId,
            contentType: 'TEXT',
            rawContent: payload.content,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
        }
      } catch (error) {
        console.error('[useChatMessages] Failed to send message:', error);

        optimisticIdsRef.current.delete(optimisticId);
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));

        const serverReason = (error as any)?.response?.data?.reason;
        if (serverReason === 'audioNotAudible') {
          Alert.alert(
            'Let us try that again',
            'We could not hear a clear voice in that clip. Try speaking a little louder or move to a quieter spot.',
          );
          return;
        }
        Alert.alert(
          'Send Failed',
          (error as any)?.response?.data?.message ?? 'Your message could not be sent. Please try again.',
        );
      }
    },
    [socket, userId, groupId],
  );

  // ── 6. Retry translation handler ──────────────────────────────────────────
  const handleRetry = useCallback(
    async (messageId: string) => {
      enqueueMessagesPatch((ctx) => updateMessageById(ctx, messageId, (m) => ({
        ...m,
        isRetrying: true,
        translations: null,
      })));
      showRetryStartedFeedback();
      try {
        const result = await retranslateMessage(messageId);
        enqueueMessagesPatch((ctx) => updateMessageById(ctx, messageId, (m) => ({
          ...m,
          isRetrying: false,
          isTranslating: false,
          translations: result.translations,
          detectedLanguage: result.detectedLanguage ?? m.detectedLanguage,
          originalTone: result.originalTone ?? m.originalTone,
          translatedAudioUrls: result.translatedAudioUrls ?? m.translatedAudioUrls,
          confidenceScore: result.confidenceScore,
        })));
      } catch (err) {
        console.error('[useChatMessages] Retranslation failed:', err);
        enqueueMessagesPatch((ctx) => updateMessageById(ctx, messageId, (m) => ({
          ...m,
          isRetrying: false,
        })));
        const responseMessage = (err as any)?.response?.data?.message;
        const responseReason = (err as any)?.response?.data?.reason;
        Alert.alert(
          'Retry Failed',
          responseMessage ?? responseReason ?? 'Translation retry failed. Please try again.',
        );
      }
    },
    [enqueueMessagesPatch],
  );

  return {
    messages,
    setMessages,
    isLoadingHistory,
    isFetchingOlder,
    hasMore,
    loadOlderMessages,
    handleSendMessage,
    handleRetry,
  };
}
