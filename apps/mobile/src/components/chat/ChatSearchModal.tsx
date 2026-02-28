import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInUp,
  SlideOutUp,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { searchChatMessages, type SearchResultItem } from '../../services/api';
import { useTheme } from '../../contexts/ThemeContext';

// ── Props ────────────────────────────────────────────────────────────────────

interface ChatSearchModalProps {
  visible: boolean;
  groupId: string;
  onClose: () => void;
  /** Called when the user taps a search result — the parent should scroll to and
   *  highlight this message in the FlatList. */
  onGoToMessage: (messageId: string) => void;
}

// ── Content-type icon helper ─────────────────────────────────────────────────

const CONTENT_TYPE_META: Record<
  string,
  { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }
> = {
  TEXT: { icon: 'chatbubble-outline', label: 'Message' },
  AUDIO: { icon: 'mic-outline', label: 'Voice' },
  IMAGE: { icon: 'image-outline', label: 'Image' },
  DOCUMENT: { icon: 'document-outline', label: 'Document' },
};

// ── Headline renderer ────────────────────────────────────────────────────────
// The server wraps matching terms in << >> markers. We render them as
// highlighted <Text> spans.

function HighlightedText({
  text,
  highlightColor,
  highlightTextColor,
  baseTextColor,
}: {
  text: string;
  highlightColor: string;
  highlightTextColor: string;
  baseTextColor: string;
}) {
  // Split on <<…>> markers
  const parts = text.split(/(<<.*?>>)/g);
  return (
    <Text style={{ color: baseTextColor, fontSize: 14, lineHeight: 20 }}>
      {parts.map((part, i) => {
        if (part.startsWith('<<') && part.endsWith('>>')) {
          const inner = part.slice(2, -2);
          return (
            <Text
              key={i}
              style={{
                backgroundColor: highlightColor,
                color: highlightTextColor,
                fontWeight: '700',
                borderRadius: 2,
              }}
            >
              {inner}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

// ── Relative time helper ─────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ChatSearchModal({
  visible,
  groupId,
  onClose,
  onGoToMessage,
}: ChatSearchModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Debounce timer
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus the input when modal opens
  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // Reset state on close
      setQuery('');
      setResults([]);
      setTotal(0);
      setPage(1);
      setHasSearched(false);
    }
  }, [visible]);

  // Debounced search
  useEffect(() => {
    if (!visible) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setTotal(0);
      setPage(1);
      setHasSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      setHasSearched(true);
      try {
        const res = await searchChatMessages(groupId, trimmed, 1, 20);
        setResults(res.results);
        setTotal(res.total);
        setPage(1);
      } catch (err) {
        console.error('[ChatSearch] search failed:', err);
      } finally {
        setIsLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, groupId, visible]);

  // Load more (pagination)
  const handleLoadMore = useCallback(async () => {
    if (isLoading || results.length >= total) return;

    const nextPage = page + 1;
    setIsLoading(true);
    try {
      const res = await searchChatMessages(groupId, query.trim(), nextPage, 20);
      setResults((prev) => [...prev, ...res.results]);
      setPage(nextPage);
    } catch (err) {
      console.error('[ChatSearch] load more failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, results.length, total, page, groupId, query]);

  const handleResultPress = useCallback(
    (item: SearchResultItem) => {
      Keyboard.dismiss();
      onGoToMessage(item.id);
      onClose();
    },
    [onGoToMessage, onClose],
  );

  const handleClearQuery = useCallback(() => {
    setQuery('');
    inputRef.current?.focus();
  }, []);

  const renderResult = useCallback(
    ({ item }: { item: SearchResultItem }) => {
      const meta = CONTENT_TYPE_META[item.contentType] ?? CONTENT_TYPE_META.TEXT;

      return (
        <Pressable
          onPress={() => handleResultPress(item)}
          style={({ pressed }) => [
            styles.resultRow,
            { borderBottomColor: colors.searchResultBorder },
            pressed && { backgroundColor: colors.searchResultActiveBg },
          ]}
        >
          {/* Content type icon */}
          <View
            style={[
              styles.contentTypeIcon,
              { backgroundColor: colors.searchContentTypeBg },
            ]}
          >
            <Ionicons
              name={meta.icon}
              size={18}
              color={colors.searchContentTypeIcon}
            />
          </View>

          {/* Text body */}
          <View style={styles.resultBody}>
            {/* Sender & time */}
            <View style={styles.resultMeta}>
              <Text
                style={[styles.senderName, { color: colors.text }]}
                numberOfLines={1}
              >
                {item.senderName}
              </Text>
              <Text style={[styles.timestamp, { color: colors.searchTimestamp }]}>
                {formatRelativeTime(item.createdAt)}
              </Text>
            </View>

            {/* Headline with highlighted matches */}
            <HighlightedText
              text={item.headline}
              highlightColor={colors.searchHighlight}
              highlightTextColor={colors.searchHighlightText}
              baseTextColor={colors.textSecondary}
            />

            {/* Content type badge */}
            {item.contentType !== 'TEXT' && (
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.typeBadge,
                    { backgroundColor: colors.searchContentTypeBg },
                  ]}
                >
                  <Ionicons
                    name={meta.icon}
                    size={11}
                    color={colors.searchContentTypeIcon}
                  />
                  <Text
                    style={[
                      styles.typeBadgeText,
                      { color: colors.searchContentTypeIcon },
                    ]}
                  >
                    {meta.label}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Chevron */}
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.chevronColor}
            style={{ marginLeft: 4 }}
          />
        </Pressable>
      );
    },
    [colors, handleResultPress],
  );

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: colors.searchModalBg },
      ]}
    >
      {/* Search header */}
      <Animated.View
        entering={SlideInUp.duration(200)}
        exiting={SlideOutUp.duration(200)}
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: colors.headerBg,
          },
        ]}
      >
        <Pressable onPress={onClose} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.headerText} />
        </Pressable>

        <View
          style={[
            styles.searchInputWrapper,
            { backgroundColor: colors.searchBg },
          ]}
        >
          <Ionicons
            name="search"
            size={18}
            color={colors.searchIcon}
            style={{ marginLeft: 10 }}
          />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: colors.searchText }]}
            placeholder="Search messages, voice notes, docs..."
            placeholderTextColor={colors.searchPlaceholder}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={handleClearQuery} hitSlop={8}>
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.searchIcon}
                style={{ marginRight: 10 }}
              />
            </Pressable>
          )}
        </View>
      </Animated.View>

      {/* Results count pill */}
      {hasSearched && !isLoading && total > 0 && (
        <View style={styles.countRow}>
          <View
            style={[styles.countPill, { backgroundColor: colors.searchCountBg }]}
          >
            <Text style={[styles.countText, { color: colors.searchCountText }]}>
              {total} result{total !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
      )}

      {/* Results list */}
      {isLoading && results.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.spinnerColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Searching…
          </Text>
        </View>
      ) : hasSearched && results.length === 0 && !isLoading ? (
        <View style={styles.centered}>
          <Ionicons
            name="search-outline"
            size={52}
            color={colors.emptyIcon}
          />
          <Text style={[styles.emptyTitle, { color: colors.emptyText }]}>
            No results found
          </Text>
          <Text style={[styles.emptyHint, { color: colors.emptyHint }]}>
            Try different keywords or shorter terms
          </Text>
        </View>
      ) : !hasSearched ? (
        <View style={styles.centered}>
          <Ionicons name="search" size={48} color={colors.emptyIcon} />
          <Text style={[styles.emptyTitle, { color: colors.emptyText }]}>
            Search this conversation
          </Text>
          <Text style={[styles.emptyHint, { color: colors.emptyHint }]}>
            Find messages, voice notes & documents{'\n'}by typing keywords
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          renderItem={renderResult}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            isLoading && results.length > 0 ? (
              <View style={styles.footer}>
                <ActivityIndicator size="small" color={colors.spinnerColor} />
              </View>
            ) : null
          }
        />
      )}
    </Animated.View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  backBtn: {
    padding: 4,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingHorizontal: 8,
    paddingVertical: 0,
    height: 40,
  },
  countRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  contentTypeIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  resultBody: {
    flex: 1,
  },
  resultMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  senderName: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  timestamp: {
    fontSize: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 5,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginTop: 4,
  },
  emptyHint: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
