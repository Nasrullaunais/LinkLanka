import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';

interface EditMessageBarProps {
  /** The current text of the message being edited */
  initialText: string;
  /** Called when the user cancels editing */
  onCancel: () => void;
  /** Called with the trimmed new text when the user confirms the edit */
  onConfirm: (newText: string) => void;
}

const MAX_LENGTH = 2000;

export default function EditMessageBar({
  initialText,
  onCancel,
  onConfirm,
}: EditMessageBarProps) {
  const [text, setText] = useState(initialText);
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const { colors } = useTheme();

  // Auto-focus when the bar mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 80);
    return () => clearTimeout(timer);
  }, []);

  const trimmed = text.trim();
  const charCount = text.length;
  const isOverLimit = charCount > MAX_LENGTH;
  const isEmpty = trimmed.length === 0;
  const isUnchanged = trimmed === initialText.trim();
  const canConfirm = !isEmpty && !isOverLimit && !isUnchanged;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(trimmed);
  };

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom + 6, backgroundColor: colors.inputWrapperBg, borderTopColor: colors.border }]}>
      {/* ── Amber "editing" banner ── */}
      <View style={[styles.banner, { backgroundColor: colors.editBarBg, borderLeftColor: colors.primary }]}>
        <Ionicons name="pencil" size={14} color={colors.editBarText} style={styles.bannerIcon} />
        <Text style={[styles.bannerText, { color: colors.editBarText }]}>Editing message</Text>
        <Pressable onPress={onCancel} hitSlop={12} style={styles.bannerClose}>
          <Ionicons name="close-circle" size={20} color={colors.editBarText} />
        </Pressable>
      </View>

      {/* ── Character count warning ── */}
      {charCount > 1800 && (
        <View style={styles.charRow}>
          <Text style={[styles.charCount, { color: colors.textTertiary }, isOverLimit && styles.charCountOver]}>
            {charCount} / {MAX_LENGTH}
          </Text>
        </View>
      )}

      {/* ── Input row ── */}
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          style={[styles.input, { backgroundColor: colors.inputBg, color: colors.inputText }]}
          multiline
          maxLength={MAX_LENGTH + 10} // allow slight overflow so user sees the count
          placeholderTextColor={colors.inputPlaceholder}
          placeholder="Edit your message…"
          returnKeyType="default"
        />

        <Pressable
          onPress={handleConfirm}
          disabled={!canConfirm}
          style={[styles.confirmBtn, { backgroundColor: colors.primary }, !canConfirm && { backgroundColor: colors.primaryLight, opacity: 0.5 }]}
          hitSlop={6}
        >
          <Ionicons name="checkmark" size={22} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  // Amber banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 3,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
  },
  bannerIcon: {
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  bannerClose: {
    padding: 2,
  },

  // Character count
  charRow: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  charCount: {
    fontSize: 12,
    textAlign: 'right',
  },
  charCountOver: {
    color: '#ef4444',
    fontWeight: '600',
  },

  // Input area
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 120,
    lineHeight: 20,
  },
  confirmBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
