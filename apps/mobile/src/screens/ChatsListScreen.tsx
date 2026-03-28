import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  fetchGroups,
  searchUsers,
  createDm,
  type GroupItem,
  type UserItem,
} from '../services/api';
import type { AppStackParamList } from '../navigation/types';

type AppNav = NativeStackNavigationProp<AppStackParamList>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

const Avatar = memo(function Avatar({
  pictureUrl,
  name,
  size = 46,
  fallbackBg,
}: {
  pictureUrl?: string | null;
  name: string;
  size?: number;
  fallbackBg?: string;
}) {
  const borderRadius = size / 2;
  if (pictureUrl) {
    return (
      <Image
        source={{ uri: pictureUrl }}
        style={{ width: size, height: size, borderRadius }}
        contentFit="cover"
        transition={200}
        recyclingKey={pictureUrl}
      />
    );
  }
  return (
    <View style={[{ width: size, height: size, borderRadius, backgroundColor: fallbackBg ?? '#6366f1' }, styles.avatarFallback]}>
      <Text style={[styles.avatarInitials, { fontSize: size * 0.35 }]}>
        {getInitials(name)}
      </Text>
    </View>
  );
});

// ── Memoized row components (prevent re-renders when parent state changes) ──

const DmRow = memo(function DmRow({
  item,
  onPress,
  colors,
}: {
  item: GroupItem;
  onPress: (item: GroupItem) => void;
  colors: any;
}) {
  const other = item.otherUser;
  const name = other?.displayName ?? 'Unknown';
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.rowBorder }, pressed && { backgroundColor: colors.rowPressed }]}
    >
      <Avatar pictureUrl={other?.profilePictureUrl} name={name} fallbackBg={colors.avatarFallbackBg} />
      <View style={styles.rowContent}>
        <Text style={[styles.chatName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
        {item.lastMessageAt && (
          <Text style={[styles.subText, { color: colors.textSecondary }]}>{formatRelativeTime(item.lastMessageAt)}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.chevronColor} />
    </Pressable>
  );
});

const GroupRow = memo(function GroupRow({
  item,
  onPress,
  colors,
}: {
  item: GroupItem;
  onPress: (item: GroupItem) => void;
  colors: any;
}) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.rowBorder }, pressed && { backgroundColor: colors.rowPressed }]}
    >
      <View style={[styles.groupAvatar, { backgroundColor: colors.groupAvatarBg }]}>
        <Ionicons name="people" size={22} color="#fff" />
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.chatName, { color: colors.text }]} numberOfLines={1}>{item.name ?? 'Unnamed group'}</Text>
        <Text style={[styles.subText, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.memberCount ?? 0} member{item.memberCount !== 1 ? 's' : ''}
          {item.lastMessageAt ? ` · ${formatRelativeTime(item.lastMessageAt)}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.chevronColor} />
    </Pressable>
  );
});

const UserRow = memo(function UserRow({
  item,
  onPress,
  colors,
}: {
  item: UserItem;
  onPress: (item: UserItem) => void;
  colors: any;
}) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.rowBorder }, pressed && { backgroundColor: colors.rowPressed }]}
    >
      <Avatar pictureUrl={item.profilePictureUrl} name={item.displayName} fallbackBg={colors.avatarFallbackBg} />
      <View style={styles.rowContent}>
        <Text style={[styles.chatName, { color: colors.text }]} numberOfLines={1}>{item.displayName}</Text>
        <Text style={[styles.subText, { color: colors.textSecondary }]} numberOfLines={1}>{item.nativeDialect}</Text>
      </View>
      <Ionicons name="chatbubble-outline" size={18} color={colors.chevronColor} />
    </Pressable>
  );
});

// ── Component ────────────────────────────────────────────────────────────────
export default function ChatsListScreen() {
  const navigation = useNavigation<AppNav>();
  const { logout, userDisplayName, userDialect, userProfilePicture } = useAuth();
  const { socket, isConnected } = useSocket();
  const { isDark, colors, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load groups ──────────────────────────────────────────────────────────
  const loadGroups = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setIsLoading(true);
      setLoadError(false);
    }

    try {
      const data = await fetchGroups();
      setGroups(data);
    } catch {
      if (!silent) {
        setLoadError(true);
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  const scheduleRealtimeRefresh = useCallback(() => {
    if (realtimeRefreshRef.current) return;

    realtimeRefreshRef.current = setTimeout(() => {
      realtimeRefreshRef.current = null;
      void loadGroups({ silent: true });
    }, 220);
  }, [loadGroups]);

  useEffect(() => {
    return () => {
      if (realtimeRefreshRef.current) {
        clearTimeout(realtimeRefreshRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleConversationUpdated = () => {
      scheduleRealtimeRefresh();
    };

    socket.on('conversationUpdated', handleConversationUpdated);

    // Catch up immediately after reconnect in case an event was missed.
    scheduleRealtimeRefresh();

    return () => {
      socket.off('conversationUpdated', handleConversationUpdated);
    };
  }, [socket, isConnected, scheduleRealtimeRefresh]);

  // Safety-net: fire loadGroups on mount regardless of navigation focus state.
  // On first login the entire navigator tree is created from scratch while the
  // auth async chain is still running.  React Navigation's useFocusEffect checks
  // navigation.isFocused() in a useEffect, but during that brief initialization
  // window isFocused() can return false, causing the initial load to be skipped
  // and isLoading to stay true forever.  A plain useEffect always fires on mount.
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    // Mark that the mount-time load has been requested so the useFocusEffect
    // below does not duplicate it when it also fires on initial mount.
    if (!initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true;
      loadGroups();
    }
  }, [loadGroups]);

  // Re-load whenever the user returns to this screen from a nested screen
  // (e.g. navigating back from a chat).  Skip the very first firing on mount
  // because useEffect above already handles that.
  useFocusEffect(
    useCallback(() => {
      if (!initialLoadDoneRef.current) {
        // useFocusEffect fired before useEffect — let it handle the initial load
        // and prevent useEffect from duplicating it.
        initialLoadDoneRef.current = true;
        loadGroups();
        return;
      }
      // Subsequent focus events (returning from a chat screen, etc.).
      loadGroups();
    }, [loadGroups]),
  );

  // ── Debounced user search ────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchUsers(query);
        setSearchResults(results);
      } catch {
        setIsSearching(false);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // ── Navigation helpers ───────────────────────────────────────────────────
  // Keep list performance high: do not prefetch chat history from this screen.
  // Message loading should happen only inside ChatScreen/useChatMessages.
  const openGroupChat = useCallback(
    (item: GroupItem) => {
      navigation.navigate('Chat', {
        groupId: item.id,
        groupName: item.name ?? 'Group',
        isDm: false,
        preferredLanguage: item.preferredLanguage,
      });
    },
    [navigation],
  );

  const openDmChat = useCallback(
    (item: GroupItem) => {
      navigation.navigate('Chat', {
        groupId: item.id,
        groupName: item.otherUser?.displayName ?? 'Chat',
        isDm: true,
        preferredLanguage: item.preferredLanguage,
        otherUserPicture: item.otherUser?.profilePictureUrl,
        otherUserId: item.otherUser?.id,
      });
    },
    [navigation],
  );

  const openOrCreateDm = useCallback(
    async (user: UserItem) => {
      setSearchQuery('');
      try {
        const group = await createDm(user.id);
        navigation.navigate('Chat', {
          groupId: group.id,
          groupName: user.displayName,
          isDm: true,
          preferredLanguage: group.preferredLanguage,
          otherUserPicture: user.profilePictureUrl,
          otherUserId: user.id,
        });
      } catch (err) {
        console.error('[ChatsListScreen] Failed to open DM:', err);
      }
    },
    [navigation],
  );

  // ── Section data ─────────────────────────────────────────────────────────
  const dms = groups.filter((g) => !g.isGroup);
  const groupChats = groups.filter((g) => g.isGroup);

  // ── Render helpers ───────────────────────────────────────────────────────
  const renderDmRow = useCallback(
    ({ item }: { item: GroupItem }) => (
      <DmRow item={item} onPress={openDmChat} colors={colors} />
    ),
    [openDmChat, colors],
  );

  const renderGroupRow = useCallback(
    ({ item }: { item: GroupItem }) => (
      <GroupRow item={item} onPress={openGroupChat} colors={colors} />
    ),
    [openGroupChat, colors],
  );

  const renderUserRow = useCallback(
    ({ item }: { item: UserItem }) => (
      <UserRow item={item} onPress={openOrCreateDm} colors={colors} />
    ),
    [openOrCreateDm, colors],
  );

  const isSearchMode = searchQuery.trim().length > 0;

  type Section = { title: 'dm'; data: GroupItem[] } | { title: 'group'; data: GroupItem[] };
  const sections: Section[] = [];
  if (dms.length > 0) sections.push({ title: 'dm', data: dms });
  if (groupChats.length > 0) sections.push({ title: 'group', data: groupChats });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.headerBg }]}>
        <Pressable onPress={() => navigation.navigate('Profile')} hitSlop={12}>
          {userProfilePicture ? (
            <Image source={{ uri: userProfilePicture }} style={styles.headerAvatar} contentFit="cover" transition={200} />
          ) : (
            <View style={[styles.headerAvatar, { backgroundColor: colors.headerAvatarBg }]}>
              <Text style={[styles.headerAvatarInitials, { color: colors.headerText }]}>
                {getInitials(userDisplayName ?? 'Me')}
              </Text>
            </View>
          )}
        </Pressable>
        <View style={styles.headerMeta}>
          <Text style={[styles.headerName, { color: colors.headerText }]} numberOfLines={1}>
            {userDisplayName ?? '...'}
          </Text>
          {userDialect && (
            <View style={[styles.dialectBadge, { backgroundColor: colors.dialectBadgeBg }]}>
              <Text style={[styles.dialectBadgeText, { color: colors.dialectBadgeText }]}>{userDialect}</Text>
            </View>
          )}
        </View>
        {/* Theme toggle */}
        <Pressable onPress={toggleTheme} hitSlop={12} style={styles.themeToggle}>
          <Ionicons name={isDark ? 'sunny' : 'moon'} size={20} color={colors.headerTextSecondary} />
        </Pressable>
        <Pressable onPress={logout} hitSlop={12}>
          <Ionicons name="log-out-outline" size={22} color={colors.headerTextSecondary} />
        </Pressable>
      </View>

      {/* Search bar */}
      <View style={[styles.searchBar, { backgroundColor: colors.searchBg }]}>
        <Ionicons name="search" size={18} color={colors.searchIcon} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.searchText }]}
          placeholder="Search people..."
          placeholderTextColor={colors.searchPlaceholder}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCapitalize="none"
        />
        {isSearching && <ActivityIndicator size="small" color={colors.spinnerColor} />}
      </View>

      {/* Content */}
      {isSearchMode ? (
        searchResults.length === 0 && !isSearching ? (
          <View style={styles.centered}>
            <Ionicons name="person-outline" size={40} color={colors.emptyIcon} />
            <Text style={[styles.emptyText, { color: colors.emptyText }]}>No users found</Text>
          </View>
        ) : (
          <FlatList
            data={searchResults}
            renderItem={renderUserRow}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={7}
          />
        )
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.spinnerColor} />
        </View>
      ) : loadError ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.emptyIcon} />
          <Text style={[styles.emptyText, { color: colors.emptyText }]}>Could not load chats</Text>
          <Pressable onPress={() => { void loadGroups(); }} style={[styles.retryBtn, { backgroundColor: colors.primary }]}> 
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="chatbubbles-outline" size={48} color={colors.emptyIcon} />
          <Text style={[styles.emptyText, { color: colors.emptyText }]}>No conversations yet</Text>
          <Text style={[styles.emptyHint, { color: colors.emptyHint }]}>Search for someone to start chatting</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item, section }) =>
            section.title === 'dm'
              ? renderDmRow({ item })
              : renderGroupRow({ item })
          }
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
              <Text style={[styles.sectionHeaderText, { color: colors.sectionHeaderText }]}>
                {section.title === 'dm' ? 'Direct Messages' : 'Groups'}
              </Text>
            </View>
          )}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          removeClippedSubviews
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={7}
        />
      )}

      {/* FAB - Create Group */}
      <Pressable
        onPress={() => navigation.navigate('CreateGroup')}
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + 24, backgroundColor: colors.fabBg, shadowColor: colors.fabShadow },
          pressed && styles.fabPressed,
        ]}
      >
        <Ionicons name="people" size={22} color="#fff" />
        <Ionicons name="add" size={14} color="#fff" style={styles.fabPlus} />
      </Pressable>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headerAvatarInitials: { fontSize: 14, fontWeight: '700' },
  headerMeta: { flex: 1 },
  headerName: { fontSize: 17, fontWeight: '700' },
  dialectBadge: {
    marginTop: 2,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  dialectBadgeText: { fontSize: 11, fontWeight: '600' },
  themeToggle: {
    padding: 6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    height: 42,
  },
  searchIcon: { marginRight: 6 },
  searchInput: { flex: 1, fontSize: 15 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 15 },
  emptyHint: { fontSize: 13 },
  retryBtn: {
    marginTop: 4, paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  list: { paddingBottom: 120 },
  sectionHeader: {
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowContent: { flex: 1 },
  chatName: { fontSize: 16, fontWeight: '600' },
  subText: { fontSize: 13, marginTop: 2 },
  avatarFallback: { justifyContent: 'center', alignItems: 'center' },
  avatarInitials: { color: '#fff', fontWeight: '700' },
  groupAvatar: {
    width: 46, height: 46, borderRadius: 23,
    justifyContent: 'center', alignItems: 'center',
  },
  fab: {
    position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
  },
  fabPressed: { opacity: 0.85 },
  fabPlus: { position: 'absolute', bottom: 8, right: 8 },
});
