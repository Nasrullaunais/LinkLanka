/**
 * PersonalDictionaryScreen
 *
 * Language-scoped personal dictionary management:
 * - 50 entries per language (Singlish, English, Tanglish)
 * - 150 total entries across all language buckets
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  PERSONAL_CONTEXT_DIALECT_LABELS,
  PERSONAL_CONTEXT_DIALECTS,
  updatePersonalContext,
  type PersonalContextCount,
  type PersonalContextDialect,
  type PersonalContextItem,
} from '../services/personalContext';
import { getApiErrorMessage } from '../utils/auth';
import { useTheme } from '../contexts/ThemeContext';

type Props = NativeStackScreenProps<AppStackParamList, 'PersonalDictionary'>;

const MAX_WORD_LENGTH = 100;
const MAX_MEANING_LENGTH = 500;
const FALLBACK_MAX_PER_LANGUAGE = 50;
const FALLBACK_TOTAL_MAX = FALLBACK_MAX_PER_LANGUAGE * PERSONAL_CONTEXT_DIALECTS.length;

function normalizeDialect(value: string | null | undefined): PersonalContextDialect {
  if (!value) return 'english';
  const normalized = value.toLowerCase();
  if (PERSONAL_CONTEXT_DIALECTS.includes(normalized as PersonalContextDialect)) {
    return normalized as PersonalContextDialect;
  }
  return 'english';
}

function buildFallbackCount(items: PersonalContextItem[]): PersonalContextCount {
  const perLanguage = {
    singlish: { count: 0, max: FALLBACK_MAX_PER_LANGUAGE, remaining: FALLBACK_MAX_PER_LANGUAGE },
    english: { count: 0, max: FALLBACK_MAX_PER_LANGUAGE, remaining: FALLBACK_MAX_PER_LANGUAGE },
    tanglish: { count: 0, max: FALLBACK_MAX_PER_LANGUAGE, remaining: FALLBACK_MAX_PER_LANGUAGE },
  };

  for (const item of items) {
    const dialect = normalizeDialect(item.dialectType);
    perLanguage[dialect].count += 1;
  }

  let totalCount = 0;
  for (const dialect of PERSONAL_CONTEXT_DIALECTS) {
    totalCount += perLanguage[dialect].count;
    perLanguage[dialect].remaining = Math.max(0, perLanguage[dialect].max - perLanguage[dialect].count);
  }

  return {
    count: totalCount,
    max: FALLBACK_TOTAL_MAX,
    totalCount,
    totalMax: FALLBACK_TOTAL_MAX,
    perLanguage,
  };
}

function normalizeCountPayload(
  payload: PersonalContextCount,
  items: PersonalContextItem[],
): PersonalContextCount {
  const fallback = buildFallbackCount(items);
  const maybePerLanguage = payload?.perLanguage;

  if (!maybePerLanguage) {
    return fallback;
  }

  const perLanguage = {
    singlish: {
      count: Number(maybePerLanguage.singlish?.count ?? 0),
      max: Number(maybePerLanguage.singlish?.max ?? FALLBACK_MAX_PER_LANGUAGE),
      remaining: Number(
        maybePerLanguage.singlish?.remaining ??
          Math.max(0, FALLBACK_MAX_PER_LANGUAGE - Number(maybePerLanguage.singlish?.count ?? 0)),
      ),
    },
    english: {
      count: Number(maybePerLanguage.english?.count ?? 0),
      max: Number(maybePerLanguage.english?.max ?? FALLBACK_MAX_PER_LANGUAGE),
      remaining: Number(
        maybePerLanguage.english?.remaining ??
          Math.max(0, FALLBACK_MAX_PER_LANGUAGE - Number(maybePerLanguage.english?.count ?? 0)),
      ),
    },
    tanglish: {
      count: Number(maybePerLanguage.tanglish?.count ?? 0),
      max: Number(maybePerLanguage.tanglish?.max ?? FALLBACK_MAX_PER_LANGUAGE),
      remaining: Number(
        maybePerLanguage.tanglish?.remaining ??
          Math.max(0, FALLBACK_MAX_PER_LANGUAGE - Number(maybePerLanguage.tanglish?.count ?? 0)),
      ),
    },
  };

  const totalCount = Number(payload.totalCount ?? payload.count ?? fallback.totalCount);
  const totalMax = Number(payload.totalMax ?? payload.max ?? fallback.totalMax);

  return {
    count: totalCount,
    max: totalMax,
    totalCount,
    totalMax,
    perLanguage,
  };
}

export default function PersonalDictionaryScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [entries, setEntries] = useState<PersonalContextItem[]>([]);
  const [countSummary, setCountSummary] = useState<PersonalContextCount>(
    buildFallbackCount([]),
  );
  const [activeDialect, setActiveDialect] = useState<PersonalContextDialect>('singlish');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PersonalContextItem | null>(null);
  const [wordInput, setWordInput] = useState('');
  const [meaningInput, setMeaningInput] = useState('');
  const [dialectInput, setDialectInput] = useState<PersonalContextDialect>('singlish');
  const [submitError, setSubmitError] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [items, countData] = await Promise.all([
        fetchPersonalContext(),
        fetchPersonalContextCount(),
      ]);

      const normalizedItems: PersonalContextItem[] = items.map((item) => ({
        ...item,
        dialectType: normalizeDialect(item.dialectType),
      }));

      setEntries(normalizedItems);
      setCountSummary(normalizeCountPayload(countData, normalizedItems));
    } catch (error) {
      Alert.alert(
        'Error',
        getApiErrorMessage(error, 'Could not load your dictionary. Please try again.'),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredEntries = useMemo(
    () => entries.filter((item) => normalizeDialect(item.dialectType) === activeDialect),
    [entries, activeDialect],
  );

  const activeBucket = countSummary.perLanguage[activeDialect];
  const activeLanguageLabel = PERSONAL_CONTEXT_DIALECT_LABELS[activeDialect];
  const isActiveBucketFull = activeBucket.count >= activeBucket.max;

  const openAddModal = useCallback(() => {
    if (isActiveBucketFull) {
      Alert.alert(
        `${activeLanguageLabel} bucket is full`,
        `You can save up to ${activeBucket.max} ${activeLanguageLabel} entries. Delete one before adding a new entry.`,
      );
      return;
    }

    setEditingEntry(null);
    setWordInput('');
    setMeaningInput('');
    setDialectInput(activeDialect);
    setSubmitError('');
    setModalVisible(true);
  }, [activeBucket.max, activeDialect, activeLanguageLabel, isActiveBucketFull]);

  const openEditModal = useCallback((entry: PersonalContextItem) => {
    const normalizedDialect = normalizeDialect(entry.dialectType);
    setEditingEntry({ ...entry, dialectType: normalizedDialect });
    setWordInput(entry.slangWord);
    setMeaningInput(entry.standardMeaning);
    setDialectInput(normalizedDialect);
    setSubmitError('');
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditingEntry(null);
    setSubmitError('');
  }, []);

  const duplicateInTargetLanguage = useMemo(() => {
    const normalizedWord = wordInput.trim().toLowerCase();
    if (!normalizedWord) return null;

    return (
      entries.find((entry) => {
        if (editingEntry && entry.id === editingEntry.id) {
          return false;
        }

        const sameDialect = normalizeDialect(entry.dialectType) === dialectInput;
        const sameWord = entry.slangWord.trim().toLowerCase() === normalizedWord;
        return sameDialect && sameWord;
      }) ?? null
    );
  }, [entries, editingEntry, wordInput, dialectInput]);

  const targetBucket = countSummary.perLanguage[dialectInput];
  const editingDialect = editingEntry ? normalizeDialect(editingEntry.dialectType) : null;
  const isChangingDialect = !!editingEntry && editingDialect !== dialectInput;
  const isTargetBucketFullForSubmit =
    targetBucket.count >= targetBucket.max && (!editingEntry || isChangingDialect);

  const validationError = useMemo(() => {
    const word = wordInput.trim();
    const meaning = meaningInput.trim();

    if (!word) return 'Enter a word or phrase.';
    if (!meaning) return 'Enter the meaning.';
    if (word.length > MAX_WORD_LENGTH) {
      return `Word must be at most ${MAX_WORD_LENGTH} characters.`;
    }
    if (meaning.length > MAX_MEANING_LENGTH) {
      return `Meaning must be at most ${MAX_MEANING_LENGTH} characters.`;
    }

    if (duplicateInTargetLanguage) {
      return `"${word}" already exists in ${PERSONAL_CONTEXT_DIALECT_LABELS[dialectInput]}.`;
    }

    if (isTargetBucketFullForSubmit) {
      return `${PERSONAL_CONTEXT_DIALECT_LABELS[dialectInput]} is full (${targetBucket.max}/${targetBucket.max}). Delete one entry before saving.`;
    }

    return '';
  }, [
    dialectInput,
    duplicateInTargetLanguage,
    isTargetBucketFullForSubmit,
    meaningInput,
    targetBucket.max,
    wordInput,
  ]);

  const helperMessage = submitError || validationError;
  const submitDisabled = isSubmitting || validationError.length > 0;

  const handleSubmit = useCallback(async () => {
    const word = wordInput.trim();
    const meaning = meaningInput.trim();

    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');

    try {
      if (editingEntry) {
        await updatePersonalContext(editingEntry.id, meaning, dialectInput);
      } else {
        await addPersonalContext(word, meaning, dialectInput);
      }

      closeModal();
      await loadData();
    } catch (error) {
      setSubmitError(
        getApiErrorMessage(error, 'Could not save this dictionary entry. Please try again.'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    closeModal,
    dialectInput,
    editingEntry,
    loadData,
    meaningInput,
    validationError,
    wordInput,
  ]);

  const handleDelete = useCallback(
    (entry: PersonalContextItem) => {
      Alert.alert(
        'Delete entry',
        `Remove "${entry.slangWord}" from ${PERSONAL_CONTEXT_DIALECT_LABELS[normalizeDialect(entry.dialectType)]}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deletePersonalContext(entry.id);
                await loadData();
              } catch (error) {
                Alert.alert(
                  'Error',
                  getApiErrorMessage(error, 'Could not delete this dictionary entry.'),
                );
              }
            },
          },
        ],
      );
    },
    [loadData],
  );

  const renderItem = useCallback(
    ({ item }: { item: PersonalContextItem }) => {
      const itemDialect = normalizeDialect(item.dialectType);
      const itemDialectLabel = PERSONAL_CONTEXT_DIALECT_LABELS[itemDialect];

      return (
        <Pressable
          style={[styles.entryRow, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={() => openEditModal(item)}
        >
          <View style={styles.entryContent}>
            <View style={styles.entryHeader}>
              <Text style={[styles.entryWord, { color: colors.text }]} numberOfLines={1}>
                {item.slangWord}
              </Text>
              <View style={[styles.entryLanguageBadge, { backgroundColor: colors.primaryFaded }]}> 
                <Text style={[styles.entryLanguageBadgeText, { color: colors.primary }]}>
                  {itemDialectLabel}
                </Text>
              </View>
            </View>
            <Text style={[styles.entryMeaning, { color: colors.textSecondary }]} numberOfLines={2}>
              {item.standardMeaning}
            </Text>
          </View>

          <Pressable
            onPress={() => handleDelete(item)}
            hitSlop={10}
            style={styles.deleteButton}
          >
            <Ionicons name="trash-outline" size={20} color={colors.destructive} />
          </Pressable>
        </Pressable>
      );
    },
    [colors, handleDelete, openEditModal],
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="book-outline" size={64} color={colors.emptyIcon} />
        <Text style={[styles.emptyTitle, { color: colors.emptyText }]}>
          No {activeLanguageLabel} entries yet
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.emptyText }]}> 
          Save frequently used {activeLanguageLabel.toLowerCase()} words and phrases so translations stay accurate and personal.
        </Text>
      </View>
    );
  }, [activeLanguageLabel, colors.emptyIcon, colors.emptyText, isLoading]);

  const listHeader = (
    <View style={styles.listHeaderContainer}>
      <View style={[styles.totalCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}> 
        <View style={styles.totalCardTopRow}>
          <Text style={[styles.totalCardTitle, { color: colors.text }]}>Total Capacity</Text>
          <Text style={[styles.totalCardValue, { color: colors.primary }]}> 
            {countSummary.totalCount}/{countSummary.totalMax}
          </Text>
        </View>
        <Text style={[styles.totalCardSubtitle, { color: colors.textSecondary }]}> 
          50 entries per language bucket. You can store up to 150 entries in total.
        </Text>
      </View>

      <View style={styles.languageTabsRow}>
        {PERSONAL_CONTEXT_DIALECTS.map((dialect) => {
          const languageCount = countSummary.perLanguage[dialect];
          const selected = dialect === activeDialect;
          const isFull = languageCount.count >= languageCount.max;

          return (
            <Pressable
              key={dialect}
              onPress={() => setActiveDialect(dialect)}
              style={[
                styles.languageTab,
                {
                  backgroundColor: selected ? colors.primaryFaded : colors.surface,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.languageTabLabel,
                  { color: selected ? colors.primary : colors.textSecondary },
                ]}
              >
                {PERSONAL_CONTEXT_DIALECT_LABELS[dialect]}
              </Text>
              <Text style={[styles.languageTabCount, { color: selected ? colors.primary : colors.text }]}> 
                {languageCount.count}/{languageCount.max}
              </Text>
              <Text
                style={[
                  styles.languageTabHint,
                  { color: isFull ? colors.destructive : colors.textTertiary },
                ]}
              >
                {isFull ? 'Full' : `${languageCount.remaining} left`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}> 
        {activeLanguageLabel} Entries
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}> 
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 12, backgroundColor: colors.headerBg },
        ]}
      >
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.headerText} />
        </Pressable>

        <Text style={[styles.headerTitle, { color: colors.headerText }]}>My Dictionary</Text>

        <View style={[styles.headerCounter, { backgroundColor: colors.headerAvatarBg }]}> 
          <Text style={[styles.headerCounterText, { color: colors.headerText }]}> 
            {countSummary.totalCount}/{countSummary.totalMax}
          </Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.spinnerColor} />
        </View>
      ) : (
        <FlatList
          data={filteredEntries}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={[
            styles.listContent,
            filteredEntries.length === 0 && styles.listContentEmpty,
            { paddingBottom: insets.bottom + 120 },
          ]}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={7}
        />
      )}

      {!isLoading && (
        <View
          style={[
            styles.bottomActionContainer,
            {
              backgroundColor: colors.background,
              paddingBottom: Math.max(12, insets.bottom + 4),
            },
          ]}
        >
          <Pressable
            onPress={openAddModal}
            disabled={isActiveBucketFull}
            style={[
              styles.addButton,
              {
                backgroundColor: isActiveBucketFull ? colors.border : colors.primary,
                borderColor: isActiveBucketFull ? colors.border : colors.primary,
              },
            ]}
          >
            <Ionicons
              name={isActiveBucketFull ? 'alert-circle-outline' : 'add-circle-outline'}
              size={18}
              color={isActiveBucketFull ? colors.textSecondary : '#fff'}
            />
            <Text
              style={[
                styles.addButtonText,
                { color: isActiveBucketFull ? colors.textSecondary : '#fff' },
              ]}
            >
              {isActiveBucketFull
                ? `${activeLanguageLabel} bucket full (${activeBucket.max}/${activeBucket.max})`
                : `Add ${activeLanguageLabel} entry`}
            </Text>
          </Pressable>
        </View>
      )}

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
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}> 
                {editingEntry ? 'Edit Dictionary Entry' : 'Add Dictionary Entry'}
              </Text>
              <Pressable onPress={closeModal} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={[styles.label, { color: colors.modalText }]}>Language</Text>
            <View style={styles.modalDialectRow}>
              {PERSONAL_CONTEXT_DIALECTS.map((dialect) => {
                const selected = dialect === dialectInput;
                return (
                  <Pressable
                    key={dialect}
                    onPress={() => {
                      setDialectInput(dialect);
                      if (submitError) setSubmitError('');
                    }}
                    style={[
                      styles.modalDialectChip,
                      {
                        backgroundColor: selected ? colors.primaryFaded : colors.surface,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalDialectChipText,
                        { color: selected ? colors.primary : colors.textSecondary },
                      ]}
                    >
                      {PERSONAL_CONTEXT_DIALECT_LABELS[dialect]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.bucketHint, { color: colors.textTertiary }]}> 
              {PERSONAL_CONTEXT_DIALECT_LABELS[dialectInput]} bucket: {targetBucket.count}/{targetBucket.max} used
            </Text>

            <Text style={[styles.label, { color: colors.modalText }]}>Word or Phrase</Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBg,
                  borderColor: colors.border,
                  color: colors.inputText,
                },
                editingEntry != null && {
                  backgroundColor: colors.surface,
                  color: colors.textTertiary,
                },
              ]}
              value={wordInput}
              onChangeText={(value) => {
                setWordInput(value);
                if (submitError) setSubmitError('');
              }}
              placeholder="e.g. machan"
              placeholderTextColor={colors.inputPlaceholder}
              maxLength={MAX_WORD_LENGTH}
              autoCapitalize="none"
              editable={editingEntry == null}
            />
            <Text style={[styles.charCounter, { color: colors.textTertiary }]}> 
              {wordInput.length}/{MAX_WORD_LENGTH}
            </Text>
            {editingEntry ? (
              <Text style={[styles.immutableHint, { color: colors.textTertiary }]}> 
                Word cannot be changed after creation.
              </Text>
            ) : null}

            <Text style={[styles.label, { color: colors.modalText }]}>Meaning</Text>
            <TextInput
              style={[
                styles.input,
                styles.multilineInput,
                {
                  backgroundColor: colors.inputBg,
                  borderColor: colors.border,
                  color: colors.inputText,
                },
              ]}
              value={meaningInput}
              onChangeText={(value) => {
                setMeaningInput(value);
                if (submitError) setSubmitError('');
              }}
              placeholder="e.g. friend / buddy"
              placeholderTextColor={colors.inputPlaceholder}
              maxLength={MAX_MEANING_LENGTH}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <Text style={[styles.charCounter, { color: colors.textTertiary }]}> 
              {meaningInput.length}/{MAX_MEANING_LENGTH}
            </Text>

            {helperMessage ? (
              <Text style={[styles.formErrorText, { color: colors.destructive }]}> 
                {helperMessage}
              </Text>
            ) : null}

            <Pressable
              onPress={handleSubmit}
              disabled={submitDisabled}
              style={[
                styles.submitButton,
                {
                  backgroundColor: submitDisabled ? colors.border : colors.primary,
                },
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text
                  style={[
                    styles.submitButtonText,
                    { color: submitDisabled ? colors.textSecondary : '#fff' },
                  ]}
                >
                  {editingEntry ? 'Save Changes' : 'Add Entry'}
                </Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerCounter: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  headerCounterText: { fontSize: 13, fontWeight: '700' },

  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  listContent: {
    padding: 16,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  listHeaderContainer: {
    marginBottom: 8,
  },

  totalCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  totalCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalCardTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  totalCardValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  totalCardSubtitle: {
    fontSize: 12,
    lineHeight: 18,
  },

  languageTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  languageTab: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  languageTabLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  languageTabCount: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  languageTabHint: {
    fontSize: 11,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  entryContent: {
    flex: 1,
    marginRight: 10,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  entryWord: {
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  entryLanguageBadge: {
    borderRadius: 8,
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  entryLanguageBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  entryMeaning: {
    fontSize: 14,
    lineHeight: 20,
  },
  deleteButton: {
    padding: 4,
  },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },

  bottomActionContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  addButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },

  label: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalDialectRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  modalDialectChip: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  modalDialectChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  bucketHint: {
    fontSize: 12,
    marginBottom: 12,
  },

  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 86,
    paddingTop: 12,
  },
  charCounter: {
    alignSelf: 'flex-end',
    fontSize: 11,
    marginTop: 4,
    marginBottom: 8,
  },
  immutableHint: {
    fontSize: 11,
    marginBottom: 10,
  },
  formErrorText: {
    fontSize: 13,
    marginBottom: 12,
  },

  submitButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
