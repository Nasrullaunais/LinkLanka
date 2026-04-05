import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  fetchGroupMembers,
  addGroupMember,
  leaveGroup,
  updateGroupName,
  searchUsers,
  type GroupMemberItem,
  type UserItem,
} from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import type { AppColors } from '../contexts/ThemeContext';
import type { AppStackParamList } from '../navigation/types';
import { getApiErrorMessage } from '../utils/auth';

type Props = NativeStackScreenProps<AppStackParamList, 'GroupInfo'>;
const MIN_GROUP_NAME_LENGTH = 2;
const MAX_GROUP_NAME_LENGTH = 80;

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

// ── Member row ───────────────────────────────────────────────────────────────
const MemberRow = React.memo(function MemberRow({
  member,
  colors,
}: {
  member: GroupMemberItem;
  colors: AppColors;
}) {
  const name = member.user?.displayName ?? 'Unknown';
  const email = member.user?.email ?? '';
  const picture = member.user?.profilePictureUrl ?? null;

  return (
    <View
      style={[
        styles.memberRow,
        { backgroundColor: colors.surfaceElevated, borderBottomColor: colors.rowBorder },
      ]}
    >
      {picture ? (
        <Image
          source={{ uri: picture }}
          style={styles.memberAvatar}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={[styles.memberAvatar, { backgroundColor: colors.avatarFallbackBg }]}>
          <Text style={styles.memberAvatarText}>{getInitials(name)}</Text>
        </View>
      )}
      <View style={styles.memberInfo}>
        <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
        {email ? (
          <Text style={[styles.memberEmail, { color: colors.textSecondary }]} numberOfLines={1}>
            {email}
          </Text>
        ) : null}
      </View>
      {member.role === 'ADMIN' && (
        <View style={[styles.adminBadge, { backgroundColor: colors.primaryFaded }]}>
          <Text style={[styles.adminBadgeText, { color: colors.primary }]}>Admin</Text>
        </View>
      )}
    </View>
  );
});

// ── Component ────────────────────────────────────────────────────────────────
export default function GroupInfoScreen({ navigation, route }: Props) {
  const { groupId, groupName: initialGroupName } = route.params;
  const { userId } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [members, setMembers] = useState<GroupMemberItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [groupName, setGroupName] = useState(initialGroupName);

  // Editing group name
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(initialGroupName);
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState('');

  // Add member modal
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [addMemberError, setAddMemberError] = useState('');

  // Leave group
  const [isLeaving, setIsLeaving] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load members ─────────────────────────────────────────────────────────
  const loadMembers = useCallback(async () => {
    try {
      const data = await fetchGroupMembers(groupId);
      setMembers(data);
    } catch (err) {
      console.error('[GroupInfoScreen] Failed to load members:', err);
      Alert.alert(
        'Error',
        getApiErrorMessage(err, 'Could not load group members. Please try again.'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // ── Save group name ──────────────────────────────────────────────────────
  const handleSaveName = useCallback(async () => {
    const name = editedName.trim();
    if (!name) {
      setNameError('Group name cannot be empty.');
      return;
    }
    if (name.length < MIN_GROUP_NAME_LENGTH) {
      setNameError(`Group name must be at least ${MIN_GROUP_NAME_LENGTH} characters.`);
      return;
    }
    if (name.length > MAX_GROUP_NAME_LENGTH) {
      setNameError(`Group name must be at most ${MAX_GROUP_NAME_LENGTH} characters.`);
      return;
    }
    if (name === groupName) {
      setNameError('');
      setIsEditingName(false);
      return;
    }

    setNameError('');
    setIsSavingName(true);
    try {
      await updateGroupName(groupId, name);
      setGroupName(name);
      setIsEditingName(false);
    } catch (err) {
      console.error('[GroupInfoScreen] Failed to update name:', err);
      const message = getApiErrorMessage(err, 'Could not update group name. Please try again.');
      setNameError(message);
      Alert.alert('Error', message);
    } finally {
      setIsSavingName(false);
    }
  }, [editedName, groupName, groupId]);

  // ── Search users for adding ──────────────────────────────────────────────
  useEffect(() => {
    if (!addModalVisible) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = memberSearch.trim();
    if (!query) {
      setSearchResults([]);
      setIsSearching(false);
      setAddMemberError('');
      return;
    }

    setIsSearching(true);
    setAddMemberError('');
    const memberIds = new Set(members.map((m) => m.userId));
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchUsers(query);
        setSearchResults(results.filter((r) => !memberIds.has(r.id)));
      } catch (err) {
        console.error('[GroupInfoScreen] Search failed:', err);
        setAddMemberError(
          getApiErrorMessage(err, 'Could not search users right now. Please try again.'),
        );
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [memberSearch, addModalVisible, members]);

  const closeAddModal = useCallback(() => {
    setAddModalVisible(false);
    setMemberSearch('');
    setSearchResults([]);
    setAddMemberError('');
  }, []);

  // ── Add member ───────────────────────────────────────────────────────────
  const handleAddMember = useCallback(
    async (user: UserItem) => {
      setIsAdding(user.id);
      setAddMemberError('');
      try {
        await addGroupMember(groupId, user.id);
        closeAddModal();
        const updated = await fetchGroupMembers(groupId);
        setMembers(updated);
      } catch (err) {
        console.error('[GroupInfoScreen] Failed to add member:', err);
        const message = getApiErrorMessage(err, 'Could not add member. Please try again.');
        setAddMemberError(message);
        Alert.alert('Error', message);
      } finally {
        setIsAdding(null);
      }
    },
    [groupId, closeAddModal],
  );

  // ── Leave group ──────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    Alert.alert(
      'Leave Group',
      'Are you sure you want to leave this group? You will need to be added back by a member.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            if (!userId) return;
            setIsLeaving(true);
            try {
              await leaveGroup(groupId, userId);
              navigation.reset({ index: 0, routes: [{ name: 'HomeTabs' }] });
            } catch (err) {
              console.error('[GroupInfoScreen] Failed to leave group:', err);
              Alert.alert(
                'Error',
                getApiErrorMessage(err, 'Could not leave the group. Please try again.'),
              );
              setIsLeaving(false);
            }
          },
        },
      ],
    );
  }, [userId, groupId, navigation]);

  const memberCount = members.length;

  const renderMember = useCallback(
    ({ item }: { item: GroupMemberItem }) => <MemberRow member={item} colors={colors} />,
    [colors],
  );

  const keyExtractor = useCallback((item: GroupMemberItem) => item.id, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.headerBg }]}
      >
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.headerText} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.headerText }]}>Group Info</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={members}
        keyExtractor={keyExtractor}
        renderItem={renderMember}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.topSection}>
            {/* Group icon */}
            <View style={[styles.groupIcon, { backgroundColor: colors.groupAvatarBg }]}>
              <Ionicons name="people" size={48} color="#fff" />
            </View>

            {/* Group name with inline edit */}
            {isEditingName ? (
              <View style={styles.nameEditRow}>
                <TextInput
                  style={[
                    styles.nameInput,
                    {
                      borderColor: colors.primary,
                      color: colors.text,
                      backgroundColor: colors.inputBg,
                    },
                  ]}
                  value={editedName}
                  onChangeText={(value) => {
                    setEditedName(value);
                    if (nameError) setNameError('');
                  }}
                  autoFocus
                  maxLength={MAX_GROUP_NAME_LENGTH}
                  selectTextOnFocus
                  onSubmitEditing={handleSaveName}
                />
                <Pressable
                  onPress={handleSaveName}
                  disabled={isSavingName}
                  style={[styles.nameActionBtn, { backgroundColor: colors.primary }]}
                >
                  {isSavingName ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Ionicons name="checkmark" size={20} color="#fff" />
                  )}
                </Pressable>
                <Pressable
                  onPress={() => {
                    setIsEditingName(false);
                    setEditedName(groupName);
                    setNameError('');
                  }}
                  style={[styles.nameActionBtn, { backgroundColor: colors.surface }]}
                >
                  <Ionicons name="close" size={20} color={colors.text} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => {
                  setIsEditingName(true);
                  setEditedName(groupName);
                  setNameError('');
                }}
                style={styles.namePressable}
              >
                <Text style={[styles.groupName, { color: colors.text }]}>{groupName}</Text>
                <Ionicons
                  name="pencil-outline"
                  size={18}
                  color={colors.textSecondary}
                  style={{ marginLeft: 6 }}
                />
              </Pressable>
            )}

            {nameError ? (
              <Text style={[styles.errorText, { color: colors.destructive }]}>{nameError}</Text>
            ) : null}

            <Text style={[styles.memberCount, { color: colors.textSecondary }]}>
              {isLoading ? '…' : `${memberCount} member${memberCount !== 1 ? 's' : ''}`}
            </Text>

            {/* Add members button */}
            <Pressable
              onPress={() => setAddModalVisible(true)}
              style={({ pressed }) => [
                styles.addMembersBtn,
                { backgroundColor: colors.primary },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="person-add-outline" size={18} color="#fff" />
              <Text style={styles.addMembersBtnText}>Add Members</Text>
            </Pressable>
          </View>
        }
        ListFooterComponent={
          isLoading ? (
            <ActivityIndicator style={{ marginVertical: 24 }} color={colors.spinnerColor} />
          ) : (
            <Pressable
              onPress={handleLeave}
              disabled={isLeaving}
              style={({ pressed }) => [
                styles.leaveBtn,
                { borderColor: colors.destructiveLight },
                pressed && { opacity: 0.7 },
              ]}
            >
              {isLeaving ? (
                <ActivityIndicator color={colors.destructiveLight} size="small" />
              ) : (
                <>
                  <Ionicons name="exit-outline" size={20} color={colors.destructiveLight} />
                  <Text style={[styles.leaveBtnText, { color: colors.destructiveLight }]}>
                    Leave Group
                  </Text>
                </>
              )}
            </Pressable>
          )
        }
      />

      {/* Add Member Modal */}
      <Modal
        visible={addModalVisible}
        animationType="slide"
        onRequestClose={closeAddModal}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          {/* Modal header */}
          <View
            style={[
              styles.modalHeader,
              { paddingTop: insets.top + 12, backgroundColor: colors.headerBg },
            ]}
          >
            <Pressable onPress={closeAddModal} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.headerText} />
            </Pressable>
            <Text style={[styles.modalHeaderTitle, { color: colors.headerText }]}>
              Add Members
            </Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Search input */}
          <View
            style={[
              styles.searchRow,
              { borderBottomColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search by name…"
              placeholderTextColor={colors.inputPlaceholder}
              value={memberSearch}
              onChangeText={(value) => {
                setMemberSearch(value);
                if (addMemberError) setAddMemberError('');
              }}
              autoFocus
              autoCapitalize="none"
            />
            {memberSearch.length > 0 && (
              <Pressable
                onPress={() => {
                  setMemberSearch('');
                  setSearchResults([]);
                  setAddMemberError('');
                }}
              >
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>

          {addMemberError ? (
            <Text style={[styles.modalErrorText, { color: colors.destructive }]}>{addMemberError}</Text>
          ) : null}

          {/* Results */}
          {isSearching ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={colors.spinnerColor} />
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(u) => u.id}
              renderItem={({ item: user }) => (
                <Pressable
                  onPress={() => handleAddMember(user)}
                  disabled={isAdding === user.id}
                  style={({ pressed }) => [
                    styles.searchResultRow,
                    {
                      backgroundColor: colors.surfaceElevated,
                      borderBottomColor: colors.rowBorder,
                    },
                    pressed && { backgroundColor: colors.rowPressed },
                  ]}
                >
                  {user.profilePictureUrl ? (
                    <Image
                      source={{ uri: user.profilePictureUrl }}
                      style={styles.searchResultAvatar}
                      contentFit="cover"
                      transition={200}
                    />
                  ) : (
                    <View
                      style={[
                        styles.searchResultAvatar,
                        { backgroundColor: colors.avatarFallbackBg },
                      ]}
                    >
                      <Text style={styles.searchResultAvatarText}>
                        {getInitials(user.displayName)}
                      </Text>
                    </View>
                  )}
                  <View style={styles.searchResultInfo}>
                    <Text style={[styles.searchResultName, { color: colors.text }]}>
                      {user.displayName}
                    </Text>
                  </View>
                  {isAdding === user.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="person-add-outline" size={20} color={colors.primary} />
                  )}
                </Pressable>
              )}
              ListEmptyComponent={
                memberSearch.trim().length > 0 && !isSearching ? (
                  <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
                    No users found.
                  </Text>
                ) : null
              }
            />
          )}
        </View>
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

  listContent: { paddingBottom: 32 },

  // Top section
  topSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
  },
  groupIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  namePressable: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  groupName: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  nameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    width: '100%',
  },
  nameInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  nameActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberCount: { fontSize: 14, marginBottom: 20 },
  errorText: { fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 12 },
  addMembersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  addMembersBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Member rows
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  memberAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  memberAvatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '600' },
  memberEmail: { fontSize: 13, marginTop: 2 },
  adminBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  adminBadgeText: { fontSize: 11, fontWeight: '700' },

  // Leave button
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: 24,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  leaveBtnText: { fontSize: 16, fontWeight: '600' },

  // Add member modal
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalHeaderTitle: { fontSize: 18, fontWeight: '700' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 16 },
  modalErrorText: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  searchResultAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  searchResultAvatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  searchResultInfo: { flex: 1 },
  searchResultName: { fontSize: 15, fontWeight: '600' },
  emptyHint: { textAlign: 'center', fontSize: 14, marginTop: 32 },
});
