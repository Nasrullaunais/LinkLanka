import React, { createContext, useContext, useMemo } from 'react';

/**
 * Lightweight context that lets individual `MessageBubble` components
 * subscribe to `selectionMode` and `highlightedMessageId` **without**
 * requiring the FlatList's `renderItem` to carry these as props.
 *
 * Because `renderItem` no longer depends on these values, toggling
 * selection mode or highlighting a search result no longer forces
 * every visible cell to re-render.
 */
interface ChatListContextType {
  selectionMode: boolean;
  highlightedMessageId: string | null;
}

const ChatListContext = createContext<ChatListContextType>({
  selectionMode: false,
  highlightedMessageId: null,
});

export function ChatListProvider({
  selectionMode,
  highlightedMessageId,
  children,
}: ChatListContextType & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ selectionMode, highlightedMessageId }),
    [selectionMode, highlightedMessageId],
  );

  return (
    <ChatListContext.Provider value={value}>{children}</ChatListContext.Provider>
  );
}

export function useChatList() {
  return useContext(ChatListContext);
}
