/**
 * Platform-aware secure storage.
 *
 * - Native (iOS / Android): delegates to expo-secure-store (hardware-backed
 *   Keychain / Keystore).
 * - Web: falls back to localStorage.  Not cryptographically secure, but
 *   allows the app to run in a browser for development / testing purposes.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
