import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { Image as Compressor } from 'react-native-compressor';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { updateProfile, uploadProfilePicture } from '../services/api';
import { getTranslatedOnlyMode, setTranslatedOnlyMode } from '../utils/secureStorage';
import type { AppStackParamList } from '../navigation/types';
import { getApiErrorMessage } from '../utils/auth';

type Props = NativeStackScreenProps<AppStackParamList, 'Profile'>;
const MIN_DISPLAY_NAME_LENGTH = 2;
const MAX_PROFILE_PICTURE_SIZE_BYTES = 1 * 1024 * 1024;

const DIALECTS = [
  { key: 'singlish', label: 'Singlish' },
  { key: 'tanglish', label: 'Tanglish' },
  { key: 'english', label: 'English' },
] as const;

function inferProfileImageMime(uri: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const cleanUri = uri.split('?')[0]?.toLowerCase() ?? '';
  if (cleanUri.endsWith('.png')) return 'image/png';
  if (cleanUri.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function getFileSizeBytes(uri: string): number | null {
  try {
    const info = new File(uri).info();
    if (info.exists && typeof info.size === 'number' && Number.isFinite(info.size)) {
      return Math.max(0, info.size);
    }
  } catch {
    // Ignore local file-stat failures and let upload handling decide next step.
  }

  return null;
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ProfileScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { userDisplayName, userDialect, userProfilePicture, refreshProfile } = useAuth();
  const { colors } = useTheme();

  const [displayName, setDisplayName] = useState(userDisplayName ?? '');
  const [dialect, setDialect] = useState(userDialect ?? 'english');
  const [translatedOnlyMode, setTranslatedOnlyModeState] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPic, setIsUploadingPic] = useState(false);
  const [formError, setFormError] = useState('');
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState<string | null>(null);

  const currentAvatarUrl = pendingAvatarUrl ?? userProfilePicture;

  const isProfilePictureWithinLimit = useCallback(
    (uri: string, sizeHint?: number | null): boolean => {
      const resolvedSize =
        getFileSizeBytes(uri) ??
        (typeof sizeHint === 'number' && Number.isFinite(sizeHint)
          ? Math.max(0, sizeHint)
          : null);

      if (
        resolvedSize != null &&
        resolvedSize > MAX_PROFILE_PICTURE_SIZE_BYTES
      ) {
        Alert.alert(
          'Image too large',
          `Profile pictures must be under 1 MB. Selected image is ${formatMegabytes(resolvedSize)}.`,
        );
        return false;
      }

      return true;
    },
    [],
  );

  useEffect(() => {
    // Auth profile refresh is authoritative; clear local optimistic override.
    setPendingAvatarUrl(null);
  }, [userProfilePicture]);

  // Load translated-only mode preference on mount.
  useEffect(() => {
    getTranslatedOnlyMode().then(setTranslatedOnlyModeState);
  }, []);

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

    const selectedAsset = result.assets[0];
    const originalUri = selectedAsset.uri;
    const originalMimeType = inferProfileImageMime(originalUri);
    const originalSize =
      typeof selectedAsset.fileSize === 'number' && Number.isFinite(selectedAsset.fileSize)
        ? Math.max(0, selectedAsset.fileSize)
        : getFileSizeBytes(originalUri);

    setIsUploadingPic(true);
    try {
      let uploadUri = originalUri;
      let uploadMimeType = originalMimeType;

      try {
        // Compress before upload to reduce payload size and upload time.
        uploadUri = await Compressor.compress(originalUri, {
          maxWidth: 800,
          maxHeight: 800,
          quality: 0.7,
        });
        uploadMimeType = inferProfileImageMime(uploadUri);
      } catch (compressionError) {
        console.warn(
          '[ProfileScreen] Image compression failed, uploading original image instead:',
          compressionError,
        );
      }

      if (!isProfilePictureWithinLimit(uploadUri, originalSize)) {
        return;
      }

      let uploaded;
      try {
        uploaded = await uploadProfilePicture(uploadUri, uploadMimeType);
      } catch (uploadError) {
        if (uploadUri === originalUri) {
          throw uploadError;
        }

        if (!isProfilePictureWithinLimit(originalUri, originalSize)) {
          return;
        }

        console.warn(
          '[ProfileScreen] Compressed upload failed, retrying original image:',
          uploadError,
        );
        uploaded = await uploadProfilePicture(originalUri, originalMimeType);
      }

      if (!uploaded.url && uploadUri !== originalUri) {
        if (!isProfilePictureWithinLimit(originalUri, originalSize)) {
          return;
        }
        uploaded = await uploadProfilePicture(originalUri, originalMimeType);
      }

      if (uploaded.url) {
        setPendingAvatarUrl(uploaded.url);
      }
      await refreshProfile();
    } catch (err) {
      console.error('[ProfileScreen] Profile picture upload failed:', err);
      Alert.alert(
        'Upload failed',
        getApiErrorMessage(err, 'Could not upload profile picture. Please try again.'),
      );
    } finally {
      setIsUploadingPic(false);
    }
  }, [refreshProfile, isProfilePictureWithinLimit]);

  // ── Save text profile ────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const name = displayName.trim();
    if (!name) {
      setFormError('Display name cannot be empty.');
      return;
    }
    if (name.length < MIN_DISPLAY_NAME_LENGTH) {
      setFormError(
        `Display name must be at least ${MIN_DISPLAY_NAME_LENGTH} characters long.`,
      );
      return;
    }

    const hasValidDialect = DIALECTS.some((item) => item.key === dialect);
    if (!hasValidDialect) {
      setFormError('Please select a valid dialect.');
      return;
    }

    setFormError('');
    setIsSaving(true);
    try {
      await updateProfile({ displayName: name, nativeDialect: dialect });
      await refreshProfile();
      navigation.goBack();
    } catch (err) {
      console.error('[ProfileScreen] Profile save failed:', err);
      const message = getApiErrorMessage(err, 'Could not save your profile. Please try again.');
      setFormError(message);
      Alert.alert('Save failed', message);
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
          ) : currentAvatarUrl ? (
            <Image
              source={{ uri: currentAvatarUrl }}
              style={styles.avatar}
              contentFit="cover"
              transition={200}
              recyclingKey={currentAvatarUrl}
            />
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
          onChangeText={(value) => {
            setDisplayName(value);
            if (formError) setFormError('');
          }}
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
              onPress={() => {
                setDialect(d.key);
                if (formError) setFormError('');
              }}
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

        {/* Translated-Only Mode Toggle */}
        <View style={[styles.toggleRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={styles.toggleRowLeft}>
            <Ionicons name="language-outline" size={20} color={colors.primary} />
            <View style={styles.toggleRowTextContainer}>
              <Text style={[styles.toggleRowText, { color: colors.modalText }]}>Translated-Only Mode</Text>
              <Text style={[styles.toggleRowHint, { color: colors.textTertiary }]}>
                Show only translated messages
              </Text>
            </View>
          </View>
          <Switch
            value={translatedOnlyMode}
            onValueChange={async (value) => {
              setTranslatedOnlyModeState(value);
              await setTranslatedOnlyMode(value);
            }}
            trackColor={{ false: colors.border, true: colors.primaryFaded }}
            thumbColor="#fff"
          />
        </View>

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

        {formError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{formError}</Text> : null}

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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  toggleRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleRowTextContainer: { flexDirection: 'column' },
  toggleRowText: { fontSize: 15, fontWeight: '600' },
  toggleRowHint: { fontSize: 12 },
  errorText: {
    width: '100%',
    fontSize: 13,
    marginBottom: 12,
  },
  saveBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
