import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { getApiErrorMessage, isValidEmail, normalizeEmail } from '../utils/auth';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

type LoginRequestError = {
  message?: string;
  code?: string;
  response?: {
    status?: number;
    data?: {
      message?: unknown;
    };
  };
};

function isInvalidCredentialError(err: LoginRequestError): boolean {
  if (err.response?.status !== 401) return false;

  const apiMessage = err.response?.data?.message;
  if (Array.isArray(apiMessage)) {
    return apiMessage.some(
      (item) => typeof item === 'string' && /invalid credentials/i.test(item),
    );
  }

  if (typeof apiMessage === 'string') {
    return /invalid credentials/i.test(apiMessage);
  }

  return true;
}

export default function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const { colors } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin() {
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
      Alert.alert('Validation', 'Please enter both email and password.');
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      Alert.alert('Validation', 'Please enter a valid email address.');
      return;
    }

    if (normalizedEmail !== email) {
      setEmail(normalizedEmail);
    }

    setIsSubmitting(true);

    try {
      const { data } = await apiClient.post('/auth/login', {
        email: normalizedEmail,
        password,
      });

      const { access_token } = data as { access_token: string };

      await login(access_token);
    } catch (error: unknown) {
      const err = error as LoginRequestError;
      const isExpectedInvalidCredentials = isInvalidCredentialError(err);

      if (!isExpectedInvalidCredentials) {
        // Keep error-level logging for actual failures (network/server issues).
        console.error('[LoginScreen] handleLogin error:', {
          message: err?.message,
          code: err?.code,
          status: err?.response?.status,
          data: err?.response?.data,
        });
      }

      const message = getApiErrorMessage(
        error,
        'Unable to log in right now. Please try again.',
      );

      Alert.alert('Login Failed', message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.form}>
        <Text style={[styles.title, { color: colors.text }]}>LinkLanka</Text>

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
          placeholder="Password"
          placeholderTextColor={colors.inputPlaceholder}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {isSubmitting ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <Pressable style={[styles.loginBtn, { backgroundColor: colors.primary }]} onPress={handleLogin}>
            <Text style={styles.loginBtnText}>Log In</Text>
          </Pressable>
        )}

        <Pressable onPress={() => navigation.navigate('Register')}>
          <Text style={[styles.switchLink, { color: colors.textSecondary }]}>
            Don{"'"}t have an account? <Text style={[styles.switchLinkBold, { color: colors.primary }]}>Sign Up</Text>
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  form: {
    marginHorizontal: 24,
    gap: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  loginBtn: {
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  switchLink: {
    textAlign: 'center',
    fontSize: 14,
  },
  switchLinkBold: {
    fontWeight: '600',
  },
});
