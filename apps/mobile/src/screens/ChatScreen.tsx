import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import apiClient, { retranslateMessage, setLanguagePreference, processAudio, uploadMedia } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNotification } from '../contexts/NotificationContext';
import { ChatListProvider } from '../contexts/ChatListContext';
import ChatInput from '../components/chat/ChatInput';
import EditMessageBar from '../components/chat/EditMessageBar';
import MessageBubble, { type ChatMessage } from '../components/chat/MessageBubble';
import DocumentInterrogationModal from '../components/chat/DocumentInterrogationModal';
import ChatSearchModal from '../components/chat/ChatSearchModal';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'Chat'>;

// ── Supported language options ───────────────────────────────────────────────
const LANGUAGE_OPTIONS = [
  { key: 'english', label: 'English', icon: '🇬🇧' },
  { key: 'singlish', label: 'Singlish', icon: '🇱🇰' },
  { key: 'tanglish', label: 'Tanglish', icon: '🇮🇳' },
] as const;

type PreferredLanguage = typeof LANGUAGE_OPTIONS[number]['key'];

// ── Payload type coming from ChatInput ───────────────────────────────────────
interface ChatPayload {
  type: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  content: string;
  mimeType?: string;
  /** Local file URI for AUDIO — allows the optimistic message to play back
   *  the recording from the device before the server URL is available. */
  localUri?: string;
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
  confidenceScore?: number | null;
  extractedActions?: {
    type: 'MEETING' | 'REMINDER';
    title: string;
    timestamp: string;
    description?: string;
  }[] | null;
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

// ── Server → Client broadcast for message edit ────────────────────────────────
interface MessageEditedEvent {
  messageId: string;
  newContent: string;
  translations: { english: string; singlish: string; tanglish: string } | null;
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

// ── Mappers ──────────────────────────────────────────────────────────────────
function historyToChatMessage(msg: HistoryMessage): ChatMessage {
  return {
    id: msg.id,
    senderId: msg.sender.id,
    contentType: msg.contentType,
    rawContent: msg.rawContent,
    translations: msg.translations ?? null,
    confidenceScore: msg.confidenceScore ?? null,
    extractedActions: msg.extractedActions ?? null,
    isOptimistic: false,
    isEdited: msg.isEdited ?? false,
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
    confidenceScore: evt.confidenceScore ?? null,
    extractedActions: evt.extractedActions ?? null,
    isOptimistic: false,
    isEdited: false,
    createdAt: new Date().toISOString(),
  };
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ChatScreen({ navigation, route }: Props) {
  const { groupId, groupName, isDm, preferredLanguage: initialLang, otherUserPicture } = route.params;
  const { userId, userDialect } = useAuth();
  const { socket, isConnected } = useSocket();
  const { colors } = useTheme();
  const { setActiveGroupId } = useNotification();
  const insets = useSafeAreaInsets();

  // ── Suppress notifications for this chat while it's on screen ───────────
  useEffect(() => {
    setActiveGroupId(groupId);
    return () => setActiveGroupId(null);
  }, [groupId, setActiveGroupId]);

  // Per-conversation language preference (falls back to user's native dialect)
  const [preferredLanguage, setPreferredLanguageState] = useState<PreferredLanguage>(
    (initialLang as PreferredLanguage) ?? (userDialect as PreferredLanguage) ?? 'english',
  );
  const [isLanguagePickerOpen, setIsLanguagePickerOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  // ── Selection state ─────────────────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Header cross-fade animation ─────────────────────────────────────────
  // Both header rows are always mounted and cross-faded via opacity so that
  // they never compete for space in the flex layout during a transition.
  // (Using Reanimated entering/exiting placed both flex:1 views side-by-side
  // during the ~200 ms overlap, halving the available width and clipping the
  // delete button at the right edge of the selection row.)
  const selHeaderOpacity = useSharedValue(0);
  const normHeaderOpacity = useSharedValue(1);

  useEffect(() => {
    selHeaderOpacity.value = withTiming(selectionMode ? 1 : 0, { duration: 200 });
    normHeaderOpacity.value = withTiming(selectionMode ? 0 : 1, { duration: 200 });
  }, [selectionMode, selHeaderOpacity, normHeaderOpacity]);

  const selHeaderAnimStyle = useAnimatedStyle(() => ({ opacity: selHeaderOpacity.value }));
  const normHeaderAnimStyle = useAnimatedStyle(() => ({ opacity: normHeaderOpacity.value }));

  // ── Edit state  ─────────────────────────────────────────────────────────
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  /** The original rawContent of the message being edited (for optimistic rollback) */
  const editOriginalRef = useRef<{ id: string; rawContent: string; translations: ChatMessage['translations']; confidenceScore: number | null } | null>(null);

  // ── Document Interrogation state ────────────────────────────────────────
  const [docModal, setDocModal] = useState<{
    visible: boolean;
    messageId: string;
    fileUrl: string;
    initialPage?: number;
  }>({ visible: false, messageId: '', fileUrl: '' });

  // ── Search state ───────────────────────────────────────────────────────
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  const handleOpenDocumentInterrogation = useCallback(
    (messageId: string, fileUrl: string, initialPage?: number) => {
      setDocModal({ visible: true, messageId, fileUrl, initialPage });
    },
    [],
  );

  const handleCloseDocumentInterrogation = useCallback(() => {
    setDocModal((prev) => ({ ...prev, visible: false }));
  }, []);

  // ── Go-to-message handler (from search) ─────────────────────────────────
  /**
   * Scrolls the FlatList to the message matching the given ID and briefly
   * highlights it. If the message is not currently loaded (deep history),
   * we fetch more history pages until we find it, then scroll.
   */
  const handleGoToMessage = useCallback(
    async (messageId: string) => {
      // First check if message is already in the loaded list
      const idx = messages.findIndex((m) => m.id === messageId);

      if (idx !== -1) {
        // Message is loaded — scroll and highlight
        flatListRef.current?.scrollToIndex({
          index: idx,
          animated: true,
          viewPosition: 0.4, // centre-ish
        });

        // Flash highlight
        setHighlightedMessageId(messageId);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          setHighlightedMessageId(null);
        }, 2500);
        return;
      }

      // Message not loaded yet — fetch pages until we find it
      let currentPage = Math.ceil(messages.length / 50) + 1;
      let found = false;
      let allMessages = [...messages];

      for (let attempt = 0; attempt < 10 && !found; attempt++) {
        try {
          const { data } = await apiClient.get<HistoryMessage[]>(
            `/chat/groups/${groupId}/messages?page=${currentPage}&limit=50`,
          );

          if (data.length === 0) break; // no more history

          const mapped = data.map(historyToChatMessage);
          allMessages = [...allMessages, ...mapped];

          if (mapped.some((m) => m.id === messageId)) {
            found = true;
          }

          currentPage++;
        } catch {
          break;
        }
      }

      if (found) {
        setMessages(allMessages);

        // Wait for FlatList to re-render, then scroll
        setTimeout(() => {
          const newIdx = allMessages.findIndex((m) => m.id === messageId);
          if (newIdx !== -1) {
            flatListRef.current?.scrollToIndex({
              index: newIdx,
              animated: true,
              viewPosition: 0.4,
            });
          }

          setHighlightedMessageId(messageId);
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          highlightTimerRef.current = setTimeout(() => {
            setHighlightedMessageId(null);
          }, 2500);
        }, 300);
      }
    },
    [messages, groupId],
  );

  // Track optimistic IDs for reconciliation
  const optimisticIdsRef = useRef<Set<string>>(new Set());

  // ── 1. Fetch history on mount ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await apiClient.get<HistoryMessage[]>(
          `/chat/groups/${groupId}/messages?limit=50`,
        );

        if (!cancelled) {
          setMessages(data.map(historyToChatMessage));
        }
      } catch (error) {
        console.error('[ChatScreen] Failed to fetch history:', error);
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
}, [groupId]);

  // ── 2. Hardware back button exits selection/edit mode ──────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editingMessageId) {
        setEditingMessageId(null);
        editOriginalRef.current = null;
        return true;
      }
      if (selectionMode) {
        setSelectionMode(false);
        setSelectedIds(new Set());
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [selectionMode, editingMessageId]);

  // ── 3. Join room & listen for server broadcasts ─────────────────────────
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Join the room for this chat
    socket.emit('joinRoom', { groupId });

    const handleNewMessage = (evt: NewMessageEvent) => {
      const finalMessage = serverEventToChatMessage(evt);

      setMessages((prev) => {
        // If the sender is the current user, reconcile the optimistic entry
        if (evt.senderId === userId) {
          const idx = prev.findIndex(
            (m) => m.isOptimistic && m.senderId === userId,
          );

          if (idx !== -1) {
            optimisticIdsRef.current.delete(prev[idx].id);
            const next = [...prev];
            next[idx] = finalMessage;
            return next;
          }
        }

        // Otherwise it's from someone else — prepend (FlatList is inverted)
        return [finalMessage, ...prev];
      });
    };

    socket.on('newMessage', handleNewMessage);

    const handleMessageFailed = (evt: { reason?: string }) => {
      // Remove the most recent optimistic message from this user on failure
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.isOptimistic && m.senderId === userId);
        if (idx === -1) return prev;
        optimisticIdsRef.current.delete(prev[idx].id);
        const next = [...prev];
        next.splice(idx, 1);
        return next;
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
      setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    };

    socket.on('messagesDeleted', handleMessagesDeleted);

    const handleDeleteFailed = (evt: DeleteFailedEvent) => {
      Alert.alert('Delete Failed', evt?.reason ?? 'Could not delete the message(s). Please try again.');
    };

    socket.on('deleteFailed', handleDeleteFailed);

    // ── Edit events ─────────────────────────────────────────────────────
    const handleMessageEdited = (evt: MessageEditedEvent) => {
      // Clear rollback snapshot — edit confirmed by server
      if (editOriginalRef.current?.id === evt.messageId) {
        editOriginalRef.current = null;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === evt.messageId
            ? {
                ...m,
                rawContent: evt.newContent,
                translations: evt.translations,
                confidenceScore: evt.confidenceScore,
                isEdited: true,
                isRetrying: false,
              }
            : m,
        ),
      );
    };

    socket.on('messageEdited', handleMessageEdited);

    const handleEditFailed = (evt: EditFailedEvent) => {
      // Roll back the optimistic update
      if (editOriginalRef.current && editOriginalRef.current.id === evt.messageId) {
        const snapshot = editOriginalRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === snapshot.id
              ? {
                  ...m,
                  rawContent: snapshot.rawContent,
                  translations: snapshot.translations,
                  confidenceScore: snapshot.confidenceScore,
                  isRetrying: false,
                }
              : m,
          ),
        );
        editOriginalRef.current = null;
      }
      Alert.alert('Edit Failed', evt?.reason ?? 'Could not edit the message. Please try again.');
    };

    socket.on('editFailed', handleEditFailed);

    return () => {
      socket.off('newMessage', handleNewMessage);
      socket.off('messageFailed', handleMessageFailed);
      socket.off('messagesDeleted', handleMessagesDeleted);
      socket.off('deleteFailed', handleDeleteFailed);
      socket.off('messageEdited', handleMessageEdited);
      socket.off('editFailed', handleEditFailed);
    };
  }, [socket, isConnected, userId, groupId]);

  // ── 4. Sending logic ───────────────────────────────────────────────────
  const handleSendMessage = useCallback(
    async (payload: ChatPayload) => {
      if (!socket || !userId) return;

      // Create an optimistic message and push it immediately
      // crypto.randomUUID() is not available in React Native's JS engine
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
        // For AUDIO, payload.content is a large base64 string which the native
        // audio player cannot use as a URI. Use the local file URI instead so
        // the optimistic bubble can immediately play back the recording from
        // the device while the server processes and returns the hosted URL.
        rawContent: payload.type === 'AUDIO'
          ? (payload.localUri ?? '')
          : payload.content,
        translations: null,
        confidenceScore: null,
        isOptimistic: true,
        createdAt: new Date().toISOString(),
      };

      optimisticIdsRef.current.add(optimisticId);
      setMessages((prev) => [optimisticMessage, ...prev]);

      try {
        if (payload.type === 'IMAGE') {
          // Upload the file via REST first, then emit over the socket
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
          });
        } else if (payload.type === 'AUDIO') {
          // Audio is processed via the dedicated REST endpoint.
          // The server saves the file, checks audibility, runs transcription,
          // persists the message, and then broadcasts 'newMessage' to the room —
          // which reconciles the optimistic bubble on this client exactly as before.
          await processAudio(
            groupId,
            payload.content,
            payload.mimeType ?? 'audio/mp4',
          );
        } else if (payload.type === 'DOCUMENT') {
          // Upload the document via REST, then emit over the socket
          const { url } = await uploadMedia(
            payload.content,
            payload.mimeType ?? 'application/pdf',
          );

          socket.emit('sendMessage', {
            groupId,
            contentType: 'DOCUMENT',
            fileUrl: url,
            fileMimeType: payload.mimeType ?? 'application/pdf',
          });
        } else {
          // TEXT
          socket.emit('sendMessage', {
            groupId,
            contentType: 'TEXT',
            rawContent: payload.content,
          });
        }
      } catch (error) {
        console.error('[ChatScreen] Failed to send message:', error);

        // Roll back the failed optimistic message
        optimisticIdsRef.current.delete(optimisticId);
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));

        // Provide a specific message for inaudible audio (HTTP 422) so the user
        // knows to re-record rather than retry with the same clip.
        const serverReason = (error as any)?.response?.data?.reason;
        if (serverReason === 'audioNotAudible') {
          Alert.alert(
            'Audio Not Audible',
            "Your recording wasn't clear enough to process.\nPlease try again in a quieter environment or speak louder.",
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

  // ── 4. Language preference handler ───────────────────────────────────────
  const handleSelectLanguage = useCallback(
    async (lang: PreferredLanguage) => {
      setIsLanguagePickerOpen(false);
      setPreferredLanguageState(lang);
      try {
        await setLanguagePreference(groupId, lang);
      } catch (err) {
        console.error('[ChatScreen] Failed to save language preference:', err);
      }
    },
    [groupId],
  );
  // ── 5. Retry translation handler ─────────────────────────────────────────
  const handleRetry = useCallback(
    async (messageId: string) => {
      // Optimistically show mediating state
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isRetrying: true, translations: null } : m)),
      );
      try {
        const result = await retranslateMessage(messageId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, isRetrying: false, translations: result.translations, confidenceScore: result.confidenceScore }
              : m,
          ),
        );
      } catch (err) {
        console.error('[ChatScreen] Retranslation failed:', err);
        // Revert retrying state (keep old translations if any)
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isRetrying: false } : m)),
        );
      }
    },
    [],
  );

  // ── 6. Selection handlers ────────────────────────────────────────────────
  const handleLongPress = useCallback((messageId: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([messageId]));
    setMessages((prev) =>
      prev.map((m) => {
        const shouldSelect = m.id === messageId;
        // Only create a new object when the selection state actually changes
        if (m.isSelected === shouldSelect) return m;
        return { ...m, isSelected: shouldSelect };
      }),
    );
  }, []);

  const handleToggleSelect = useCallback((messageId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      // Only create a new object for the toggled message
      setMessages((msgs) =>
        msgs.map((m) =>
          m.id === messageId ? { ...m, isSelected: next.has(messageId) } : m,
        ),
      );
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    // Only create new objects for messages that were actually selected
    setMessages((prev) =>
      prev.map((m) => (m.isSelected ? { ...m, isSelected: false } : m)),
    );
  }, []);

  // ── 7. Delete handler ────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    if (!socket || selectedIds.size === 0) return;

    const count = selectedIds.size;
    Alert.alert(
      'Delete Message' + (count > 1 ? 's' : ''),
      `Delete ${count === 1 ? 'this message' : `these ${count} messages`}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const ids = [...selectedIds];
            // Optimistically remove from local state
            setMessages((prev) => prev.filter((m) => !selectedIds.has(m.id)));
            exitSelectionMode();
            socket.emit('deleteMessages', { groupId, messageIds: ids });
          },
        },
      ],
    );
  }, [socket, selectedIds, groupId, exitSelectionMode]);

  // ── 8. Edit handlers ─────────────────────────────────────────────────────
  const handleStartEdit = useCallback(() => {
    if (selectedIds.size !== 1) return;
    const [messageId] = [...selectedIds];
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;

    // Store snapshot for potential rollback
    editOriginalRef.current = {
      id: msg.id,
      rawContent: msg.rawContent,
      translations: msg.translations,
      confidenceScore: msg.confidenceScore ?? null,
    };

    setEditingMessageId(messageId);
    exitSelectionMode();
  }, [selectedIds, messages, exitSelectionMode]);

  const handleCancelEdit = useCallback(() => {
    // No optimistic update to roll back — we haven't emitted yet at this point
    setEditingMessageId(null);
    editOriginalRef.current = null;
  }, []);

  const handleConfirmEdit = useCallback(
    (newText: string) => {
      if (!socket || !editingMessageId) return;

      const msg = messages.find((m) => m.id === editingMessageId);
      if (!msg) return;

      // Validation
      const trimmed = newText.trim();
      if (trimmed.length === 0) {
        Alert.alert('Empty message', 'Please enter some text before saving.');
        return;
      }
      if (trimmed === msg.rawContent.trim()) {
        // No change — just cancel
        handleCancelEdit();
        return;
      }

      // Optimistically update: clear translations, show "AI mediating…"
      setMessages((prev) =>
        prev.map((m) =>
          m.id === editingMessageId
            ? { ...m, rawContent: trimmed, translations: null, confidenceScore: null, isRetrying: true, isEdited: true }
            : m,
        ),
      );

      setEditingMessageId(null);
      // editOriginalRef.current remains set so editFailed can still roll back.
      // It gets cleared either on editFailed or on the next handleStartEdit.

      socket.emit('editMessage', {
        groupId,
        messageId: editingMessageId,
        newContent: trimmed,
      });
    },
    [socket, editingMessageId, messages, groupId, handleCancelEdit],
  );
  // ── 9. Render helpers ───────────────────────────────────────────────────
  // selectionMode and highlightedMessageId are provided via ChatListContext
  // so that toggling them does NOT recreate renderItem and re-render every cell.
  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      return (
        <MessageBubble
          message={item}
          currentUserId={userId ?? ''}
          preferredLanguage={preferredLanguage}
          onRetry={handleRetry}
          onLongPress={handleLongPress}
          onPress={handleToggleSelect}
          onOpenDocumentInterrogation={handleOpenDocumentInterrogation}
        />
      );
    },
    [userId, preferredLanguage, handleRetry, handleLongPress, handleToggleSelect, handleOpenDocumentInterrogation],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.headerBg }]}>
        {/*
          Both header rows are always in the DOM (never mount/unmount during
          transitions). They are absolutely positioned inside a fixed-height
          container so they overlay each other and cross-fade, instead of
          sitting side-by-side and halving the available width while both are
          visible during an animation overlap.
        */}
        <View style={styles.headerInner}>
          {/* ── Selection action bar ───────────────────────────────────── */}
          <Animated.View
            pointerEvents={selectionMode ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, styles.selectionHeaderRow, selHeaderAnimStyle]}
          >
            {/* Close / deselect all */}
            <Pressable onPress={exitSelectionMode} hitSlop={12} style={styles.selHeaderClose}>
              <Ionicons name="close" size={24} color={colors.headerText} />
            </Pressable>

            {/* Selected count */}
            <Text style={[styles.selHeaderCount, { color: colors.headerText }]}>
              {selectedIds.size} selected
            </Text>

            {/* Spacer */}
            <View style={{ flex: 1 }} />

            {/* ✏️ Edit — only when 1 own TEXT message selected & within 15 min */}
            {(() => {
              if (selectedIds.size !== 1) return null;
              const [mid] = [...selectedIds];
              const msg = messages.find((m) => m.id === mid);
              if (!msg) return null;
              if (msg.senderId !== userId) return null;
              if (msg.contentType !== 'TEXT') return null;
              if (msg.isOptimistic) return null;
              // Check 15-minute window client-side (server also validates)
              if (msg.createdAt) {
                const age = Date.now() - new Date(msg.createdAt).getTime();
                if (age > 15 * 60 * 1000) return null;
              }
              return (
                <Pressable onPress={handleStartEdit} hitSlop={12} style={styles.selHeaderAction}>
                  <Ionicons name="pencil" size={22} color={colors.headerText} />
                </Pressable>
              );
            })()}

            {/* 🗑️ Delete — only own non-optimistic messages, at least 1 selected */}
            {(() => {
              const ids = [...selectedIds];
              // Guard: nothing selected (vacuous truth would otherwise show button)
              if (ids.length === 0) return null;
              const allOwn = ids.every((id) => {
                const msg = messages.find((m) => m.id === id);
                return msg?.senderId === userId && !msg?.isOptimistic;
              });
              if (!allOwn) return null;
              return (
                <Pressable onPress={handleDelete} hitSlop={12} style={styles.selHeaderAction}>
                  <Ionicons name="trash-outline" size={22} color={colors.destructiveLight} />
                </Pressable>
              );
            })()}
          </Animated.View>

          {/* ── Normal header ─────────────────────────────────────────── */}
          <Animated.View
            pointerEvents={selectionMode ? 'none' : 'auto'}
            style={[StyleSheet.absoluteFill, styles.normalHeaderRow, normHeaderAnimStyle]}
          >
            <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
              <Ionicons name="arrow-back" size={24} color={colors.headerText} />
            </Pressable>
            {/* Avatar */}
            {isDm && otherUserPicture ? (
              <Image source={{ uri: otherUserPicture }} style={styles.headerAvatar} />
            ) : (
              <View style={[styles.headerAvatar, { backgroundColor: colors.headerAvatarBg }]}>
                {isDm ? (
                  <Text style={[styles.headerAvatarText, { color: colors.headerText }]}>
                    {groupName.trim().split(/\s+/).slice(0, 2).map((p: string) => p[0]).join('').toUpperCase()}
                  </Text>
                ) : (
                  <Ionicons name="people" size={20} color={colors.headerText} />
                )}
              </View>
            )}
            <Text style={[styles.headerTitle, { color: colors.headerText }]} numberOfLines={1}>
              {groupName}
            </Text>
            {/* Language picker toggle */}
            <Pressable
              onPress={() => setIsLanguagePickerOpen(true)}
              style={styles.langBtn}
              hitSlop={8}
            >
              <Ionicons name="language" size={20} color={colors.headerTextSecondary} />
            </Pressable>
            {/* Search toggle */}
            <Pressable
              onPress={() => setIsSearchOpen(true)}
              style={styles.langBtn}
              hitSlop={8}
            >
              <Ionicons name="search" size={20} color={colors.headerTextSecondary} />
            </Pressable>
            <View
              style={[styles.dot, isConnected ? { backgroundColor: colors.dotOnline } : { backgroundColor: colors.dotOffline }]}
            />
          </Animated.View>
        </View>
      </View>

      {/* Language picker modal */}
      <Modal
        visible={isLanguagePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsLanguagePickerOpen(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlayBg }]}
          onPress={() => setIsLanguagePickerOpen(false)}
        >
          <View style={[styles.langPicker, { backgroundColor: colors.langPickerBg }]}>
            <Text style={[styles.langPickerTitle, { color: colors.langPickerTitleColor, borderBottomColor: colors.langPickerBorder }]}>Chat Language</Text>
            {LANGUAGE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => handleSelectLanguage(opt.key)}
                style={[styles.langOption, preferredLanguage === opt.key && { backgroundColor: colors.langOptionActiveBg }]}
              >
                <Text style={styles.langOptionIcon}>{opt.icon}</Text>
                <Text style={[styles.langOptionText, { color: colors.langOptionText }, preferredLanguage === opt.key && { color: colors.langOptionActiveText, fontWeight: '600' }]}>
                  {opt.label}
                </Text>
                {preferredLanguage === opt.key && (
                  <Ionicons name="checkmark" size={18} color={colors.langOptionActiveText} />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Messages */}
      {isLoadingHistory ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.spinnerColor} />
        </View>
      ) : (
        <ChatListProvider selectionMode={selectionMode} highlightedMessageId={highlightedMessageId}>
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            inverted
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            windowSize={9}
            updateCellsBatchingPeriod={50}
            onScrollToIndexFailed={(info) => {
              // If the index is out of range, scroll to the end and retry
              flatListRef.current?.scrollToEnd({ animated: false });
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.4,
                });
              }, 200);
            }}
          />
        </ChatListProvider>
      )}

      {/* Input bar — hidden in selection mode, replaced by EditMessageBar in edit mode */}
      {editingMessageId ? (
        <EditMessageBar
          initialText={
            messages.find((m) => m.id === editingMessageId)?.rawContent ?? ''
          }
          onCancel={handleCancelEdit}
          onConfirm={handleConfirmEdit}
        />
      ) : selectionMode ? null : (
        <ChatInput onSendMessage={handleSendMessage} />
      )}

      {/* Document Interrogation Modal */}
      <DocumentInterrogationModal
        visible={docModal.visible}
        messageId={docModal.messageId}
        fileUrl={docModal.fileUrl}
        initialPage={docModal.initialPage}
        onClose={handleCloseDocumentInterrogation}
      />

      {/* Search overlay */}
      <ChatSearchModal
        visible={isSearchOpen}
        groupId={groupId}
        onClose={() => setIsSearchOpen(false)}
        onGoToMessage={handleGoToMessage}
      />
    </KeyboardAvoidingView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingBottom: 12,
  },
  headerInner: {
    height: 44,
    overflow: 'hidden',
  },

  // ── Normal header row ────────────────────────────────────────────────────
  normalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },

  // ── Selection action bar row ─────────────────────────────────────────────
  selectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  selHeaderClose: {
    padding: 2,
  },
  selHeaderCount: {
    fontSize: 17,
    fontWeight: '700',
    marginLeft: 4,
  },
  selHeaderAction: {
    padding: 6,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
  },
  headerAvatarText: {
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 4,
  },
  langBtn: {
    padding: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingVertical: 8,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langPicker: {
    borderRadius: 16,
    paddingVertical: 8,
    width: 260,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  langPickerTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  langOptionIcon: {
    fontSize: 20,
  },
  langOptionText: {
    flex: 1,
    fontSize: 16,
  },
});
