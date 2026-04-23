import React, { createContext, useContext, useMemo } from 'react';
import type { SharedValue } from 'react-native-reanimated';

type PreferredLanguage = 'english' | 'singlish' | 'tanglish';

interface ChatListContextType {
  selectionMode: boolean;
  selectionModeProgress: SharedValue<number>;
  selectedIdsMap: SharedValue<Record<string, boolean>>;
  /** SharedValue so highlight changes drive UI-thread animations without JS re-renders. */
  highlightedMessageId: SharedValue<string | null>;
  preferredLanguage: PreferredLanguage;
  showTranslatedOnly: boolean;
}

const ChatListContext = createContext<ChatListContextType | null>(null);

export function ChatListProvider({
  selectionMode,
  selectionModeProgress,
  selectedIdsMap,
  highlightedMessageId,
  preferredLanguage,
  showTranslatedOnly,
  children,
}: ChatListContextType & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ selectionMode, selectionModeProgress, selectedIdsMap, highlightedMessageId, preferredLanguage, showTranslatedOnly }),
    // selectionModeProgress, selectedIdsMap & highlightedMessageId are stable
    // SharedValue references — their .value changing does NOT recreate this memo.
    [selectionMode, selectionModeProgress, selectedIdsMap, highlightedMessageId, preferredLanguage, showTranslatedOnly],
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
