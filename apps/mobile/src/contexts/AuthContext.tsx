import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getSecureItem, setSecureItem, deleteSecureItem } from '../utils/secureStorage';
import { setAuthToken, removeAuthToken, fetchCurrentUser, unregisterPushToken } from '../services/api';

// ── Types ────────────────────────────────────────────────────────────────────
interface AuthContextValue {
  userToken: string | null;
  userId: string | null;
  userDisplayName: string | null;
  userDialect: string | null;
  userProfilePicture: string | null;
  isLoading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function decodeJwtPayload(token: string): { sub: string; email: string } | null {
  try {
    const base64 = token.split('.')[1];
    if (!base64) return null;
    const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Context ──────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ── Provider ─────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userToken, setUserToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const [userDialect, setUserDialect] = useState<string | null>(null);
  const [userProfilePicture, setUserProfilePicture] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Profile hydration ─────────────────────────────────────────────────────
  const hydrateProfile = useCallback(async () => {
    try {
      const profile = await fetchCurrentUser();
      setUserDisplayName(profile.displayName);
      setUserDialect(profile.nativeDialect);
      setUserProfilePicture(profile.profilePictureUrl);
      await Promise.all([
        setSecureItem('user_display_name', profile.displayName),
        setSecureItem('user_dialect', profile.nativeDialect),
        setSecureItem('user_profile_picture', profile.profilePictureUrl ?? ''),
      ]);
    } catch {
      // API unavailable — keep whatever is already in state (from SecureStore cache)
    }
  }, []);

  // Cold-start hydration
  useEffect(() => {
    (async () => {
      try {
        const storedToken = await getSecureItem('jwt_token');
        if (storedToken) {
          await setAuthToken(storedToken);
          setUserToken(storedToken);
          setUserId(decodeJwtPayload(storedToken)?.sub ?? null);

          // Restore cached profile instantly for snappy first render
          const [cachedName, cachedDialect, cachedPic] = await Promise.all([
            getSecureItem('user_display_name'),
            getSecureItem('user_dialect'),
            getSecureItem('user_profile_picture'),
          ]);
          if (cachedName) setUserDisplayName(cachedName);
          if (cachedDialect) setUserDialect(cachedDialect);
          if (cachedPic) setUserProfilePicture(cachedPic);

          // Background refresh — don't block the loading state
          hydrateProfile();
        }
      } catch (error) {
        console.error('[AuthContext] Cold-start hydration failed:', error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [hydrateProfile]);

  const login = useCallback(
    async (token: string) => {
      await setAuthToken(token);
      setUserToken(token);
      setUserId(decodeJwtPayload(token)?.sub ?? null);
      // Fire-and-forget: profile enrichment should not block the login transition.
      // Awaiting it caused a race where AppNavigator mounted mid-async-chain,
      // leaving the navigation state transiently unstable and causing
      // useFocusEffect in ChatsListScreen to miss its initial focus event.
      void hydrateProfile();
    },
    [hydrateProfile],
  );

  const logout = useCallback(async () => {
    // Unregister push token on the server before clearing credentials
    // so the backend stops sending notifications to this device.
    try {
      await unregisterPushToken();
    } catch {
      // Best-effort — don't block logout if the server is unreachable
    }
    await removeAuthToken();
    await Promise.all([
      deleteSecureItem('user_display_name'),
      deleteSecureItem('user_dialect'),
      deleteSecureItem('user_profile_picture'),
    ]);
    setUserToken(null);
    setUserId(null);
    setUserDisplayName(null);
    setUserDialect(null);
    setUserProfilePicture(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      userToken,
      userId,
      userDisplayName,
      userDialect,
      userProfilePicture,
      isLoading,
      login,
      logout,
      refreshProfile: hydrateProfile,
    }),
    [userToken, userId, userDisplayName, userDialect, userProfilePicture, isLoading, login, logout, hydrateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
