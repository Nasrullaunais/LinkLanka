import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import type { Socket } from 'socket.io-client';

import type { ChatMessage } from '../components/chat/MessageBubble';

const MAX_EDIT_MESSAGE_LENGTH = 2000;

// ── Hook params ──────────────────────────────────────────────────────────────
interface UseChatEditParams {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  socket: Socket | null;
  groupId: string;
  exitSelectionMode: () => void;
  selectedIdsRef: React.MutableRefObject<Set<string>>;
  /** Shared ref for edit rollback — created in the parent, also passed to useChatMessages */
  editOriginalRef: React.MutableRefObject<{
    id: string;
    rawContent: string;
    translations: ChatMessage['translations'];
    confidenceScore: number | null;
  } | null>;
}

export interface UseChatEditReturn {
  editingMessageId: string | null;
  handleStartEdit: () => void;
  handleCancelEdit: () => void;
  handleConfirmEdit: (newText: string) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useChatEdit({
  messages,
  setMessages,
  socket,
  groupId,
  exitSelectionMode,
  selectedIdsRef,
  editOriginalRef,
}: UseChatEditParams): UseChatEditReturn {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  const handleStartEdit = useCallback(() => {
    const ref = selectedIdsRef.current;
    if (ref.size !== 1) return;
    const [messageId] = [...ref];
    const msg = messages.find((m) => m.id === messageId);
    if (!msg) return;

    editOriginalRef.current = {
      id: msg.id,
      rawContent: msg.rawContent,
      translations: msg.translations,
      confidenceScore: msg.confidenceScore ?? null,
    };

    setEditingMessageId(messageId);
    exitSelectionMode();
  }, [messages, exitSelectionMode, selectedIdsRef, editOriginalRef]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    editOriginalRef.current = null;
  }, [editOriginalRef]);

  const handleConfirmEdit = useCallback(
    (newText: string) => {
      if (!socket || !editingMessageId) return;

      const msg = messages.find((m) => m.id === editingMessageId);
      if (!msg) return;

      const trimmed = newText.trim();
      if (trimmed.length === 0) {
        Alert.alert('Empty message', 'Please enter some text before saving.');
        return;
      }
      if (trimmed.length > MAX_EDIT_MESSAGE_LENGTH) {
        Alert.alert(
          'Message too long',
          `Messages can be up to ${MAX_EDIT_MESSAGE_LENGTH} characters.`,
        );
        return;
      }
      if (trimmed === msg.rawContent.trim()) {
        handleCancelEdit();
        return;
      }

      setMessages((prev) =>
        {
          const index = prev.findIndex((m) => m.id === editingMessageId);
          if (index === -1) return prev;
          const next = [...prev];
          next[index] = {
            ...next[index],
            rawContent: trimmed,
            translations: null,
            confidenceScore: null,
            isRetrying: true,
            isEdited: true,
          };
          return next;
        },
      );

      setEditingMessageId(null);

      socket.emit('editMessage', {
        groupId,
        messageId: editingMessageId,
        newContent: trimmed,
      });
    },
    [socket, editingMessageId, messages, groupId, handleCancelEdit, setMessages],
  );

  return {
    editingMessageId,
    handleStartEdit,
    handleCancelEdit,
    handleConfirmEdit,
  };
}
