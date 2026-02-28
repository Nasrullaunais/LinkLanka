import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import apiClient from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import type { AuthStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  const { login } = useAuth();
  const { colors } = useTheme();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nativeDialect, setNativeDialect] = useState('singlish');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRegister() {
    if (!displayName || !email || !password) {
      Alert.alert('Validation', 'Please fill in all required fields.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Register the account
      await apiClient.post('/auth/register', {
        email,
        password,
        display_name: displayName,
        native_dialect: nativeDialect,
      });

      // 2. Immediately log in so the user doesn't have to re-enter credentials
      const { data } = await apiClient.post('/auth/login', { email, password });
      const { access_token } = data as { access_token: string };

      await login(access_token);
      // AuthProvider will update userToken → AppGate renders the main app
    } catch (error: any) {
      console.error('[RegisterScreen] error:', {
        message: error?.message,
        code: error?.code,
        data: error?.response?.data,
      });

      const message =
        error?.response?.data?.message ??
        (error?.message
          ? `Network error: ${error.message}`
          : 'Something went wrong.');

      Alert.alert('Registration Failed', Array.isArray(message) ? message.join('\n') : message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.text }]}>Create Account</Text>

        <TextInput
          style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
          placeholder="Display Name"
          placeholderTextColor={colors.inputPlaceholder}
          value={displayName}
          onChangeText={setDisplayName}
        />

        <TextInput
          style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
          placeholder="Email"
          placeholderTextColor={colors.inputPlaceholder}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
        />

        <TextInput
          style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.inputText }]}
          placeholder="Password (min 8 characters)"
          placeholderTextColor={colors.inputPlaceholder}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {/* Dialect selector — simple text buttons for now */}
        <Text style={[styles.label, { color: colors.modalText }]}>I speak</Text>
        <View style={styles.chipRow}>
          {(['singlish', 'tanglish', 'english'] as const).map((d) => (
            <Pressable
              key={d}
              onPress={() => setNativeDialect(d)}
              style={[styles.chip, { backgroundColor: colors.surface }, nativeDialect === d && { backgroundColor: colors.primary }]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: colors.modalText },
                  nativeDialect === d && styles.chipTextActive,
                ]}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {isSubmitting ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 8 }} />
        ) : (
          <Pressable style={[styles.primaryBtn, { backgroundColor: colors.primary }]} onPress={handleRegister}>
            <Text style={styles.primaryBtnText}>Sign Up</Text>
          </Pressable>
        )}

        <Pressable onPress={() => navigation.navigate('Login')}>
          <Text style={[styles.switchText, { color: colors.textSecondary }]}>
            Already have an account? <Text style={[styles.switchLink, { color: colors.primary }]}>Log In</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 24, paddingTop: 60, gap: 14 },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  chipText: { fontSize: 14 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  primaryBtn: {
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchText: {
    textAlign: 'center',
    fontSize: 14,
    marginTop: 4,
  },
  switchLink: { fontWeight: '600' },
});
