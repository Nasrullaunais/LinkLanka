import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  InteractionManager,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { setLanguagePreference } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNotification } from '../contexts/NotificationContext';
import { ChatListProvider } from '../contexts/ChatListContext';
import { ChatAudioPlayerProvider } from '../contexts/ChatAudioPlayerContext';
import ChatInput from '../components/chat/ChatInput';
import EditMessageBar from '../components/chat/EditMessageBar';
import MessageBubble, { MediatingAnimProvider, type ChatMessage } from '../components/chat/MessageBubble';
import DocumentInterrogationModal from '../components/chat/DocumentInterrogationModal';
import ChatSearchModal from '../components/chat/ChatSearchModal';
import ChatHeader from '../components/chat/ChatHeader';
import LanguagePickerModal, { type PreferredLanguage } from '../components/chat/LanguagePickerModal';
import ChatSkeleton from '../components/chat/ChatSkeleton';
import type { AppStackParamList } from '../navigation/types';

import { useChatMessages } from '../hooks/useChatMessages';
import { useChatSelection } from '../hooks/useChatSelection';
import { useChatEdit } from '../hooks/useChatEdit';
import { getTranslatedOnlyMode } from '../utils/secureStorage';

type Props = NativeStackScreenProps<AppStackParamList, 'Chat'>;

const CHAT_DRAW_DISTANCE = 420;
const ENABLE_CHAT_PERF_METRICS = __DEV__;

type ScrollPerfSession = {
  active: boolean;
  dragActive: boolean;
  momentumActive: boolean;
  startedAtMs: number;
  startOffsetY: number;
  lastOffsetY: number;
  lastEventAtMs: number;
  eventCount: number;
  totalDistancePx: number;
  maxSpeedPxPerSec: number;
  longestEventGapMs: number;
  jankEventCount: number;
};

type JsFrameSession = {
  active: boolean;
  rafId: number | null;
  lastFrameAtMs: number;
  frameCount: number;
  totalFrameGapMs: number;
  longestFrameGapMs: number;
  jankFrameCount: number;
  approxDroppedFrames: number;
};

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ChatScreen({ navigation, route }: Props) {
  const { groupId, groupName, isDm, preferredLanguage: initialLang, otherUserPicture, otherUserId } = route.params;
  const { userId, userDialect } = useAuth();
  const { socket, isConnected } = useSocket();
  const { colors } = useTheme();
  const { setActiveGroupId } = useNotification();
  const insets = useSafeAreaInsets();

  const perfOpenStartRef = useRef(Date.now());
  const perfHistoryLoggedRef = useRef(false);
  const perfListDrawLoggedRef = useRef(false);
  const perfInteractiveLoggedRef = useRef(false);
  const endDragSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollPerfRef = useRef<ScrollPerfSession>({
    active: false,
    dragActive: false,
    momentumActive: false,
    startedAtMs: 0,
    startOffsetY: 0,
    lastOffsetY: 0,
    lastEventAtMs: 0,
    eventCount: 0,
    totalDistancePx: 0,
    maxSpeedPxPerSec: 0,
    longestEventGapMs: 0,
    jankEventCount: 0,
  });
  const jsFramePerfRef = useRef<JsFrameSession>({
    active: false,
    rafId: null,
    lastFrameAtMs: 0,
    frameCount: 0,
    totalFrameGapMs: 0,
    longestFrameGapMs: 0,
    jankFrameCount: 0,
    approxDroppedFrames: 0,
  });

  const logPerf = useCallback(
    (event: string, data: Record<string, unknown>) => {
      if (!ENABLE_CHAT_PERF_METRICS) return;
      console.info(`[ChatPerf][${groupId}] ${event} ${JSON.stringify(data)}`);
    },
    [groupId],
  );

  const stopJsFrameMonitor = useCallback(() => {
    const js = jsFramePerfRef.current;
    if (!js.active) {
      return {
        fps: 0,
        longestFrameGapMs: 0,
        jankFrameCount: 0,
        approxDroppedFrames: 0,
      };
    }

    js.active = false;
    if (js.rafId != null) {
      cancelAnimationFrame(js.rafId);
      js.rafId = null;
    }

    const averageFrameGap = js.frameCount > 0 ? js.totalFrameGapMs / js.frameCount : 0;
    const fps = averageFrameGap > 0 ? 1000 / averageFrameGap : 0;
    return {
      fps: roundMetric(fps),
      longestFrameGapMs: roundMetric(js.longestFrameGapMs),
      jankFrameCount: js.jankFrameCount,
      approxDroppedFrames: js.approxDroppedFrames,
    };
  }, []);

  const startJsFrameMonitor = useCallback(() => {
    if (!ENABLE_CHAT_PERF_METRICS) return;
    const js = jsFramePerfRef.current;
    if (js.active) return;

    js.active = true;
    js.lastFrameAtMs = 0;
    js.frameCount = 0;
    js.totalFrameGapMs = 0;
    js.longestFrameGapMs = 0;
    js.jankFrameCount = 0;
    js.approxDroppedFrames = 0;

    const tick = (timestamp: number) => {
      const current = jsFramePerfRef.current;
      if (!current.active) return;

      if (current.lastFrameAtMs > 0) {
        const gap = timestamp - current.lastFrameAtMs;
        current.frameCount += 1;
        current.totalFrameGapMs += gap;
        if (gap > current.longestFrameGapMs) current.longestFrameGapMs = gap;
        if (gap > 20) current.jankFrameCount += 1;
        if (gap > 16.67) {
          current.approxDroppedFrames += Math.max(0, Math.floor(gap / 16.67) - 1);
        }
      }

      current.lastFrameAtMs = timestamp;
      current.rafId = requestAnimationFrame(tick);
    };

    js.rafId = requestAnimationFrame(tick);
  }, []);

  const finalizeScrollPerfSession = useCallback((reason: 'drag-end' | 'momentum-end' | 'cleanup') => {
    if (!ENABLE_CHAT_PERF_METRICS) return;

    const scroll = scrollPerfRef.current;
    if (!scroll.active) return;
    if (scroll.dragActive || scroll.momentumActive) return;

    const now = Date.now();
    const durationMs = Math.max(1, now - scroll.startedAtMs);
    const eventsPerSec = (scroll.eventCount * 1000) / durationMs;
    const averageSpeedPxPerSec = (scroll.totalDistancePx * 1000) / durationMs;
    const averageEventGapMs = scroll.eventCount > 1 ? durationMs / (scroll.eventCount - 1) : durationMs;
    const jsFrame = stopJsFrameMonitor();

    logPerf('rapid_scroll_sample', {
      reason,
      durationMs,
      events: scroll.eventCount,
      eventsPerSec: roundMetric(eventsPerSec),
      averageEventGapMs: roundMetric(averageEventGapMs),
      longestEventGapMs: roundMetric(scroll.longestEventGapMs),
      jankEventCount: scroll.jankEventCount,
      distancePx: roundMetric(scroll.totalDistancePx),
      averageSpeedPxPerSec: roundMetric(averageSpeedPxPerSec),
      maxSpeedPxPerSec: roundMetric(scroll.maxSpeedPxPerSec),
      jsFps: jsFrame.fps,
      jsLongestFrameGapMs: jsFrame.longestFrameGapMs,
      jsJankFrames: jsFrame.jankFrameCount,
      jsApproxDroppedFrames: jsFrame.approxDroppedFrames,
    });

    scroll.active = false;
  }, [logPerf, stopJsFrameMonitor]);

  const startScrollPerfSession = useCallback((offsetY: number) => {
    if (!ENABLE_CHAT_PERF_METRICS) return;
    const now = Date.now();
    const scroll = scrollPerfRef.current;

    scroll.active = true;
    scroll.startedAtMs = now;
    scroll.startOffsetY = offsetY;
    scroll.lastOffsetY = offsetY;
    scroll.lastEventAtMs = now;
    scroll.eventCount = 0;
    scroll.totalDistancePx = 0;
    scroll.maxSpeedPxPerSec = 0;
    scroll.longestEventGapMs = 0;
    scroll.jankEventCount = 0;

    startJsFrameMonitor();
  }, [startJsFrameMonitor]);

  // ── Suppress notifications for this chat while it's on screen ───────────
  useEffect(() => {
    setActiveGroupId(groupId);
    return () => setActiveGroupId(null);
  }, [groupId, setActiveGroupId]);

  // ── Language preference ─────────────────────────────────────────────────
  const [preferredLanguage, setPreferredLanguageState] = useState<PreferredLanguage>(
    (initialLang as PreferredLanguage) ?? (userDialect as PreferredLanguage) ?? 'english',
  );
  const [isLanguagePickerOpen, setIsLanguagePickerOpen] = useState(false);

  // ── Translated-only preference ──────────────────────────────────────────
  const [showTranslatedOnly, setShowTranslatedOnly] = useState<boolean>(false);

  useEffect(() => {
    getTranslatedOnlyMode().then((value) => {
      setShowTranslatedOnly(value);
    });
  }, []);

  useEffect(() => {
    if (!ENABLE_CHAT_PERF_METRICS) return;

    logPerf('chat_open_start', {
      at: perfOpenStartRef.current,
      preferredLanguage,
      isDm,
    });
  }, [logPerf, preferredLanguage, isDm]);

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

  // ── Shared edit-original ref (breaks circular dep between hooks) ──────
  // useChatMessages needs this for edit-fail rollback; useChatEdit writes it.
  const editOriginalRef = useRef<{
    id: string;
    rawContent: string;
    translations: ChatMessage['translations'];
    confidenceScore: number | null;
  } | null>(null);

  // ── Selection ───────────────────────────────────────────────────────────
  const {
    selectionMode,
    selectedCount,
    selectedIdsRef,
    selectedIdsMap,
    selectionModeProgress,
    handleLongPress,
    handleToggleSelect,
    exitSelectionMode,
  } = useChatSelection();

  // ── Messages & socket events ────────────────────────────────────────────
  const {
    messages,
    setMessages,
    isLoadingHistory,
    isFetchingOlder,
    hasMore,
    loadOlderMessages,
    handleSendMessage,
    handleRetry,
  } = useChatMessages({
    groupId,
    userId,
    socket,
    isConnected,
    editOriginalRef,
    onNewMessage: () => {
      if (!isScrolledUpRef.current) {
        flatListRef.current?.scrollToEnd({ animated: true });
      }
    },
  });

  useEffect(() => {
    if (!ENABLE_CHAT_PERF_METRICS || perfHistoryLoggedRef.current || isLoadingHistory) return;

    perfHistoryLoggedRef.current = true;
    const elapsed = Date.now() - perfOpenStartRef.current;
    logPerf('history_ready', {
      elapsedMs: elapsed,
      initialMessageCount: messages.length,
    });
  }, [isLoadingHistory, messages.length, logPerf]);

  useEffect(() => {
    if (!ENABLE_CHAT_PERF_METRICS || perfInteractiveLoggedRef.current || isLoadingHistory) return;

    const task = InteractionManager.runAfterInteractions(() => {
      if (perfInteractiveLoggedRef.current) return;
      perfInteractiveLoggedRef.current = true;
      const elapsed = Date.now() - perfOpenStartRef.current;
      logPerf('first_interactive', {
        elapsedMs: elapsed,
        visibleMessageCount: messagesRef.current.length,
      });
    });

    return () => {
      task.cancel();
    };
  }, [isLoadingHistory, logPerf]);

  // ── Edit ────────────────────────────────────────────────────────────────
  const {
    editingMessageId: activeEditId,
    handleStartEdit: startEdit,
    handleCancelEdit: cancelEdit,
    handleConfirmEdit: confirmEdit,
  } = useChatEdit({
    messages,
    setMessages,
    socket,
    groupId,
    exitSelectionMode,
    selectedIdsRef,
    editOriginalRef,
  });

  // ── Header cross-fade animation ─────────────────────────────────────────
  const selHeaderOpacity = useSharedValue(0);
  const normHeaderOpacity = useSharedValue(1);

  useEffect(() => {
    selHeaderOpacity.value = withTiming(selectionMode ? 1 : 0, { duration: 200 });
    normHeaderOpacity.value = withTiming(selectionMode ? 0 : 1, { duration: 200 });
    selectionModeProgress.value = withTiming(selectionMode ? 1 : 0, { duration: 180 });
  }, [selectionMode, selHeaderOpacity, normHeaderOpacity, selectionModeProgress]);

  const selHeaderAnimStyle = useAnimatedStyle(() => ({ opacity: selHeaderOpacity.value }));
  const normHeaderAnimStyle = useAnimatedStyle(() => ({ opacity: normHeaderOpacity.value }));

  // ── Document Interrogation state ────────────────────────────────────────
  const [docModal, setDocModal] = useState<{
    visible: boolean;
    messageId: string;
    fileUrl: string;
    initialPage?: number;
    detectedLanguage?: ChatMessage['detectedLanguage'];
  }>({ visible: false, messageId: '', fileUrl: '', fileName: undefined });

  const handleOpenDocumentInterrogation = useCallback(
    (
      messageId: string,
      fileUrl: string,
      initialPage?: number,
      detectedLanguage?: ChatMessage['detectedLanguage'],
      fileName?: string,
    ) => {
      setDocModal({
        visible: true,
        messageId,
        fileUrl,
        initialPage,
        detectedLanguage,
        fileName,
      });
    },
    [],
  );

  const handleCloseDocumentInterrogation = useCallback(() => {
    setDocModal((prev) => ({ ...prev, visible: false }));
  }, []);

  // ── Search state ───────────────────────────────────────────────────────
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const highlightedMessageId = useSharedValue<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlashListRef<ChatMessage>>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const initialAnimatedMessageCountRef = useRef<number | null>(null);
  const [shouldAnimateInitialMessages, setShouldAnimateInitialMessages] = useState(true);

  useEffect(() => {
    setShouldAnimateInitialMessages(true);
    initialAnimatedMessageCountRef.current = null;
  }, [groupId]);

  useEffect(() => {
    if (isLoadingHistory) return;
    if (initialAnimatedMessageCountRef.current == null) {
      initialAnimatedMessageCountRef.current = messages.length;
    }

    const timer = setTimeout(() => {
      setShouldAnimateInitialMessages(false);
    }, 900);

    return () => clearTimeout(timer);
  }, [isLoadingHistory, messages.length]);

  // ── Scroll-to-bottom FAB ─────────────────────────────────────────────
  const isScrolledUpRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      // Distance from the bottom edge of content
      const distanceFromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      const was = isScrolledUpRef.current;
      const is = distanceFromBottom > 150;
      if (was !== is) {
        isScrolledUpRef.current = is;
        setShowScrollToBottom(is);
      }

      if (!ENABLE_CHAT_PERF_METRICS) return;
      const scroll = scrollPerfRef.current;
      if (!scroll.active) return;

      const now = Date.now();
      const deltaY = Math.abs(contentOffset.y - scroll.lastOffsetY);
      const deltaT = Math.max(1, now - scroll.lastEventAtMs);
      const speed = (deltaY * 1000) / deltaT;

      scroll.eventCount += 1;
      scroll.totalDistancePx += deltaY;
      scroll.lastOffsetY = contentOffset.y;
      scroll.lastEventAtMs = now;

      if (deltaT > scroll.longestEventGapMs) scroll.longestEventGapMs = deltaT;
      if (deltaT > 50) scroll.jankEventCount += 1;
      if (speed > scroll.maxSpeedPxPerSec) scroll.maxSpeedPxPerSec = speed;
    },
    [],
  );

  const handleListLoad = useCallback((info: { elapsedTimeInMs: number }) => {
    if (!ENABLE_CHAT_PERF_METRICS || perfListDrawLoggedRef.current) return;
    perfListDrawLoggedRef.current = true;

    logPerf('list_first_draw', {
      elapsedSinceOpenMs: Date.now() - perfOpenStartRef.current,
      flashListElapsedMs: roundMetric(info.elapsedTimeInMs),
      renderedMessages: messagesRef.current.length,
    });
  }, [logPerf]);

  const handleScrollBeginDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!ENABLE_CHAT_PERF_METRICS) return;

    const scroll = scrollPerfRef.current;
    scroll.dragActive = true;
    if (endDragSettleTimerRef.current) {
      clearTimeout(endDragSettleTimerRef.current);
      endDragSettleTimerRef.current = null;
    }
    if (!scroll.active) {
      startScrollPerfSession(e.nativeEvent.contentOffset.y);
    }
  }, [startScrollPerfSession]);

  const handleScrollEndDrag = useCallback(() => {
    if (!ENABLE_CHAT_PERF_METRICS) return;

    const scroll = scrollPerfRef.current;
    scroll.dragActive = false;

    if (endDragSettleTimerRef.current) clearTimeout(endDragSettleTimerRef.current);
    endDragSettleTimerRef.current = setTimeout(() => {
      const latest = scrollPerfRef.current;
      if (!latest.momentumActive) {
        finalizeScrollPerfSession('drag-end');
      }
    }, 120);
  }, [finalizeScrollPerfSession]);

  const handleMomentumScrollBegin = useCallback(() => {
    if (!ENABLE_CHAT_PERF_METRICS) return;

    const scroll = scrollPerfRef.current;
    scroll.momentumActive = true;
    if (!scroll.active) {
      startScrollPerfSession(scroll.lastOffsetY);
    }
    if (endDragSettleTimerRef.current) {
      clearTimeout(endDragSettleTimerRef.current);
      endDragSettleTimerRef.current = null;
    }
  }, [startScrollPerfSession]);

  const handleMomentumScrollEnd = useCallback(() => {
    if (!ENABLE_CHAT_PERF_METRICS) return;

    const scroll = scrollPerfRef.current;
    scroll.momentumActive = false;
    finalizeScrollPerfSession('momentum-end');
  }, [finalizeScrollPerfSession]);

  useEffect(() => {
    return () => {
      if (endDragSettleTimerRef.current) {
        clearTimeout(endDragSettleTimerRef.current);
      }
      stopJsFrameMonitor();
      finalizeScrollPerfSession('cleanup');
    };
  }, [finalizeScrollPerfSession, stopJsFrameMonitor]);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const handleGoToMessage = useCallback(
    async (messageId: string) => {
      const idx = messagesRef.current.findIndex((m) => m.id === messageId);
      if (idx !== -1) {
        flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.4 });
        highlightedMessageId.value = messageId;
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          highlightedMessageId.value = null;
        }, 2500);
      }
    },
    [highlightedMessageId],
  );

  // ── Hardware back button exits selection/edit mode ──────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (activeEditId) {
        cancelEdit();
        return true;
      }
      if (selectionMode) {
        exitSelectionMode();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [selectionMode, activeEditId, cancelEdit, exitSelectionMode]);

  // ── Delete handler ──────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    const ref = selectedIdsRef.current;
    if (!socket || ref.size === 0) return;
    if (!userId) return;

    const ownMessageIds: string[] = [];
    const receivedMessageIds: string[] = [];

    for (const id of ref) {
      const msg = messagesRef.current.find((m) => m.id === id);
      if (!msg || msg.isOptimistic) continue;
      if (msg.senderId === userId) {
        ownMessageIds.push(id);
      } else {
        receivedMessageIds.push(id);
      }
    }

    const count = ownMessageIds.length + receivedMessageIds.length;
    if (count === 0) return;

    let body =
      count === 1
        ? 'Delete this message? This cannot be undone.'
        : `Delete these ${count} messages? This cannot be undone.`;

    if (ownMessageIds.length > 0 && receivedMessageIds.length > 0) {
      body =
        `Delete ${ownMessageIds.length} sent message(s) for everyone and remove ` +
        `${receivedMessageIds.length} received message(s) from your chat? This cannot be undone.`;
    } else if (receivedMessageIds.length > 0) {
      body =
        count === 1
          ? 'Remove this received message from your chat? This cannot be undone.'
          : `Remove these ${count} received messages from your chat? This cannot be undone.`;
    }

    Alert.alert(
      'Delete Message' + (count > 1 ? 's' : ''),
      body,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            exitSelectionMode();
            if (ownMessageIds.length > 0) {
              socket.emit('deleteMessages', {
                groupId,
                messageIds: ownMessageIds,
              });
            }
            if (receivedMessageIds.length > 0) {
              socket.emit('hideMessages', {
                groupId,
                messageIds: receivedMessageIds,
              });
            }
          },
        },
      ],
    );
  }, [socket, groupId, exitSelectionMode, selectedIdsRef, messagesRef, userId]);

  // ── Render helpers ──────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const baseCount = initialAnimatedMessageCountRef.current ?? messagesRef.current.length;
      const distanceFromBottom = Math.max(0, baseCount - 1 - index);
      const enterDelayMs = shouldAnimateInitialMessages
        ? Math.min(distanceFromBottom * 14, 220)
        : 0;

      return (
      <MessageBubble
        message={item}
        enterDelayMs={enterDelayMs}
        currentUserId={userId ?? ''}
        onRetry={handleRetry}
        onLongPress={handleLongPress}
        onPress={handleToggleSelect}
        onOpenDocumentInterrogation={handleOpenDocumentInterrogation}
      />
      );
    },
    [
      userId,
      shouldAnimateInitialMessages,
      handleRetry,
      handleLongPress,
      handleToggleSelect,
      handleOpenDocumentInterrogation,
    ],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  // ── JSX ─────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : undefined}
    >
      {/* Header */}
      <ChatHeader
        topInset={insets.top}
        colors={colors}
        selectionMode={selectionMode}
        selectedCount={selectedCount}
        selectedIdsRef={selectedIdsRef}
        messagesRef={messagesRef}
        userId={userId}
        selHeaderAnimStyle={selHeaderAnimStyle}
        normHeaderAnimStyle={normHeaderAnimStyle}
        onExitSelection={exitSelectionMode}
        onStartEdit={startEdit}
        onDelete={handleDelete}
        onGoBack={() => navigation.goBack()}
        onOpenGroupInfo={() => {
          if (isDm && otherUserId) {
            navigation.navigate('PersonInfo', {
              userId: otherUserId,
              displayName: groupName,
              profilePictureUrl: otherUserPicture,
            });
          } else if (!isDm) {
            navigation.navigate('GroupInfo', { groupId, groupName });
          }
        }}
        onOpenLanguagePicker={() => setIsLanguagePickerOpen(true)}
        onOpenSearch={() => setIsSearchOpen(true)}
        groupName={groupName}
        isDm={isDm}
        otherUserPicture={otherUserPicture}
        isConnected={isConnected}
      />

      {/* Language picker modal */}
      <LanguagePickerModal
        visible={isLanguagePickerOpen}
        preferredLanguage={preferredLanguage}
        onSelect={handleSelectLanguage}
        onClose={() => setIsLanguagePickerOpen(false)}
        colors={colors}
      />

      {/* Messages */}
      {isLoadingHistory ? (
        <ChatSkeleton />
      ) : (
        <ChatListProvider
          selectionMode={selectionMode}
          selectionModeProgress={selectionModeProgress}
          selectedIdsMap={selectedIdsMap}
          highlightedMessageId={highlightedMessageId}
          preferredLanguage={preferredLanguage}
          showTranslatedOnly={showTranslatedOnly}
        >
          <ChatAudioPlayerProvider>
          <MediatingAnimProvider>
          <View style={styles.listWrapper}>
            <FlashList
              ref={flatListRef}
              data={messages}
              renderItem={renderItem}
              onLoad={handleListLoad}
              keyExtractor={keyExtractor}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              drawDistance={CHAT_DRAW_DISTANCE}
              overrideProps={{ initialDrawBatchSize: 14 }}
              maintainVisibleContentPosition={{
                startRenderingFromBottom: true,
              }}
              onStartReached={hasMore ? loadOlderMessages : undefined}
              onStartReachedThreshold={0.1}
              ListHeaderComponent={
                isFetchingOlder ? (
                  <View style={styles.loadingOlder}>
                    <ActivityIndicator size="small" color={colors.spinnerColor} />
                  </View>
                ) : null
              }
              onScroll={handleScroll}
              onScrollBeginDrag={handleScrollBeginDrag}
              onScrollEndDrag={handleScrollEndDrag}
              onMomentumScrollBegin={handleMomentumScrollBegin}
              onMomentumScrollEnd={handleMomentumScrollEnd}
              scrollEventThrottle={32}
              getItemType={(item) => item.contentType}
            />
            {showScrollToBottom && (
              <Pressable
                style={[styles.scrollToBottomBtn, { backgroundColor: colors.fabBg }]}
                onPress={scrollToBottom}
                hitSlop={8}
              >
                <Ionicons name="chevron-down" size={22} color={colors.headerText ?? '#fff'} />
              </Pressable>
            )}
          </View>
          </MediatingAnimProvider>
          </ChatAudioPlayerProvider>
        </ChatListProvider>
      )}

      {/* Input bar — hidden in selection mode, replaced by EditMessageBar in edit mode */}
      {activeEditId ? (
        <EditMessageBar
          initialText={
            messages.find((m) => m.id === activeEditId)?.rawContent ?? ''
          }
          onCancel={cancelEdit}
          onConfirm={confirmEdit}
        />
      ) : (
        <ChatInput onSendMessage={handleSendMessage} />
      )}

      {/* Document Interrogation Modal */}
      <DocumentInterrogationModal
        visible={docModal.visible}
        messageId={docModal.messageId}
        fileUrl={docModal.fileUrl}
        detectedLanguage={docModal.detectedLanguage}
        initialPage={docModal.initialPage}
        fileName={docModal.fileName}
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
  listWrapper: {
    flex: 1,
  },
  list: {
    paddingVertical: 8,
  },
  loadingOlder: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  scrollToBottomBtn: {
    position: 'absolute',
    bottom: 12,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
