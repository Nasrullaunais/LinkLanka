import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { searchUsers, createGroup, type UserItem } from '../services/api';
import type { AppStackParamList } from '../navigation/types';
import { useTheme } from '../contexts/ThemeContext';

type Props = NativeStackScreenProps<AppStackParamList, 'CreateGroup'>;

// ── Component ────────────────────────────────────────────────────────────────
export default function CreateGroupScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [groupName, setGroupName] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserItem[]>([]);;
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserItem[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Debounced user search ────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = memberSearch.trim();
    if (!query) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchUsers(query);
        // Exclude already selected users from results
        setSearchResults(results.filter((r) => !selectedUsers.some((s) => s.id === r.id)));
      } catch (err) {
        console.error('[CreateGroupScreen] Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [memberSearch, selectedUsers]);

  // ── Select / deselect user ───────────────────────────────────────────────
  const toggleUser = useCallback(
    (user: UserItem) => {
      setSelectedUsers((prev) => {
        const idx = prev.findIndex((u) => u.id === user.id);
        if (idx !== -1) return prev.filter((u) => u.id !== user.id);
        return [...prev, user];
      });
    },
    [],
  );

  // ── Create group ─────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    const name = groupName.trim();
    if (!name) {
      setError('Please enter a group name.');
      return;
    }

    setError('');
    setIsCreating(true);

    try {
      const group = await createGroup({
        name,
        memberIds: selectedUsers.map((u) => u.id),
      });

      navigation.replace('Chat', {
        groupId: group.id,
        groupName: group.name ?? name,
      });
    } catch (err) {
      console.error('[CreateGroupScreen] Create failed:', err);
      setError('Failed to create group. Please try again.');
    } finally {
      setIsCreating(false);
    }
  }, [groupName, selectedUsers, navigation]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.headerBg }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.headerText} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.headerText }]}>Create Group</Text>
        <Pressable
          onPress={handleCreate}
          disabled={isCreating || !groupName.trim()}
          style={({ pressed }) => [
            styles.createBtn,
            { backgroundColor: colors.headerAvatarBg },
            (isCreating || !groupName.trim()) && styles.createBtnDisabled,
            pressed && styles.createBtnPressed,
          ]}
        >
          {isCreating ? (
            <ActivityIndicator size="small" color={colors.headerText} />
          ) : (
            <Text style={[styles.createBtnText, { color: colors.headerText }]}>Create</Text>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Error */}
        {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}

        {/* Group name */}
        <Text style={[styles.label, { color: colors.modalText }]}>Group Name</Text>
        <TextInput
          style={[styles.nameInput, { borderColor: colors.border, color: colors.inputText, backgroundColor: colors.inputBg }]}
          placeholder="e.g. Friends, Work Team…"
          placeholderTextColor={colors.inputPlaceholder}
          value={groupName}
          onChangeText={(t) => { setGroupName(t); setError(''); }}
          maxLength={60}
          returnKeyType="next"
        />

        {/* Selected members pills */}
        {selectedUsers.length > 0 && (
          <>
            <Text style={[styles.label, { color: colors.modalText }]}>Members ({selectedUsers.length})</Text>
            <View style={styles.pills}>
              {selectedUsers.map((user) => (
                <Pressable
                  key={user.id}
                  onPress={() => toggleUser(user)}
                  style={[styles.pill, { backgroundColor: colors.primaryFaded, borderColor: colors.primaryLight }]}
                >
                  <Text style={[styles.pillText, { color: colors.primary }]}>{user.displayName}</Text>
                  <Ionicons name="close-circle" size={14} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* User search */}
        <Text style={[styles.label, { color: colors.modalText }]}>Add Members</Text>
        <View style={[styles.searchBar, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
          <Ionicons name="search" size={16} color={colors.inputPlaceholder} style={{ marginRight: 6 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.inputText }]}
            placeholder="Search users…"
            placeholderTextColor={colors.inputPlaceholder}
            value={memberSearch}
            onChangeText={setMemberSearch}
            autoCapitalize="none"
          />
          {isSearching && <ActivityIndicator size="small" color={colors.primary} />}
        </View>

        {/* Search results */}
        {memberSearch.trim().length > 0 && (
          searchResults.length === 0 && !isSearching ? (
            <Text style={[styles.noResults, { color: colors.textTertiary }]}>No users found</Text>
          ) : (
            <View style={[styles.resultsList, { borderColor: colors.border }]}>
              {searchResults.map((user) => {
                const isSelected = selectedUsers.some((s) => s.id === user.id);
                return (
                  <Pressable
                    key={user.id}
                    onPress={() => toggleUser(user)}
                    style={({ pressed }) => [styles.userRow, { backgroundColor: colors.surfaceElevated, borderBottomColor: colors.rowBorder }, pressed && { backgroundColor: colors.rowPressed }]}
                  >
                    <View style={[styles.userAvatar, { backgroundColor: colors.avatarFallbackBg }]}>
                      <Ionicons name="person" size={20} color="#fff" />
                    </View>
                    <View style={styles.userInfo}>
                      <Text style={[styles.userName, { color: colors.text }]}>{user.displayName}</Text>
                      <Text style={[styles.userDialect, { color: colors.textTertiary }]}>{user.nativeDialect}</Text>
                    </View>
                    <View style={[styles.checkbox, { borderColor: colors.border }, isSelected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                      {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )
        )}
      </ScrollView>
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
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 4,
  },
  createBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    minWidth: 70,
    alignItems: 'center',
  },
  createBtnDisabled: { opacity: 0.45 },
  createBtnPressed: { opacity: 0.7 },
  createBtnText: { fontWeight: '700', fontSize: 14 },
  body: {
    padding: 16,
    gap: 4,
    paddingBottom: 40,
  },
  errorText: {
    fontSize: 13,
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  pillText: { fontSize: 13, fontWeight: '500' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  noResults: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
  },
  resultsList: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  userAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '600' },
  userDialect: { fontSize: 12, marginTop: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
