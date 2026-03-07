import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ── Supported language options ───────────────────────────────────────────────
export const LANGUAGE_OPTIONS = [
  { key: 'english', label: 'English' },
  { key: 'singlish', label: 'Singlish' },
  { key: 'tanglish', label: 'Tanglish' },
] as const;

export type PreferredLanguage = typeof LANGUAGE_OPTIONS[number]['key'];

// ── Props ────────────────────────────────────────────────────────────────────
interface LanguagePickerModalProps {
  visible: boolean;
  preferredLanguage: PreferredLanguage;
  onSelect: (lang: PreferredLanguage) => void;
  onClose: () => void;
  colors: Record<string, string>;
}

// ── Component ────────────────────────────────────────────────────────────────
function LanguagePickerModal({
  visible,
  preferredLanguage,
  onSelect,
  onClose,
  colors,
}: LanguagePickerModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.modalOverlay, { backgroundColor: colors.overlayBg }]}
        onPress={onClose}
      >
        <View style={[styles.langPicker, { backgroundColor: colors.langPickerBg }]}>
          <Text
            style={[
              styles.langPickerTitle,
              { color: colors.langPickerTitleColor, borderBottomColor: colors.langPickerBorder },
            ]}
          >
            Chat Language
          </Text>
          {LANGUAGE_OPTIONS.map((opt) => (
            <Pressable
              key={opt.key}
              onPress={() => onSelect(opt.key)}
              style={[
                styles.langOption,
                preferredLanguage === opt.key && { backgroundColor: colors.langOptionActiveBg },
              ]}
            >
              <Text
                style={[
                  styles.langOptionText,
                  { color: colors.langOptionText },
                  preferredLanguage === opt.key && { color: colors.langOptionActiveText, fontWeight: '600' },
                ]}
              >
                {opt.label}
              </Text>
              {preferredLanguage === opt.key && (
                <Ionicons name="checkmark" size={18} color={colors.langOptionActiveText} />
              )}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

export default React.memo(LanguagePickerModal);

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langPicker: {
    borderRadius: 16,
    paddingVertical: 8,
    width: 260,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  langPickerTitle: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  langOptionText: {
    flex: 1,
    fontSize: 16,
  },
});
