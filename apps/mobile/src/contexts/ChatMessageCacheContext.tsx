import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import type { ChatMessage } from '../components/chat/MessageBubble';

const MAX_CACHED_CHATS = 10;
const MAX_MESSAGES_PER_CHAT = 120;

export interface ChatMessageCacheEntry {
  messages: ChatMessage[];
  hasMore: boolean;
  oldestCursor: string | null;
  updatedAt: number;
}

interface UpsertChatMessageCachePayload {
  messages: ChatMessage[];
  hasMore: boolean;
  oldestCursor: string | null;
}

interface ChatMessageCacheContextValue {
  getChatCache: (groupId: string) => ChatMessageCacheEntry | undefined;
  upsertChatCache: (groupId: string, payload: UpsertChatMessageCachePayload) => void;
  clearAllChatCache: () => void;
}

const ChatMessageCacheContext = createContext<ChatMessageCacheContextValue | undefined>(undefined);

function trimMessagesForCache(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_MESSAGES_PER_CHAT) return messages;
  // Keep the most recent messages in cache for faster reopen.
  return messages.slice(messages.length - MAX_MESSAGES_PER_CHAT);
}

export function ChatMessageCacheProvider({ children }: { children: React.ReactNode }) {
  const cacheRef = useRef<Map<string, ChatMessageCacheEntry>>(new Map());
  const lruRef = useRef<string[]>([]);

  const touch = useCallback((groupId: string) => {
    lruRef.current = lruRef.current.filter((id) => id !== groupId);
    lruRef.current.push(groupId);
  }, []);

  const evictIfNeeded = useCallback(() => {
    while (lruRef.current.length > MAX_CACHED_CHATS) {
      const oldestGroupId = lruRef.current.shift();
      if (!oldestGroupId) break;
      cacheRef.current.delete(oldestGroupId);
    }
  }, []);

  const getChatCache = useCallback((groupId: string) => {
    const cached = cacheRef.current.get(groupId);
    if (!cached) return undefined;
    touch(groupId);
    return cached;
  }, [touch]);

  const upsertChatCache = useCallback((groupId: string, payload: UpsertChatMessageCachePayload) => {
    cacheRef.current.set(groupId, {
      messages: trimMessagesForCache(payload.messages),
      hasMore: payload.hasMore,
      oldestCursor: payload.oldestCursor,
      updatedAt: Date.now(),
    });
    touch(groupId);
    evictIfNeeded();
  }, [evictIfNeeded, touch]);

  const clearAllChatCache = useCallback(() => {
    cacheRef.current.clear();
    lruRef.current = [];
  }, []);

  const value = useMemo<ChatMessageCacheContextValue>(
    () => ({ getChatCache, upsertChatCache, clearAllChatCache }),
    [getChatCache, upsertChatCache, clearAllChatCache],
  );

  return (
    <ChatMessageCacheContext.Provider value={value}>
      {children}
    </ChatMessageCacheContext.Provider>
  );
}

export function useChatMessageCache(): ChatMessageCacheContextValue {
  const context = useContext(ChatMessageCacheContext);
  if (!context) {
    throw new Error('useChatMessageCache must be used inside <ChatMessageCacheProvider>');
  }
  return context;
}
