import React, { createContext, useContext, useMemo } from 'react';
import type { SharedValue } from 'react-native-reanimated';

/**
 * Lightweight context that lets individual `MessageBubble` components
 * animate in response to selection mode **without any React re-renders**.
 *
 * `selectionModeProgress` is a Reanimated SharedValue<number> (0 = off,
 * 1 = on) created once in ChatScreen and passed down here. Because the
 * SharedValue *object reference* is stable, the context value never
 * changes when the user enters or exits selection mode — each bubble's
 * `useAnimatedStyle` reacts to the value change directly on the UI thread.
 *
 * Only `highlightedMessageId` changes (rare — search navigation) cause
 * a React context update and re-render.
 */
interface ChatListContextType {
  selectionModeProgress: SharedValue<number>;
  highlightedMessageId: string | null;
}

const ChatListContext = createContext<ChatListContextType | null>(null);

export function ChatListProvider({
  selectionModeProgress,
  highlightedMessageId,
  children,
}: ChatListContextType & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ selectionModeProgress, highlightedMessageId }),
    // selectionModeProgress is a stable object reference — its .value
    // changing does NOT recreate this memo or re-render subscribers.
    [selectionModeProgress, highlightedMessageId],
  );

  return (
    <ChatListContext.Provider value={value}>{children}</ChatListContext.Provider>
  );
}

export function useChatList() {
  const ctx = useContext(ChatListContext);
  if (!ctx) throw new Error('useChatList must be used inside ChatListProvider');
  return ctx;
}
