import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';
import type { Socket } from 'socket.io-client';
import { File } from 'expo-file-system';

import apiClient, { retranslateMessage, processAudio, uploadMedia } from '../services/api';
import type { ChatMessage } from '../components/chat/MessageBubble';
import { useChatMessageCache } from '../contexts/ChatMessageCacheContext';
import {
  MAX_MEDIA_OUTBOX_RETRY_ATTEMPTS,
  type QueuedMediaJob,
  type QueuedMediaType,
  getMediaOutboxBackoffMs,
  getMediaOutboxErrorMessage,
  loadMediaOutbox,
  saveMediaOutbox,
  shouldRetryMediaOutboxError,
} from '../services/mediaOutbox';

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
  clientTempId?: string;
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

function shouldMarkTranslating(
  isOwnMessage: boolean,
  translations: HistoryMessage['translations'] | NewMessageEvent['translations'] | null | undefined,
  confidenceScore: number | null | undefined,
): boolean {
  if (isOwnMessage) return false;
  if (translations) return false;

  // A persisted confidence score means Phase 2 has completed, even when
  // there is no translation text (for example, inaudible audio).
  if (typeof confidenceScore === 'number') return false;

  return true;
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

interface SendMessageAck {
  id: string;
  rawContent: string;
}

function createClientTempId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function buildQueuedMediaJob(
  groupId: string,
  optimisticId: string,
  payload: ChatPayload,
): QueuedMediaJob {
  const nowIso = new Date().toISOString();

  if (payload.type === 'AUDIO') {
    return {
      id: createClientTempId(),
      groupId,
      optimisticId,
      mediaType: 'AUDIO',
      createdAt: nowIso,
      updatedAt: nowIso,
      attemptCount: 0,
      nextAttemptAt: Date.now(),
      audio: {
        localUri: payload.localUri ?? '',
        mimeType: payload.mimeType ?? 'audio/mp4',
        durationMs: payload.durationMs,
      },
    };
  }

  return {
    id: createClientTempId(),
    groupId,
    optimisticId,
    mediaType: payload.type as Exclude<QueuedMediaType, 'AUDIO'>,
    createdAt: nowIso,
    updatedAt: nowIso,
    attemptCount: 0,
    nextAttemptAt: Date.now(),
    file: {
      fileUri: payload.content,
      mimeType:
        payload.mimeType ??
        (payload.type === 'DOCUMENT' ? 'application/pdf' : 'image/jpeg'),
    },
  };
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
function historyToChatMessage(msg: HistoryMessage, currentUserId: string | null): ChatMessage {
  const isOwnMessage = currentUserId != null && msg.sender.id === currentUserId;

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
    isTranslating: shouldMarkTranslating(
      isOwnMessage,
      msg.translations,
      msg.confidenceScore,
    ),
    createdAt: msg.createdAt,
  };
}

function serverEventToChatMessage(evt: NewMessageEvent, currentUserId: string | null): ChatMessage {
  const isOwnMessage = currentUserId != null && evt.senderId === currentUserId;

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
    isTranslating: shouldMarkTranslating(
      isOwnMessage,
      evt.translations,
      evt.confidenceScore,
    ),
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
  const outboxJobsRef = useRef<QueuedMediaJob[]>([]);
  const outboxDrainInFlightRef = useRef(false);
  const outboxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { onNewMessageRef.current = onNewMessage; }, [onNewMessage]);

  const persistOutboxJobs = useCallback(
    async (jobs: QueuedMediaJob[]) => {
      outboxJobsRef.current = jobs;
      await saveMediaOutbox(groupId, jobs);
    },
    [groupId],
  );

  const scheduleOutboxDrain = useCallback((delayMs = 0) => {
    if (outboxTimerRef.current) {
      clearTimeout(outboxTimerRef.current);
    }

    outboxTimerRef.current = setTimeout(() => {
      outboxTimerRef.current = null;
      void drainOutboxRef.current();
    }, Math.max(0, delayMs));
  }, []);

  const removeOptimisticMessage = useCallback((optimisticId: string) => {
    optimisticIdsRef.current.delete(optimisticId);
    setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
  }, []);

  const reconcileOptimisticMessage = useCallback(
    (
      optimisticId: string,
      serverMessageId: string,
      serverRawContent: string,
      forceTranslating = false,
    ) => {
      optimisticIdsRef.current.delete(optimisticId);

      setMessages((prev) => {
        const byOptimistic = prev.findIndex((m) => m.id === optimisticId);
        const byServerId = prev.findIndex((m) => m.id === serverMessageId);
        const targetIndex = byOptimistic !== -1 ? byOptimistic : byServerId;
        if (targetIndex === -1) return prev;

        const next = [...prev];
        const current = next[targetIndex];
        next[targetIndex] = {
          ...current,
          id: serverMessageId,
          rawContent: serverRawContent || current.rawContent,
          isOptimistic: false,
          isTranslating: forceTranslating || current.isTranslating,
        };
        return next;
      });
    },
    [],
  );

  const emitSendMessageWithAck = useCallback(
    (
      payload: Record<string, unknown>,
      timeoutMs = 12_000,
    ): Promise<SendMessageAck> => {
      if (!socket) {
        return Promise.reject(new Error('Socket is not connected'));
      }

      return new Promise<SendMessageAck>((resolve, reject) => {
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('sendMessage ack timed out'));
        }, timeoutMs);

        socket.emit('sendMessage', payload, (ack: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          if (!ack || typeof ack !== 'object') {
            reject(new Error('Invalid sendMessage acknowledgement'));
            return;
          }

          const parsed = ack as Record<string, unknown>;
          if (typeof parsed.id !== 'string' || !parsed.id.trim()) {
            reject(new Error('Missing message id in acknowledgement'));
            return;
          }

          resolve({
            id: parsed.id.trim(),
            rawContent:
              typeof parsed.rawContent === 'string' ? parsed.rawContent : '',
          });
        });
      });
    },
    [socket],
  );

  const sendQueuedMediaJob = useCallback(
    async (
      job: QueuedMediaJob,
    ): Promise<{ messageId: string; rawContent: string; forceTranslating: boolean }> => {
      if (job.mediaType === 'AUDIO') {
        const localUri = job.audio?.localUri;
        if (!localUri) {
          throw new Error('Queued audio is missing localUri');
        }

        const audioFile = new File(localUri);
        const base64 = await audioFile.base64();
        if (!base64 || base64.length < 10) {
          throw new Error('Queued audio file is empty or unavailable');
        }

        const result = await processAudio(
          groupId,
          base64,
          job.audio?.mimeType ?? 'audio/mp4',
          job.audio?.durationMs,
          job.optimisticId,
        );

        return {
          messageId: result.messageId,
          rawContent: result.rawContent,
          forceTranslating: true,
        };
      }

      const fileUri = job.file?.fileUri;
      if (!fileUri) {
        throw new Error('Queued media is missing fileUri');
      }

      const mimeType =
        job.file?.mimeType ??
        (job.mediaType === 'DOCUMENT' ? 'application/pdf' : 'image/jpeg');

      const uploaded = await uploadMedia(fileUri, mimeType);
      const ack = await emitSendMessageWithAck({
        groupId,
        clientTempId: job.optimisticId,
        contentType: job.mediaType,
        fileUrl: uploaded.url,
        ...(job.mediaType === 'DOCUMENT' ? { fileMimeType: mimeType } : {}),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      return {
        messageId: ack.id,
        rawContent: ack.rawContent || uploaded.url,
        forceTranslating: false,
      };
    },
    [emitSendMessageWithAck, groupId],
  );

  const drainOutboxRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const cached = getChatCache(groupId);
    if (!cached) return;

    setMessages(cached.messages);
    setHasMore(cached.hasMore);
    hasMoreRef.current = cached.hasMore;
    oldestCursorRef.current = cached.oldestCursor;
    setIsLoadingHistory(false);
  }, [groupId, getChatCache, userId]);

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

  const drainMediaOutbox = useCallback(async () => {
    if (outboxDrainInFlightRef.current) return;
    if (!userId) return;

    const existingJobs = outboxJobsRef.current;
    if (existingJobs.length === 0) return;

    outboxDrainInFlightRef.current = true;

    try {
      let jobs = [...existingJobs];

      while (jobs.length > 0) {
        const now = Date.now();
        const job = jobs[0];

        if (!socket && job.mediaType !== 'AUDIO') {
          scheduleOutboxDrain(2_000);
          break;
        }

        if (job.nextAttemptAt > now) {
          scheduleOutboxDrain(job.nextAttemptAt - now);
          break;
        }

        try {
          const sent = await sendQueuedMediaJob(job);
          jobs = jobs.slice(1);
          await persistOutboxJobs(jobs);

          reconcileOptimisticMessage(
            job.optimisticId,
            sent.messageId,
            sent.rawContent,
            sent.forceTranslating,
          );
        } catch (error) {
          const attemptCount = job.attemptCount + 1;
          const retryable = shouldRetryMediaOutboxError(error);

          if (!retryable || attemptCount > MAX_MEDIA_OUTBOX_RETRY_ATTEMPTS) {
            jobs = jobs.slice(1);
            await persistOutboxJobs(jobs);
            removeOptimisticMessage(job.optimisticId);

            Alert.alert(
              'Send Failed',
              getMediaOutboxErrorMessage(error),
            );
            continue;
          }

          const nextDelayMs = getMediaOutboxBackoffMs(attemptCount);
          const updatedJob: QueuedMediaJob = {
            ...job,
            attemptCount,
            updatedAt: new Date().toISOString(),
            nextAttemptAt: Date.now() + nextDelayMs,
            lastError: getMediaOutboxErrorMessage(error),
          };

          jobs = [updatedJob, ...jobs.slice(1)];
          await persistOutboxJobs(jobs);
          scheduleOutboxDrain(nextDelayMs);
          break;
        }
      }
    } finally {
      outboxDrainInFlightRef.current = false;
    }
  }, [
    persistOutboxJobs,
    reconcileOptimisticMessage,
    removeOptimisticMessage,
    scheduleOutboxDrain,
    sendQueuedMediaJob,
    socket,
    userId,
  ]);

  useEffect(() => {
    drainOutboxRef.current = drainMediaOutbox;
  }, [drainMediaOutbox]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const jobs = await loadMediaOutbox(groupId);
      if (cancelled) return;

      outboxJobsRef.current = jobs;
      if (jobs.length === 0) return;

      // Restore pending optimistic media messages after app restarts.
      setMessages((prev) => {
        const existingIds = new Set(prev.map((message) => message.id));
        const restored: ChatMessage[] = [];

        for (const job of jobs) {
          if (existingIds.has(job.optimisticId)) continue;

          if (job.mediaType === 'AUDIO') {
            if (!job.audio?.localUri) continue;
            optimisticIdsRef.current.add(job.optimisticId);
            restored.push({
              id: job.optimisticId,
              senderId: userId ?? '',
              contentType: 'AUDIO',
              rawContent: JSON.stringify({
                url: job.audio.localUri,
                durationMs: job.audio.durationMs ?? 0,
              }),
              translations: null,
              confidenceScore: null,
              isOptimistic: true,
              createdAt: job.createdAt,
            });
            continue;
          }

          const fileUri = job.file?.fileUri;
          if (!fileUri) continue;

          optimisticIdsRef.current.add(job.optimisticId);

          restored.push({
            id: job.optimisticId,
            senderId: userId ?? '',
            contentType: job.mediaType,
            rawContent: fileUri,
            translations: null,
            confidenceScore: null,
            isOptimistic: true,
            createdAt: job.createdAt,
          });
        }

        if (restored.length === 0) return prev;
        return mergeMessagesById(prev, restored);
      });

      if (isConnected && socket && userId) {
        void drainOutboxRef.current();
      } else {
        const nextDue = jobs[0]?.nextAttemptAt ?? Date.now();
        scheduleOutboxDrain(Math.max(0, nextDue - Date.now()));
      }
    })();

    return () => {
      cancelled = true;
      if (outboxTimerRef.current != null) {
        clearTimeout(outboxTimerRef.current);
        outboxTimerRef.current = null;
      }
    };
  }, [groupId, isConnected, scheduleOutboxDrain, socket, userId]);

  useEffect(() => {
    if (!isConnected || !socket || !userId) return;
    if (outboxJobsRef.current.length === 0) return;
    void drainOutboxRef.current();
  }, [isConnected, socket, userId]);

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
          const mapped = data.map((msg) => historyToChatMessage(msg, userId)).reverse();
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
  }, [groupId, getChatCache, userId]);

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
        const older = data.map((msg) => historyToChatMessage(msg, userId)).reverse();
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
  }, [groupId, userId]);

  // ── 3. Join room & listen for server broadcasts ───────────────────────────
  useEffect(() => {
    if (!socket || !isConnected) return;

    socket.emit('joinRoom', { groupId });

    // ── newMessage (Phase 1 — raw message, possibly without translations) ──
    const handleNewMessage = (evt: NewMessageEvent) => {
      const finalMessage = serverEventToChatMessage(evt, userId);

      enqueueMessagesPatch((ctx) => {
        // If the sender is the current user, reconcile the optimistic entry
        if (evt.senderId === userId) {
          const idx =
            typeof evt.clientTempId === 'string' && evt.clientTempId.trim()
              ? ctx.messages.findIndex((m) => m.id === evt.clientTempId)
              : ctx.messages.findIndex(
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
            .map((msg) => historyToChatMessage(msg, userId))
            .filter((m) => !existingIds.has(m.id));
          // Missed messages come from a DESC fetch, newest first — append them at end
          return missed.length > 0 ? [...prev, ...missed.reverse()] : prev;
        });
      } catch {
        // Silent — reconnect catch-up is best-effort
      }
    })();
  }, [isConnected, isLoadingHistory, groupId, userId]);

  // ── 5. Sending logic ──────────────────────────────────────────────────────
  const handleSendMessage = useCallback(
    async (payload: ChatPayload) => {
      if (!userId) return;

      const optimisticId = createClientTempId();
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
        if (payload.type === 'TEXT') {
          if (!socket) {
            throw new Error('Chat connection is unavailable');
          }

          const ack = await emitSendMessageWithAck({
            groupId,
            clientTempId: optimisticId,
            contentType: 'TEXT',
            rawContent: payload.content,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });

          reconcileOptimisticMessage(
            optimisticId,
            ack.id,
            ack.rawContent || payload.content,
          );
          return;
        }

        if (payload.type === 'AUDIO' && !payload.localUri) {
          throw new Error('Audio recording path is missing');
        }

        const mediaJob = buildQueuedMediaJob(groupId, optimisticId, payload);
        const nextJobs = [...outboxJobsRef.current, mediaJob];
        await persistOutboxJobs(nextJobs);
        scheduleOutboxDrain(0);
      } catch (error) {
        console.error('[useChatMessages] Failed to send message:', error);

        removeOptimisticMessage(optimisticId);

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
    [
      emitSendMessageWithAck,
      groupId,
      persistOutboxJobs,
      reconcileOptimisticMessage,
      removeOptimisticMessage,
      scheduleOutboxDrain,
      socket,
      userId,
    ],
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
