import React, { createContext, useContext, useMemo } from 'react';
import type { SharedValue } from 'react-native-reanimated';

type PreferredLanguage = 'english' | 'singlish' | 'tanglish';

interface ChatListContextType {
  selectionModeProgress: SharedValue<number>;
  selectedIdsMap: SharedValue<Record<string, boolean>>;
  /** SharedValue so highlight changes drive UI-thread animations without JS re-renders. */
  highlightedMessageId: SharedValue<string | null>;
  preferredLanguage: PreferredLanguage;
}

const ChatListContext = createContext<ChatListContextType | null>(null);

export function ChatListProvider({
  selectionModeProgress,
  selectedIdsMap,
  highlightedMessageId,
  preferredLanguage,
  children,
}: ChatListContextType & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ selectionModeProgress, selectedIdsMap, highlightedMessageId, preferredLanguage }),
    // selectionModeProgress, selectedIdsMap & highlightedMessageId are stable
    // SharedValue references — their .value changing does NOT recreate this memo.
    [selectionModeProgress, selectedIdsMap, highlightedMessageId, preferredLanguage],
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
