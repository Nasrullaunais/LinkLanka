/**
 * PersonalDictionaryScreen — "My Dictionary"
 *
 * Lets users manage their custom slang words / meanings that are
 * injected into the LLM translation prompt for better accuracy.
 *
 * Standalone screen — kept separate from other screens so the team
 * member working on personal context can iterate independently.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { AppStackParamList } from '../navigation/types';
import {
  addPersonalContext,
  deletePersonalContext,
  fetchPersonalContext,
  fetchPersonalContextCount,
  updatePersonalContext,
  type PersonalContextItem,
} from '../services/personalContext';
import { useTheme } from '../contexts/ThemeContext';

type Props = NativeStackScreenProps<AppStackParamList, 'PersonalDictionary'>;

const DIALECT_OPTIONS = [
  { key: 'singlish', label: 'Singlish' },
  { key: 'tanglish', label: 'Tanglish' },
  { key: 'english', label: 'English' },
] as const;

const MAX_WORD_LENGTH = 100;
const MAX_MEANING_LENGTH = 500;

// ── Component ────────────────────────────────────────────────────────────────
export default function PersonalDictionaryScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  // ── State ────────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<PersonalContextItem[]>([]);
  const [count, setCount] = useState(0);
  const [maxEntries, setMaxEntries] = useState(50);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PersonalContextItem | null>(
    null,
  );
  const [wordInput, setWordInput] = useState('');
  const [meaningInput, setMeaningInput] = useState('');
  const [dialectInput, setDialectInput] = useState<string | undefined>(
    undefined,
  );

  // ── Data fetching ────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [items, countData] = await Promise.all([
        fetchPersonalContext(),
        fetchPersonalContextCount(),
      ]);
      setEntries(items);
      setCount(countData.count);
      setMaxEntries(countData.max);
    } catch (err) {
      console.error('[PersonalDictionary] Failed to load:', err);
      Alert.alert('Error', 'Could not load your dictionary. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Modal helpers ────────────────────────────────────────────────────────
  const openAddModal = useCallback(() => {
    setEditingEntry(null);
    setWordInput('');
    setMeaningInput('');
    setDialectInput(undefined);
    setModalVisible(true);
  }, []);

  const openEditModal = useCallback((entry: PersonalContextItem) => {
    setEditingEntry(entry);
    setWordInput(entry.slangWord);
    setMeaningInput(entry.standardMeaning);
    setDialectInput(entry.dialectType ?? undefined);
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditingEntry(null);
  }, []);

  // ── Submit (add or update) ───────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const word = wordInput.trim();
    const meaning = meaningInput.trim();

    if (!word) {
      Alert.alert('Missing word', 'Please enter a word or phrase.');
      return;
    }
    if (!meaning) {
      Alert.alert('Missing meaning', 'Please enter the meaning.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingEntry) {
        // Update existing
        await updatePersonalContext(
          editingEntry.id,
          meaning,
          dialectInput ?? null,
        );
      } else {
        // Add new
        await addPersonalContext(word, meaning, dialectInput);
      }
      closeModal();
      await loadData();
    } catch (err: any) {
      const message =
        err?.response?.data?.message ?? 'Something went wrong. Please try again.';
      Alert.alert('Error', Array.isArray(message) ? message[0] : message);
    } finally {
      setIsSubmitting(false);
    }
  }, [wordInput, meaningInput, dialectInput, editingEntry, closeModal, loadData]);

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    (entry: PersonalContextItem) => {
      Alert.alert(
        'Delete word',
        `Remove "${entry.slangWord}" from your dictionary?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deletePersonalContext(entry.id);
                await loadData();
              } catch (err) {
                console.error('[PersonalDictionary] Delete failed:', err);
                Alert.alert('Error', 'Could not delete the entry.');
              }
            },
          },
        ],
      );
    },
    [loadData],
  );

  // ── Render entry ─────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: PersonalContextItem }) => (
      <Pressable style={[styles.entryRow, { backgroundColor: colors.cardBg }]} onPress={() => openEditModal(item)}>
        <View style={styles.entryContent}>
          <View style={styles.entryHeader}>
            <Text style={[styles.entryWord, { color: colors.text }]} numberOfLines={1}>
              {item.slangWord}
            </Text>
            {item.dialectType && (
              <View style={[styles.dialectBadge, { backgroundColor: colors.primaryFaded }]}>
                <Text style={[styles.dialectBadgeText, { color: colors.primary }]}>
                  {item.dialectType}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.entryMeaning, { color: colors.textSecondary }]} numberOfLines={2}>
            {item.standardMeaning}
          </Text>
        </View>
        <Pressable
          onPress={() => handleDelete(item)}
          hitSlop={12}
          style={styles.deleteBtn}
        >
          <Ionicons name="trash-outline" size={20} color={colors.destructive} />
        </Pressable>
      </Pressable>
    ),
    [openEditModal, handleDelete, colors],
  );

  // ── Empty state ──────────────────────────────────────────────────────────
  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="book-outline" size={64} color={colors.emptyIcon} />
        <Text style={[styles.emptyTitle, { color: colors.emptyText }]}>No words yet</Text>
        <Text style={[styles.emptySubtitle, { color: colors.emptyText }]}>
          Add words or slang that you use.{'\n'}This helps translations
          understand you better.
        </Text>
      </View>
    );
  }, [isLoading, colors]);

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.headerBg }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.headerText} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.headerText }]}>My Dictionary</Text>
        <View style={[styles.counterBadge, { backgroundColor: colors.headerAvatarBg }]}>
          <Text style={[styles.counterText, { color: colors.headerText }]}>
            {count}/{maxEntries}
          </Text>
        </View>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.spinnerColor} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={[
            styles.listContent,
            entries.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Add button */}
      {!isLoading && (
        <Pressable
          style={[styles.fab, { bottom: insets.bottom + 20, backgroundColor: colors.fabBg, shadowColor: colors.fabShadow }]}
          onPress={openAddModal}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      )}

      {/* ── Add / Edit Modal ──────────────────────────────────────────────── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.modalOverlay, { backgroundColor: colors.overlayBg }]}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.modalBg }]}>
            {/* Modal header */}
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {editingEntry ? 'Edit Word' : 'Add Word'}
              </Text>
              <Pressable onPress={closeModal} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            {/* Word input */}
            <Text style={[styles.label, { color: colors.modalText }]}>Word or Phrase</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.inputText },
                editingEntry != null && [styles.inputDisabled, { backgroundColor: colors.surface, color: colors.textTertiary }],
              ]}
              value={wordInput}
              onChangeText={setWordInput}
              placeholder='e.g. "machan"'
              placeholderTextColor={colors.inputPlaceholder}
              maxLength={MAX_WORD_LENGTH}
              autoCapitalize="none"
              editable={editingEntry == null}
            />
            <Text style={[styles.charCounter, { color: colors.textTertiary }]}>
              {wordInput.length}/{MAX_WORD_LENGTH}
            </Text>

            {/* Meaning input */}
            <Text style={[styles.label, { color: colors.modalText }]}>Meaning</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.inputText }]}
              value={meaningInput}
              onChangeText={setMeaningInput}
              placeholder='e.g. "friend / buddy"'
              placeholderTextColor={colors.inputPlaceholder}
              maxLength={MAX_MEANING_LENGTH}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <Text style={[styles.charCounter, { color: colors.textTertiary }]}>
              {meaningInput.length}/{MAX_MEANING_LENGTH}
            </Text>

            {/* Dialect chips */}
            <Text style={[styles.label, { color: colors.modalText }]}>Dialect (optional)</Text>
            <View style={styles.dialectRow}>
              {DIALECT_OPTIONS.map((d) => (
                <Pressable
                  key={d.key}
                  onPress={() =>
                    setDialectInput(dialectInput === d.key ? undefined : d.key)
                  }
                  style={[
                    styles.dialectChip,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                    dialectInput === d.key && [styles.dialectChipSelected, { borderColor: colors.primary, backgroundColor: colors.primaryFaded }],
                  ]}
                >
                  <Text
                    style={[
                      styles.dialectChipText,
                      { color: colors.textSecondary },
                      dialectInput === d.key && [styles.dialectChipTextSelected, { color: colors.primary }],
                    ]}
                  >
                    {d.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Submit button */}
            <Pressable
              onPress={handleSubmit}
              disabled={isSubmitting}
              style={({ pressed }) => [
                styles.submitBtn,
                { backgroundColor: colors.primary },
                pressed && styles.submitBtnPressed,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>
                  {editingEntry ? 'Save Changes' : 'Add Word'}
                </Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  counterBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterText: { fontSize: 13, fontWeight: '600' },

  // Loading
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // List
  listContent: { padding: 16, paddingBottom: 100 },
  listContentEmpty: { flexGrow: 1 },

  // Entry row
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  entryContent: { flex: 1, marginRight: 12 },
  entryHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  entryWord: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  dialectBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 8,
  },
  dialectBadgeText: { fontSize: 11, fontWeight: '600' },
  entryMeaning: { fontSize: 14, lineHeight: 20 },
  deleteBtn: { padding: 6 },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },

  // Form
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  inputMultiline: {
    minHeight: 80,
    paddingTop: 12,
  },
  inputDisabled: {},

  charCounter: {
    fontSize: 11,
    alignSelf: 'flex-end',
    marginBottom: 8,
    marginTop: 2,
  },
  dialectRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  dialectChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  dialectChipSelected: {},
  dialectChipText: { fontSize: 13, fontWeight: '500' },
  dialectChipTextSelected: { fontWeight: '700' },

  // Submit
  submitBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitBtnPressed: { opacity: 0.85 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
