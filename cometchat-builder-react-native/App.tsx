import './gesture-handler';
import React, { useState, useEffect, useRef } from 'react';
import {
  Platform,
  View,
  PlatformColor,
  AppState,
  AppStateStatus,
} from 'react-native';
import { enableScreens } from 'react-native-screens';
enableScreens();
import {
  CometChatI18nProvider,
  CometChatIncomingCall,
  CometChatThemeProvider,
  CometChatUIEventHandler,
  CometChatUIEvents,
  CometChatUIKit,
  UIKitSettings,
  CometChatTheme,
} from '@cometchat/chat-uikit-react-native';

import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CometChat } from '@cometchat/chat-sdk-react-native';
import RootStackNavigator from './src/navigation/RootStackNavigator';
import { AppConstants } from './src/utils/AppConstants';
import { requestAndroidPermissions } from './src/utils/helper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConfig } from './src/config/store';
import { DeepPartial } from '@cometchat/chat-uikit-react-native/src/shared/helper/types';
// Listener ID for registering and removing CometChat listeners.
const listenerId = 'app';

const App = (): React.ReactElement => {
  const [callReceived, setCallReceived] = useState(false);
  const incomingCall = useRef<CometChat.Call | CometChat.CustomMessage | null>(
    null,
  );
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userLoggedIn, setUserLoggedIn] = useState(false);
  const [currentToken, setCurrentToken] = useState('');
  const [isTokenRegistered, setIsTokenRegistered] = useState(false);
  const [hasValidAppCredentials, setHasValidAppCredentials] = useState(false);
    const styleConfig = useConfig(state => state?.settings?.style);

type TypographyVariant = {
  regular: { fontFamily: string };
  medium: { fontFamily: string };
  bold: { fontFamily: string };
};

type Typography = {
  fontFamily: string;
  link: { fontFamily: string };
} & Record<
  | "title"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "body"
  | "caption1"
  | "caption2"
  | "button",
  TypographyVariant
>;

// Simple font mapping - response name to file names (without extension)
const FONT_MAP: Record<string, { regular: string; medium: string; bold: string }> = {
  'times new roman': {
    regular: Platform.OS === 'ios' ? 'TimesNewRomanPSMT' : 'times_new_roman_regular',
    medium: Platform.OS === 'ios' ? 'TimesNewRomanPSMT' : 'times_new_roman_medium',
    bold: Platform.OS === 'ios' ? 'TimesNewRomanPS-BoldMT' : 'times_new_roman_bold',
  },
  'inter': {
    regular: Platform.OS === 'ios' ? 'Inter-Regular' : 'inter_regular',
    medium: Platform.OS === 'ios' ? 'Inter-Medium' : 'inter_medium',
    bold: Platform.OS === 'ios' ? 'Inter-Bold' : 'inter_bold',
  },
  'roboto': {
    regular: Platform.OS === 'ios' ? 'Roboto-Regular' : 'roboto_regular',
    medium: Platform.OS === 'ios' ? 'Roboto-Medium' : 'roboto_medium',
    bold: Platform.OS === 'ios' ? 'Roboto-Bold' : 'roboto_bold',
  },
};

// Robust createTypography: normalizes font name, provides fallback, and builds all variants
const createTypography = (font: string): Typography => {
  const types = [
    "title",
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "body",
    "caption1",
    "caption2",
    "button",
  ] as const;

  // Normalize font name from backend and provide fallback
  const fontKey = font ? font.toLowerCase().trim() : '';
const fontVariants = FONT_MAP[fontKey] || FONT_MAP['times_new_roman_bold'];
  // Defensive: ensure all variants exist
  const baseStyle: TypographyVariant = {
    regular: { fontFamily: fontVariants.regular },
    medium: { fontFamily: fontVariants.medium },
    bold: { fontFamily: fontVariants.bold },
  };

  const typography: Typography = {
    fontFamily: fontVariants.regular,
    link: { fontFamily: fontVariants.regular },
  } as Typography;

  types.forEach((type) => {
    typography[type] = { ...baseStyle };
  });

  return typography;
};

const theme : { light:  DeepPartial<CometChatTheme>; dark: DeepPartial<CometChatTheme> } = {
  light: {
    color: {
      primary: styleConfig.color.brandColor,
      textPrimary: styleConfig.color.primaryTextLight,
      textSecondary: styleConfig.color.secondaryTextLight,
    },
    typography: createTypography(styleConfig.typography.font),
  },
  dark: {
    color: {
      primary: styleConfig.color.brandColor,
      textPrimary: styleConfig.color.primaryTextDark,
      textSecondary: styleConfig.color.secondaryTextDark,
    },
    typography: createTypography(styleConfig.typography.font),
  },
};

  /**
   * Initialize CometChat UIKit and configure Google Sign-In.
   * Retrieves credentials from AsyncStorage and uses fallback constants if needed.
   */
  useEffect(() => {
    async function init() {
      try {
        // Retrieve stored app credentials or default to an empty object.
        const AppData = (await AsyncStorage.getItem('appCredentials')) || '{}';
        const storedCredentials = JSON.parse(AppData);

        // Determine the final credentials (from AsyncStorage or AppConstants).
        const finalAppId = storedCredentials.appId || AppConstants.appId;
        const finalAuthKey = storedCredentials.authKey || AppConstants.authKey;
        const finalRegion = storedCredentials.region || AppConstants.region;

        // Set hasValidAppCredentials based on whether all values are available.
        if (finalAppId && finalAuthKey && finalRegion) {
          setHasValidAppCredentials(true);
        } else {
          setHasValidAppCredentials(false);
        }

        await CometChatUIKit.init({
          appId: finalAppId,
          authKey: finalAuthKey,
          region: finalRegion,
          subscriptionType: CometChat.AppSettings
            .SUBSCRIPTION_TYPE_ALL_USERS as UIKitSettings['subscriptionType'],
        });

        // If a user is already logged in, update the state.
        const loggedInUser = CometChatUIKit.loggedInUser;
        if (loggedInUser) {
          setIsLoggedIn(true);
        }
      } catch (error) {
        console.log('Error during initialization', error);
      } finally {
        // Mark initialization as complete.
        setIsInitializing(false);
      }
    }
    init();
  }, []);

  /**
   * Monitor app state changes to verify the logged-in status and clear notifications.
   * When the app becomes active, it cancels Android notifications and checks the login status.
   */
  useEffect(() => {
    if (Platform.OS === 'android') {
      // Request required Android permissions for notifications.
      requestAndroidPermissions();
    }
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        try {
          // Verify if there is a valid logged-in user.
          const chatUser = await CometChat.getLoggedinUser();
          setIsLoggedIn(!!chatUser);
        } catch (error) {
          console.log('Error verifying CometChat user on resume:', error);
        }
      }
    };
    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );
    return () => subscription.remove();
  }, []);

  /**
   * Attach CometChat login listener to handle login and logout events.
   * Updates user login status accordingly.
   */
  useEffect(() => {
    CometChat.addLoginListener(
      listenerId,
      new CometChat.LoginListener({
        loginSuccess: () => {
          setUserLoggedIn(true);
        },
        loginFailure: (e: CometChat.CometChatException) => {
          console.log('LoginListener :: loginFailure', e.message);
        },
        logoutSuccess: () => {
          setUserLoggedIn(false);
        },
        logoutFailure: (e: CometChat.CometChatException) => {
          console.log('LoginListener :: logoutFailure', e.message);
        },
      }),
    );

    // Clean up the login listener on component unmount.
    return () => {
      CometChat.removeLoginListener(listenerId);
    };
  }, []);

  /**
   * Attach CometChat call listeners to handle incoming, outgoing, and cancelled call events.
   * Also handles UI events for call end.
   */
  useEffect(() => {
    // Listener for call events.
    CometChat.addCallListener(
      listenerId,
      new CometChat.CallListener({
        onIncomingCallReceived: (call: CometChat.Call) => {
          // Check if there's already an active call
          try {
            const activeCall = CometChat.getActiveCall();
            if (activeCall) {
              // If there's an active call, reject the incoming call with busy status
              setTimeout(() => {
                CometChat.rejectCall(
                  call.getSessionId(),
                  CometChat.CALL_STATUS.BUSY,
                )
                  .then(() => {
                    console.log('Incoming call rejected due to active call');
                  })
                  .catch(error => {
                    console.error(
                      'Error rejecting call with busy status:',
                      error,
                    );
                  });
              }, 2000);
            } else {
              // No active call, proceed with normal incoming call handling
              // Hide any bottom sheet UI before showing the incoming call screen.
              CometChatUIEventHandler.emitUIEvent(
                CometChatUIEvents.ccToggleBottomSheet,
                {
                  isBottomSheetVisible: false,
                },
              );
              // Store the incoming call and update state.
              incomingCall.current = call;
              setCallReceived(true);
            }
          } catch (error) {
            console.error('Error getting active call:', error);
            // If error getting active call, proceed with normal handling
            CometChatUIEventHandler.emitUIEvent(
              CometChatUIEvents.ccToggleBottomSheet,
              {
                isBottomSheetVisible: false,
              },
            );
            incomingCall.current = call;
            setCallReceived(true);
          }
        },
        onOutgoingCallRejected: () => {
          // Clear the call state if outgoing call is rejected.
          incomingCall.current = null;
          setCallReceived(false);
        },
        onIncomingCallCancelled: () => {
          // Clear the call state if the incoming call is cancelled.
          incomingCall.current = null;
          setCallReceived(false);
        },
      }),
    );

    // Additional listener to handle call end events.
    CometChatUIEventHandler.addCallListener(listenerId, {
      ccCallEnded: () => {
        incomingCall.current = null;
        setCallReceived(false);
      },
    });

    // Remove call listeners on cleanup.
    return () => {
      CometChatUIEventHandler.removeCallListener(listenerId);
      CometChat.removeCallListener(listenerId);
    };
  }, [userLoggedIn]);

  // Show a blank/splash screen while the app is initializing.
  if (isInitializing) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Platform.select({
            ios: PlatformColor('systemBackgroundColor'),
            android: PlatformColor('?android:attr/colorBackground'),
          }),
        }}
      />
    );
  }

  // Once initialization is complete, render the main app UI.
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <CometChatThemeProvider theme={theme}>
          <CometChatI18nProvider>
            {/* Render the incoming call UI if the user is logged in and a call is received */}
            {isLoggedIn && callReceived && incomingCall.current ? (
              <CometChatIncomingCall
                call={incomingCall.current}
                onDecline={() => {
                  // Handle call decline by clearing the incoming call state.
                  incomingCall.current = null;
                  setCallReceived(false);
                }}
              />
            ) : null}
            {/* Render the main navigation stack, passing the login status as a prop */}
            <RootStackNavigator
              isLoggedIn={isLoggedIn}
              hasValidAppCredentials={hasValidAppCredentials}
            />
          </CometChatI18nProvider>
        </CometChatThemeProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
};

export default App;
