import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image as Compressor } from 'react-native-compressor';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { updateProfile, uploadProfilePicture } from '../services/api';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'Profile'>;

const DIALECTS = [
  { key: 'singlish', label: '🇱🇰 Singlish' },
  { key: 'tanglish', label: '🇱🇰 Tanglish' },
  { key: 'english', label: '🌐 English' },
] as const;

// ── Component ────────────────────────────────────────────────────────────────
export default function ProfileScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { userDisplayName, userDialect, userProfilePicture, refreshProfile } = useAuth();
  const { colors } = useTheme();

  const [displayName, setDisplayName] = useState(userDisplayName ?? '');
  const [dialect, setDialect] = useState(userDialect ?? 'english');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPic, setIsUploadingPic] = useState(false);

  // ── Profile picture upload flow ──────────────────────────────────────────
  const handlePickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow access to your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1, // Let Compressor handle quality
    });

    if (result.canceled || !result.assets[0]) return;

    setIsUploadingPic(true);
    try {
      // Compress the image before uploading: max 800px, 70% quality
      const compressedUri = await Compressor.compress(result.assets[0].uri, {
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.7,
      });

      await uploadProfilePicture(compressedUri);
      await refreshProfile();
    } catch (err) {
      console.error('[ProfileScreen] Profile picture upload failed:', err);
      Alert.alert('Upload failed', 'Could not upload profile picture. Please try again.');
    } finally {
      setIsUploadingPic(false);
    }
  }, [refreshProfile]);

  // ── Save text profile ────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const name = displayName.trim();
    if (!name) {
      Alert.alert('Invalid name', 'Display name cannot be empty.');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({ displayName: name, nativeDialect: dialect });
      await refreshProfile();
      navigation.goBack();
    } catch (err) {
      console.error('[ProfileScreen] Profile save failed:', err);
      Alert.alert('Save failed', 'Could not save your profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [displayName, dialect, refreshProfile, navigation]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.headerBg }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.headerText} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.headerText }]}>Edit Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Avatar */}
        <Pressable onPress={handlePickImage} style={styles.avatarContainer}>
          {isUploadingPic ? (
            <View style={[styles.avatar, { backgroundColor: colors.avatarFallbackBg }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : userProfilePicture ? (
            <Image source={{ uri: userProfilePicture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.avatarFallbackBg }]}>
              <Ionicons name="person" size={48} color="#fff" />
            </View>
          )}
          <View style={[styles.cameraOverlay, { borderColor: colors.background }]}>
            <Ionicons name="camera" size={18} color="#fff" />
          </View>
        </Pressable>
        <Text style={[styles.avatarHint, { color: colors.textSecondary }]}>Tap to change photo</Text>

        {/* Display name */}
        <Text style={[styles.label, { color: colors.modalText }]}>Display Name</Text>
        <TextInput
          style={[styles.input, { borderColor: colors.border, color: colors.inputText, backgroundColor: colors.inputBg }]}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your display name"
          placeholderTextColor={colors.inputPlaceholder}
          autoCapitalize="words"
          maxLength={50}
        />

        {/* Dialect */}
        <Text style={[styles.label, { color: colors.modalText }]}>Native Dialect</Text>
        <View style={styles.dialectRow}>
          {DIALECTS.map((d) => (
            <Pressable
              key={d.key}
              onPress={() => setDialect(d.key)}
              style={[
                styles.dialectChip,
                { borderColor: colors.border, backgroundColor: colors.surface },
                dialect === d.key && { borderColor: colors.primary, backgroundColor: colors.primaryFaded },
              ]}
            >
              <Text
                style={[
                  styles.dialectChipText,
                  { color: colors.textSecondary },
                  dialect === d.key && { color: colors.primary, fontWeight: '700' },
                ]}
              >
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.dialectHint, { color: colors.textTertiary }]}>
          This sets your default translation language across all chats. You can override it per conversation.
        </Text>

        {/* My Dictionary link */}
        <Pressable
          style={[styles.dictionaryRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => navigation.navigate('PersonalDictionary')}
        >
          <View style={styles.dictionaryRowLeft}>
            <Ionicons name="book-outline" size={20} color={colors.primary} />
            <Text style={[styles.dictionaryRowText, { color: colors.modalText }]}>My Dictionary</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.chevronColor} />
        </Pressable>
        <Text style={[styles.dictionaryHint, { color: colors.textTertiary }]}>
          Add custom words or slang to improve your translation accuracy.
        </Text>

        {/* Save button */}
        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary }, pressed && styles.saveBtnPressed]}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save Changes</Text>
          )}
        </Pressable>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 24, alignItems: 'center' },
  avatarContainer: { marginBottom: 4 },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1e40af',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  avatarHint: { fontSize: 13, marginBottom: 28 },
  label: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  dialectRow: { flexDirection: 'row', gap: 10, marginBottom: 8, width: '100%' },
  dialectChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  dialectChipText: { fontSize: 13, fontWeight: '500' },
  dialectHint: { fontSize: 12, alignSelf: 'flex-start', marginBottom: 20 },
  dictionaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 6,
  },
  dictionaryRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dictionaryRowText: { fontSize: 15, fontWeight: '600' },
  dictionaryHint: { fontSize: 12, alignSelf: 'flex-start', marginBottom: 32 },
  saveBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
