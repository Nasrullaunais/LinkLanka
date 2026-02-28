import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { getSecureItem, setSecureItem } from '../utils/secureStorage';

// ── Color Palettes ───────────────────────────────────────────────────────────

const lightColors = {
  // Base
  background: '#ffffff',
  surface: '#f9fafb',
  surfaceElevated: '#ffffff',

  // Text
  text: '#111827',
  textSecondary: '#6b7280',
  textTertiary: '#9ca3af',
  textInverse: '#ffffff',

  // Primary / Brand
  primary: '#4f46e5',
  primaryLight: '#6366f1',
  primaryFaded: 'rgba(79,70,229,0.12)',

  // Header
  headerBg: '#4f46e5',
  headerText: '#ffffff',
  headerTextSecondary: '#e0e7ff',
  headerAvatarBg: 'rgba(255,255,255,0.25)',

  // Chat bubbles
  bubbleOwn: '#4f46e5',
  bubbleOwnText: '#ffffff',
  bubbleReceived: '#e8edf5',
  bubbleReceivedText: '#1f2937',
  bubbleShadow: '#000000',

  // Audio player (inside bubbles)
  audioIconOwn: '#ffffff',
  audioIconReceived: '#4f46e5',
  audioBarInactiveOwn: 'rgba(255,255,255,0.30)',
  audioBarInactiveReceived: '#c7d2fe',
  audioBarActiveOwn: '#ffffff',
  audioBarActiveReceived: '#4f46e5',
  audioTimeOwn: 'rgba(255,255,255,0.80)',
  audioTimeReceived: '#6366f1',

  // Translation card
  translationBg: '#eef2ff',
  translationBorder: '#e0e7ff',
  translationBgOwn: '#ede9fe',
  translationBorderOwn: '#ddd6fe',
  translationText: '#312e81',

  // Confidence badge
  confidenceBg: '#c7d2fe',
  confidenceText: '#3730a3',

  // AI mediating
  mediatingColor: '#a78bfa',
  mediatingDotBg: '#c4b5fd',
  mediatingShimmer: 'rgba(167,139,250,0.35)',

  // Skeleton
  skeletonBase: '#e5e7eb',
  skeletonHighlight: '#f9fafb',

  // Processing waveform
  processingWaveformBar: '#f87171',

  // Selection
  selectionBg: 'rgba(79,70,229,0.12)',
  selectionBgOff: 'rgba(79,70,229,0)',
  checkCircleBorder: '#c7d2fe',
  checkCircleBg: '#ffffff',
  checkCircleActiveBg: '#4f46e5',
  checkCircleActiveBorder: '#4f46e5',

  // Search bar
  searchBg: '#f3f4f6',
  searchText: '#111827',
  searchPlaceholder: '#9ca3af',
  searchIcon: '#9ca3af',

  // Input bar
  inputWrapperBg: '#ffffff',
  inputBg: '#f3f4f6',
  inputText: '#111827',
  inputPlaceholder: '#9ca3af',
  inputBorder: '#e5e7eb',
  inputIconColor: '#6b7280',

  // Rows / Lists
  rowBorder: '#f3f4f6',
  rowPressed: '#f9fafb',
  sectionHeaderBg: '#ffffff',
  sectionHeaderText: '#6b7280',

  // Avatar
  avatarFallbackBg: '#6366f1',
  groupAvatarBg: '#8b5cf6',

  // FAB
  fabBg: '#4f46e5',
  fabShadow: '#4f46e5',

  // Misc
  border: '#e5e7eb',
  borderLight: '#f3f4f6',
  divider: '#e5e7eb',
  destructive: '#ef4444',
  destructiveLight: '#fca5a5',
  success: '#34d399',
  warning: '#f59e0b',

  // Overlay / Modal
  overlayBg: 'rgba(0,0,0,0.45)',
  modalBg: '#ffffff',
  modalText: '#374151',

  // Edited label
  editedLabel: '#9ca3af',

  // Empty state
  emptyIcon: '#d1d5db',
  emptyText: '#9ca3af',
  emptyHint: '#d1d5db',

  // Dialect badge
  dialectBadgeBg: 'rgba(255,255,255,0.2)',
  dialectBadgeText: '#e0e7ff',

  // Language picker
  langPickerBg: '#ffffff',
  langPickerTitleColor: '#6b7280',
  langPickerBorder: '#e5e7eb',
  langOptionActiveBg: '#ede9fe',
  langOptionText: '#374151',
  langOptionActiveText: '#4f46e5',

  // Document bubble
  documentCardBg: 'rgba(255,255,255,0.15)',
  documentCardBgReceived: '#f9fafb',

  // Recording bar
  recordingBarBg: '#fef2f2',
  recordingText: '#ef4444',

  // Magic refine
  magicBtnBg: '#fdf4ff',
  magicBtnBorder: '#e9d5ff',
  magicBtnPressedBg: '#f3e8ff',

  // Edit bar
  editBarBg: '#fffbeb',
  editBarBorder: '#fcd34d',
  editBarText: '#92400e',

  // Action card
  actionCardBg: '#f0fdf4',
  actionCardBorder: '#bbf7d0',
  actionCardText: '#166534',

  // Tab bar
  tabBarBg: '#ffffff',
  tabBarBorder: '#f3f4f6',
  tabBarActive: '#4f46e5',
  tabBarInactive: '#9ca3af',

  // Attachment sheet
  sheetBg: '#ffffff',
  sheetHandle: '#d1d5db',
  sheetTitleText: '#374151',
  sheetBtnLabel: '#374151',

  // Status bar
  statusBarStyle: 'light' as const,

  // Loading
  spinnerColor: '#4f46e5',

  // Profile screen
  profileBg: '#f9fafb',
  cardBg: '#ffffff',
  cardBorder: '#e5e7eb',

  // Chevron
  chevronColor: '#9ca3af',

  // Connection dot
  dotOnline: '#34d399',
  dotOffline: '#f87171',

  // Chat search
  searchModalBg: '#ffffff',
  searchHighlight: '#fef08a',
  searchHighlightText: '#713f12',
  searchResultBorder: '#f3f4f6',
  searchResultActiveBg: '#eef2ff',
  searchContentTypeIcon: '#6b7280',
  searchContentTypeBg: '#f3f4f6',
  searchTimestamp: '#9ca3af',
  searchCountBg: 'rgba(79,70,229,0.1)',
  searchCountText: '#4f46e5',
};

const darkColors: typeof lightColors = {
  // Base
  background: '#0f1118',
  surface: '#181a24',
  surfaceElevated: '#1e2030',

  // Text
  text: '#e5e7eb',
  textSecondary: '#9ca3af',
  textTertiary: '#6b7280',
  textInverse: '#111827',

  // Primary / Brand
  primary: '#6366f1',
  primaryLight: '#818cf8',
  primaryFaded: 'rgba(99,102,241,0.18)',

  // Header
  headerBg: '#181a24',
  headerText: '#e5e7eb',
  headerTextSecondary: '#a5b4fc',
  headerAvatarBg: 'rgba(255,255,255,0.12)',

  // Chat bubbles
  bubbleOwn: '#4f46e5',
  bubbleOwnText: '#ffffff',
  bubbleReceived: '#1e2030',
  bubbleReceivedText: '#e5e7eb',
  bubbleShadow: '#000000',

  // Audio player (inside bubbles)
  audioIconOwn: '#ffffff',
  audioIconReceived: '#a5b4fc',
  audioBarInactiveOwn: 'rgba(255,255,255,0.25)',
  audioBarInactiveReceived: 'rgba(165,180,252,0.3)',
  audioBarActiveOwn: '#ffffff',
  audioBarActiveReceived: '#a5b4fc',
  audioTimeOwn: 'rgba(255,255,255,0.80)',
  audioTimeReceived: '#a5b4fc',

  // Translation card
  translationBg: 'rgba(99,102,241,0.12)',
  translationBorder: 'rgba(99,102,241,0.25)',
  translationBgOwn: 'rgba(139,92,246,0.15)',
  translationBorderOwn: 'rgba(139,92,246,0.30)',
  translationText: '#c7d2fe',

  // Confidence badge
  confidenceBg: 'rgba(99,102,241,0.25)',
  confidenceText: '#c7d2fe',

  // AI mediating
  mediatingColor: '#a78bfa',
  mediatingDotBg: '#7c3aed',
  mediatingShimmer: 'rgba(167,139,250,0.25)',

  // Skeleton
  skeletonBase: '#2d3044',
  skeletonHighlight: '#3b3f5c',

  // Processing waveform
  processingWaveformBar: '#f87171',

  // Selection
  selectionBg: 'rgba(99,102,241,0.20)',
  selectionBgOff: 'rgba(99,102,241,0)',
  checkCircleBorder: '#4b5563',
  checkCircleBg: '#1e2030',
  checkCircleActiveBg: '#6366f1',
  checkCircleActiveBorder: '#6366f1',

  // Search bar
  searchBg: '#1e2030',
  searchText: '#e5e7eb',
  searchPlaceholder: '#6b7280',
  searchIcon: '#6b7280',

  // Input bar
  inputWrapperBg: '#0f1118',
  inputBg: '#1e2030',
  inputText: '#e5e7eb',
  inputPlaceholder: '#6b7280',
  inputBorder: '#2d3044',
  inputIconColor: '#9ca3af',

  // Rows / Lists
  rowBorder: '#1e2030',
  rowPressed: '#252838',
  sectionHeaderBg: '#0f1118',
  sectionHeaderText: '#9ca3af',

  // Avatar
  avatarFallbackBg: '#6366f1',
  groupAvatarBg: '#7c3aed',

  // FAB
  fabBg: '#6366f1',
  fabShadow: '#6366f1',

  // Misc
  border: '#2d3044',
  borderLight: '#1e2030',
  divider: '#2d3044',
  destructive: '#ef4444',
  destructiveLight: '#fca5a5',
  success: '#34d399',
  warning: '#f59e0b',

  // Overlay / Modal
  overlayBg: 'rgba(0,0,0,0.65)',
  modalBg: '#1e2030',
  modalText: '#d1d5db',

  // Edited label
  editedLabel: '#6b7280',

  // Empty state
  emptyIcon: '#4b5563',
  emptyText: '#6b7280',
  emptyHint: '#4b5563',

  // Dialect badge
  dialectBadgeBg: 'rgba(165,180,252,0.18)',
  dialectBadgeText: '#a5b4fc',

  // Language picker
  langPickerBg: '#1e2030',
  langPickerTitleColor: '#9ca3af',
  langPickerBorder: '#2d3044',
  langOptionActiveBg: 'rgba(99,102,241,0.18)',
  langOptionText: '#d1d5db',
  langOptionActiveText: '#a5b4fc',

  // Document bubble
  documentCardBg: 'rgba(255,255,255,0.08)',
  documentCardBgReceived: '#252838',

  // Recording bar
  recordingBarBg: 'rgba(239,68,68,0.12)',
  recordingText: '#f87171',

  // Magic refine
  magicBtnBg: 'rgba(168,85,247,0.12)',
  magicBtnBorder: 'rgba(168,85,247,0.3)',
  magicBtnPressedBg: 'rgba(168,85,247,0.22)',

  // Edit bar
  editBarBg: 'rgba(245,158,11,0.12)',
  editBarBorder: '#b45309',
  editBarText: '#fbbf24',

  // Action card
  actionCardBg: 'rgba(34,197,94,0.10)',
  actionCardBorder: 'rgba(34,197,94,0.25)',
  actionCardText: '#86efac',

  // Tab bar
  tabBarBg: '#181a24',
  tabBarBorder: '#2d3044',
  tabBarActive: '#818cf8',
  tabBarInactive: '#6b7280',

  // Attachment sheet
  sheetBg: '#1e2030',
  sheetHandle: '#4b5563',
  sheetTitleText: '#d1d5db',
  sheetBtnLabel: '#d1d5db',

  // Status bar
  statusBarStyle: 'light' as const,

  // Loading
  spinnerColor: '#818cf8',

  // Profile screen
  profileBg: '#0f1118',
  cardBg: '#1e2030',
  cardBorder: '#2d3044',

  // Chevron
  chevronColor: '#4b5563',

  // Connection dot
  dotOnline: '#34d399',
  dotOffline: '#f87171',

  // Chat search
  searchModalBg: '#0f1118',
  searchHighlight: 'rgba(250,204,21,0.3)',
  searchHighlightText: '#fef08a',
  searchResultBorder: '#1e2030',
  searchResultActiveBg: 'rgba(99,102,241,0.15)',
  searchContentTypeIcon: '#9ca3af',
  searchContentTypeBg: '#252838',
  searchTimestamp: '#6b7280',
  searchCountBg: 'rgba(99,102,241,0.15)',
  searchCountText: '#a5b4fc',
};

export type AppColors = typeof lightColors;

// ── Context ──────────────────────────────────────────────────────────────────

interface ThemeContextType {
  isDark: boolean;
  colors: AppColors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  colors: lightColors,
  toggleTheme: () => {},
});

const THEME_KEY = 'app_theme_preference';

// ── Provider ─────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [userPref, setUserPref] = useState<'light' | 'dark' | null>(null);

  // Load stored preference on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await getSecureItem(THEME_KEY);
        if (stored === 'light' || stored === 'dark') {
          setUserPref(stored);
        }
      } catch {
        // ignore — use system default
      }
    })();
  }, []);

  const isDark = userPref ? userPref === 'dark' : systemScheme === 'dark';
  const colors = isDark ? darkColors : lightColors;

  const toggleTheme = useCallback(async () => {
    const next = isDark ? 'light' : 'dark';
    setUserPref(next);
    try {
      await setSecureItem(THEME_KEY, next);
    } catch {
      // ignore
    }
  }, [isDark]);

  const value = useMemo(
    () => ({ isDark, colors, toggleTheme }),
    [isDark, colors, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useTheme() {
  return useContext(ThemeContext);
}
