import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { registerPushToken } from '../services/api';
import { navigationRef } from '../navigation/navigationRef';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NotificationContextValue {
  /** The groupId of the chat screen the user is currently viewing (null = not in a chat). */
  activeGroupId: string | null;
  /** Set by ChatScreen on focus / blur to suppress notifications for the active chat. */
  setActiveGroupId: (groupId: string | null) => void;
  /** The Expo push token for this device (null until registered). */
  expoPushToken: string | null;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(
  undefined,
);

// ── Foreground notification handler ───────────────────────────────────────────
//
// This is set at the module level (outside components) because
// Notifications.setNotificationHandler must be called before any component
// mounts for it to intercept notifications arriving while the app is open.
//
// We keep a mutable ref to the active groupId so the handler can decide
// whether to show the notification without re-registering itself.

let _activeGroupIdRef: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as
      | { groupId?: string }
      | undefined;

    // Suppress the notification if the user is already looking at this chat
    const isActiveChat =
      !!data?.groupId && data.groupId === _activeGroupIdRef;

    return {
      shouldShowAlert: !isActiveChat,
      shouldShowBanner: !isActiveChat,
      shouldShowList: !isActiveChat,
      shouldPlaySound: !isActiveChat,
      shouldSetBadge: false,
    };
  },
});

// ── Provider ──────────────────────────────────────────────────────────────────

interface NotificationProviderProps {
  children: React.ReactNode;
  /** Must be non-null when the user is authenticated. */
  userToken: string | null;
}

export function NotificationProvider({
  children,
  userToken,
}: NotificationProviderProps) {
  const [activeGroupId, setActiveGroupIdState] = useState<string | null>(null);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const notificationResponseListener =
    useRef<ReturnType<typeof Notifications.addNotificationResponseReceivedListener> | null>(null);

  // Keep the module-level ref in sync with React state
  const setActiveGroupId = useCallback((groupId: string | null) => {
    _activeGroupIdRef = groupId;
    setActiveGroupIdState(groupId);
  }, []);

  // ── 1. Create the Android notification channel ──────────────────────────
  useEffect(() => {
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('chat-messages', {
        name: 'Chat Messages',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1A8AE5',
      }).catch(console.error);
    }
  }, []);

  // ── 2. Request permissions & register push token ────────────────────────
  useEffect(() => {
    if (!userToken) {
      // User logged out — clear state
      setExpoPushToken(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Request notification permissions
        const { status: existingStatus } =
          await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== 'granted') {
          console.warn(
            '[NotificationContext] Push notification permission not granted',
          );
          return;
        }

        // Get the Expo push token
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          Constants.easConfig?.projectId;

        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId,
        });

        if (cancelled) return;

        const token = tokenData.data;
        setExpoPushToken(token);

        // Register with our backend
        await registerPushToken(token);
        console.log('[NotificationContext] Push token registered:', token);
      } catch (error) {
        console.error(
          '[NotificationContext] Failed to register push token:',
          error,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userToken]);

  // ── 3. Handle notification tap (navigate to the right chat) ─────────────
  useEffect(() => {
    // When the user taps a notification, navigate to the ChatScreen
    notificationResponseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as
          | {
              groupId?: string;
              groupName?: string;
              type?: string;
            }
          | undefined;

        if (data?.groupId && navigationRef.isReady()) {
          navigationRef.navigate('Chat', {
            groupId: data.groupId,
            groupName: data.groupName ?? 'Chat',
          });
        }
      });

    return () => {
      if (notificationResponseListener.current) {
        notificationResponseListener.current.remove();
      }
    };
  }, []);

  const value = useMemo<NotificationContextValue>(
    () => ({
      activeGroupId,
      setActiveGroupId,
      expoPushToken,
    }),
    [activeGroupId, setActiveGroupId, expoPushToken],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNotification(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error(
      'useNotification must be used inside <NotificationProvider>',
    );
  }
  return context;
}
