import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { SocketProvider } from '../src/contexts/SocketContext';
import { NotificationProvider } from '../src/contexts/NotificationContext';
import { ThemeProvider, useTheme } from '../src/contexts/ThemeContext';

import LoginScreen from '../src/screens/LoginScreen';
import RegisterScreen from '../src/screens/RegisterScreen';
import ChatsListScreen from '../src/screens/ChatsListScreen';
import ChatScreen from '../src/screens/ChatScreen';
import CreateGroupScreen from '../src/screens/CreateGroupScreen';
import ProfileScreen from '../src/screens/ProfileScreen';
import PersonalDictionaryScreen from '../src/screens/PersonalDictionaryScreen';

import type { AuthStackParamList, AppStackParamList } from '../src/navigation/types';

// ── Navigators ───────────────────────────────────────────────────────────────
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

// ── Auth Stack (Login / Register) ────────────────────────────────────────────
function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

// ── App Stack (Tabs + full-screen ChatScreen) ────────────────────────────────
function AppNavigator() {
  const { userToken } = useAuth();
  return (
    <SocketProvider userToken={userToken}>
      <NotificationProvider userToken={userToken}>
        <AppStack.Navigator screenOptions={{ headerShown: false }}>
          <AppStack.Screen name="HomeTabs" component={ChatsListScreen} />
          <AppStack.Screen
            name="Chat"
            component={ChatScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <AppStack.Screen
            name="CreateGroup"
            component={CreateGroupScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
          <AppStack.Screen
            name="Profile"
            component={ProfileScreen}
            options={{ animation: 'slide_from_right' }}
          />
          <AppStack.Screen
            name="PersonalDictionary"
            component={PersonalDictionaryScreen}
            options={{ animation: 'slide_from_right' }}
          />
        </AppStack.Navigator>
      </NotificationProvider>
    </SocketProvider>
  );
}

// ── App Gate ─────────────────────────────────────────────────────────────────
// Enforces:  AuthProvider → loading/auth check → SocketProvider → main app
function AppGate() {
  const { userToken, isLoading } = useAuth();
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.spinnerColor} />
      </View>
    );
  }

  return userToken ? <AppNavigator /> : <AuthNavigator />;
}

// ── Root Layout ──────────────────────────────────────────────────────────────
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppGate />
          <ThemedStatusBar />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStatusBar() {
  const { colors } = useTheme();
  return <StatusBar style={colors.statusBarStyle} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
