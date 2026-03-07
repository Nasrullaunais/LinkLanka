import { useCallback, useRef, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';

// ── Hook return type ─────────────────────────────────────────────────────────
export interface UseChatSelectionReturn {
  selectionMode: boolean;
  setSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedCount: number;
  selectedIdsRef: React.MutableRefObject<Set<string>>;
  selectedIdsMap: ReturnType<typeof useSharedValue<Record<string, boolean>>>;
  selectionModeProgress: ReturnType<typeof useSharedValue<number>>;
  handleLongPress: (messageId: string) => void;
  handleToggleSelect: (messageId: string) => void;
  exitSelectionMode: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useChatSelection(): UseChatSelectionReturn {
  const [selectionMode, setSelectionMode] = useState(false);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const [selectedCount, setSelectedCount] = useState(0);
  const selectedIdsMap = useSharedValue<Record<string, boolean>>({});
  const selectionModeProgress = useSharedValue(0);

  const handleLongPress = useCallback((messageId: string) => {
    selectedIdsRef.current = new Set([messageId]);
    selectedIdsMap.value = { [messageId]: true };
    setSelectedCount(1);
    setSelectionMode(true);
  }, [selectedIdsMap]);

  const handleToggleSelect = useCallback((messageId: string) => {
    const ref = selectedIdsRef.current;
    if (ref.has(messageId)) {
      ref.delete(messageId);
    } else {
      ref.add(messageId);
    }
    const next: Record<string, boolean> = {};
    ref.forEach((id) => { next[id] = true; });
    selectedIdsMap.value = next;
    setSelectedCount(ref.size);
  }, [selectedIdsMap]);

  const exitSelectionMode = useCallback(() => {
    selectedIdsRef.current = new Set();
    selectedIdsMap.value = {};
    setSelectedCount(0);
    setSelectionMode(false);
  }, [selectedIdsMap]);

  return {
    selectionMode,
    setSelectionMode,
    selectedCount,
    selectedIdsRef,
    selectedIdsMap,
    selectionModeProgress,
    handleLongPress,
    handleToggleSelect,
    exitSelectionMode,
  };
}
