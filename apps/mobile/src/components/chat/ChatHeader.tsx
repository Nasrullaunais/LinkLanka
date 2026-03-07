import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import type { ChatMessage } from './MessageBubble';

// ── Props ────────────────────────────────────────────────────────────────────
interface ChatHeaderProps {
  /* ── layout / theming ─────────────────────────────────────────────── */
  topInset: number;
  colors: Record<string, string>;

  /* ── selection state ──────────────────────────────────────────────── */
  selectionMode: boolean;
  selectedCount: number;
  selectedIdsRef: React.MutableRefObject<Set<string>>;
  /** Stable ref — avoids re-rendering the header every time a message arrives */
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  userId: string | null;

  /* ── animated styles for the cross-fade header ────────────────────── */
  selHeaderAnimStyle: AnimatedStyle<ViewStyle>;
  normHeaderAnimStyle: AnimatedStyle<ViewStyle>;

  /* ── selection callbacks ──────────────────────────────────────────── */
  onExitSelection: () => void;
  onStartEdit: () => void;
  onDelete: () => void;

  /* ── normal-header callbacks ─────────────────────────────────────── */
  onGoBack: () => void;
  onOpenGroupInfo: () => void;
  onOpenLanguagePicker: () => void;
  onOpenSearch: () => void;

  /* ── normal-header data ──────────────────────────────────────────── */
  groupName: string;
  isDm?: boolean;
  otherUserPicture?: string | null;
  isConnected: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────
function ChatHeader({
  topInset,
  colors,
  selectionMode,
  selectedCount,
  selectedIdsRef,
  messagesRef,
  userId,
  selHeaderAnimStyle,
  normHeaderAnimStyle,
  onExitSelection,
  onStartEdit,
  onDelete,
  onGoBack,
  onOpenGroupInfo,
  onOpenLanguagePicker,
  onOpenSearch,
  groupName,
  isDm,
  otherUserPicture,
  isConnected,
}: ChatHeaderProps) {
  // ── Edit eligibility — 1 own TEXT message within 15 min ─────────────────
  const renderEditButton = () => {
    const ref = selectedIdsRef.current;
    if (ref.size !== 1) return null;
    const [mid] = [...ref];
    const msg = messagesRef.current.find((m) => m.id === mid);
    if (!msg) return null;
    if (msg.senderId !== userId) return null;
    if (msg.contentType !== 'TEXT') return null;
    if (msg.isOptimistic) return null;
    if (msg.createdAt) {
      const age = Date.now() - new Date(msg.createdAt).getTime();
      if (age > 15 * 60 * 1000) return null;
    }
    return (
      <Pressable onPress={onStartEdit} hitSlop={12} style={styles.selHeaderAction}>
        <Ionicons name="pencil" size={22} color={colors.headerText} />
      </Pressable>
    );
  };

  // ── Delete eligibility — all own, non-optimistic ────────────────────────
  const renderDeleteButton = () => {
    const ids = [...selectedIdsRef.current];
    if (ids.length === 0) return null;
    const allOwn = ids.every((id) => {
      const msg = messagesRef.current.find((m) => m.id === id);
      return msg?.senderId === userId && !msg?.isOptimistic;
    });
    if (!allOwn) return null;
    return (
      <Pressable onPress={onDelete} hitSlop={12} style={styles.selHeaderAction}>
        <Ionicons name="trash-outline" size={22} color={colors.destructiveLight} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.header, { paddingTop: topInset + 12, backgroundColor: colors.headerBg }]}>
      <View style={styles.headerInner}>
        {/* ── Selection action bar ─────────────────────────────────────── */}
        <Animated.View
          pointerEvents={selectionMode ? 'auto' : 'none'}
          style={[StyleSheet.absoluteFill, styles.selectionHeaderRow, selHeaderAnimStyle]}
        >
          <Pressable onPress={onExitSelection} hitSlop={12} style={styles.selHeaderClose}>
            <Ionicons name="close" size={24} color={colors.headerText} />
          </Pressable>
          <Text style={[styles.selHeaderCount, { color: colors.headerText }]}>
            {selectedCount} selected
          </Text>
          <View style={{ flex: 1 }} />
          {renderEditButton()}
          {renderDeleteButton()}
        </Animated.View>

        {/* ── Normal header ────────────────────────────────────────────── */}
        <Animated.View
          pointerEvents={selectionMode ? 'none' : 'auto'}
          style={[StyleSheet.absoluteFill, styles.normalHeaderRow, normHeaderAnimStyle]}
        >
          <Pressable onPress={onGoBack} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.headerText} />
          </Pressable>
          <Pressable onPress={onOpenGroupInfo} style={styles.headerTitleArea} hitSlop={4}>
            {isDm && otherUserPicture ? (
              <Image source={{ uri: otherUserPicture }} style={styles.headerAvatar} contentFit="cover" transition={200} />
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
          </Pressable>
          <Pressable onPress={onOpenLanguagePicker} style={styles.langBtn} hitSlop={8}>
            <Ionicons name="language" size={20} color={colors.headerTextSecondary} />
          </Pressable>
          <Pressable onPress={onOpenSearch} style={styles.langBtn} hitSlop={8}>
            <Ionicons name="search" size={20} color={colors.headerTextSecondary} />
          </Pressable>
          <View
            style={[styles.dot, isConnected ? { backgroundColor: colors.dotOnline } : { backgroundColor: colors.dotOffline }]}
          />
        </Animated.View>
      </View>
    </View>
  );
}

export default React.memo(ChatHeader);

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    paddingBottom: 12,
  },
  headerInner: {
    height: 44,
    overflow: 'hidden',
  },
  normalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
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
  headerTitleArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  langBtn: {
    padding: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
