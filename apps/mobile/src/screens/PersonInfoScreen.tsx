import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { fetchUserById, type CurrentUser } from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'PersonInfo'>;

const DIALECT_LABELS: Record<string, string> = {
  singlish: 'Singlish',
  tanglish: 'Tanglish',
  english: 'English',
};

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

// ── Component ────────────────────────────────────────────────────────────────
export default function PersonInfoScreen({ navigation, route }: Props) {
  const { userId, displayName: initialName, profilePictureUrl: initialPicture } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [profile, setProfile] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchUserById(userId);
        if (!cancelled) setProfile(data);
      } catch (err) {
        console.error('[PersonInfoScreen] Failed to fetch user:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const name = profile?.displayName ?? initialName;
  const picture = profile?.profilePictureUrl ?? initialPicture ?? null;
  const email = profile?.email ?? null;
  const dialect = profile?.nativeDialect ?? null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: colors.headerBg }]}
      >
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.headerText} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.headerText }]}>Contact Info</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Avatar + display name */}
        <View style={styles.avatarSection}>
          {picture ? (
            <Image
              source={{ uri: picture }}
              style={styles.avatar}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.avatarFallbackBg }]}>
              <Text style={styles.avatarInitials}>{getInitials(name)}</Text>
            </View>
          )}
          <Text style={[styles.displayName, { color: colors.text }]}>{name}</Text>
        </View>

        {/* Info rows */}
        {isLoading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.spinnerColor} />
        ) : (
          <View
            style={[styles.infoCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
          >
            {email ? (
              <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                <View style={[styles.infoIconWrap, { backgroundColor: colors.primaryFaded }]}>
                  <Ionicons name="mail-outline" size={18} color={colors.primary} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Email</Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>{email}</Text>
                </View>
              </View>
            ) : null}
            {dialect ? (
              <View style={styles.infoRow}>
                <View style={[styles.infoIconWrap, { backgroundColor: colors.primaryFaded }]}>
                  <Ionicons name="language-outline" size={18} color={colors.primary} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                    Preferred Language
                  </Text>
                  <Text style={[styles.infoValue, { color: colors.text }]}>
                    {DIALECT_LABELS[dialect] ?? dialect}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { paddingBottom: 40 },

  // Avatar section
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginBottom: 16,
  },
  avatarInitials: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '700',
  },
  displayName: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },

  // Info card
  infoCard: {
    marginHorizontal: 20,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoContent: { flex: 1 },
  infoLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoValue: { fontSize: 15, fontWeight: '500' },
});
