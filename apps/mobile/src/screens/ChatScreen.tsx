import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
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

type Props = NativeStackScreenProps<AppStackParamList, 'Chat'>;

// ── Component ────────────────────────────────────────────────────────────────
export default function ChatScreen({ navigation, route }: Props) {
  const { groupId, groupName, isDm, preferredLanguage: initialLang, otherUserPicture, otherUserId } = route.params;
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

  // ── Language preference ─────────────────────────────────────────────────
  const [preferredLanguage, setPreferredLanguageState] = useState<PreferredLanguage>(
    (initialLang as PreferredLanguage) ?? (userDialect as PreferredLanguage) ?? 'english',
  );
  const [isLanguagePickerOpen, setIsLanguagePickerOpen] = useState(false);

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
  }>({ visible: false, messageId: '', fileUrl: '' });

  const handleOpenDocumentInterrogation = useCallback(
    (messageId: string, fileUrl: string, initialPage?: number) => {
      setDocModal({ visible: true, messageId, fileUrl, initialPage });
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
    },
    [],
  );

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

    const count = ref.size;
    const ids = [...ref];
    Alert.alert(
      'Delete Message' + (count > 1 ? 's' : ''),
      `Delete ${count === 1 ? 'this message' : `these ${count} messages`}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const idsSet = new Set(ids);
            setMessages((prev) => prev.filter((m) => !idsSet.has(m.id)));
            exitSelectionMode();
            socket.emit('deleteMessages', { groupId, messageIds: ids });
          },
        },
      ],
    );
  }, [socket, groupId, exitSelectionMode, setMessages, selectedIdsRef]);

  // ── Render helpers ──────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageBubble
        message={item}
        currentUserId={userId ?? ''}
        onRetry={handleRetry}
        onLongPress={handleLongPress}
        onPress={handleToggleSelect}
        onOpenDocumentInterrogation={handleOpenDocumentInterrogation}
      />
    ),
    [userId, handleRetry, handleLongPress, handleToggleSelect, handleOpenDocumentInterrogation],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  // ── JSX ─────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
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
        >
          <ChatAudioPlayerProvider>
          <MediatingAnimProvider>
          <View style={styles.listWrapper}>
            <FlashList
              ref={flatListRef}
              data={messages}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              drawDistance={800}
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
              scrollEventThrottle={80}
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
