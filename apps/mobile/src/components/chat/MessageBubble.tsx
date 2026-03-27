import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useDerivedValue,
  useAnimatedReaction,
  withRepeat,
  withTiming,
  withSequence,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { SharedValue } from 'react-native-reanimated';
import { API_BASE_URL } from '../../services/api';
import { useTheme } from '../../contexts/ThemeContext';
import { useChatList } from '../../contexts/ChatListContext';
import { useChatAudioPlayer } from '../../contexts/ChatAudioPlayerContext';
import DocumentBubbleContent from './DocumentBubbleContent';
import ActionCard, { type ExtractedAction } from './ActionCard';

// ── Types ────────────────────────────────────────────────────────────────────
interface Translations {
  english: string;
  singlish: string;
  tanglish: string;
}

interface TranslatedAudioUrls {
  english?: string;
  singlish?: string;
  tanglish?: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  contentType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  rawContent: string;
  translations?: Translations | null;
  detectedLanguage?: 'english' | 'singlish' | 'tanglish' | 'mixed' | 'unknown' | null;
  originalTone?: string | null;
  translatedAudioUrls?: TranslatedAudioUrls | null;
  confidenceScore?: number | null;
  extractedActions?: ExtractedAction[] | null;
  isOptimistic?: boolean;
  isRetrying?: boolean;
  /** Set when the server has saved the raw message but AI translation is
   *  still in progress (two-phase send). Cleared when `messageTranslated`
   *  arrives from the server. */
  isTranslating?: boolean;
  isEdited?: boolean;
  createdAt?: string;
}

// PreferredLanguage is now sourced from ChatListContext

interface MessageBubbleProps {
  message: ChatMessage;
  currentUserId: string;
  onRetry?: (messageId: string) => void;
  /** Called when the user long-presses the message — triggers selection mode */
  onLongPress?: (messageId: string) => void;
  /** Called when the user taps the message while in selection mode */
  onPress?: (messageId: string) => void;
  /** Called when the user taps a document bubble to open the interrogation modal */
  onOpenDocumentInterrogation?: (messageId: string, fileUrl: string, initialPage?: number) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Rewrites a server-relative audio URL so it works on physical devices.
 * When BASE_URL is not set on the API, files are stored as
 * "http://localhost:3000/uploads/…". On a mobile device `localhost` refers
 * to the device itself — not the server — so playback silently fails.
 * We replace the origin with API_BASE_URL (which already points to the
 * real server IP) so the device can actually reach the file.
 */
function normalizeAudioUri(uri: string): string {
  if (!uri) return uri;
  // Keep local file:// URIs (optimistic recordings) untouched.
  if (uri.startsWith('file://')) return uri;
  // Replace any localhost / 127.0.0.1 origin with the configured API host.
  return uri.replace(
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/,
    API_BASE_URL.replace(/\/$/, ''),
  );
}

// ── Sub-Components ───────────────────────────────────────────────────────────
/** Formats seconds into a m:ss string for the playback timer. */
function formatAudioTime(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
/** Formats an ISO timestamp into a short "H:MM AM/PM" string. */
function formatSentTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ── Shared animation driver for all AIMediatingIndicator instances ──────────
// A single React context provides ONE set of animated values that every
// indicator reads from on the UI thread. This means even 50 visible
// "AI mediating…" badges drive from just 2 shared values total instead of
// 7 per instance (was: 50×7 = 350 concurrent infinite animations).
const MediatingAnimContext = React.createContext<{
  shimmer: SharedValue<number>;
  dotPhase: SharedValue<number>;
} | null>(null);

/** Mount once near the list root — drives ALL AIMediatingIndicator instances. */
export function MediatingAnimProvider({ children }: { children: React.ReactNode }) {
  const shimmer = useSharedValue(0);
  const dotPhase = useSharedValue(0);

  useEffect(() => {
    // Single shimmer loop (opacity pulse) shared by every indicator
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true, // reverse for smooth back-and-forth
    );
    // Single dot phase loop: 0→1 over 800ms, reverses
    dotPhase.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [shimmer, dotPhase]);

  const value = useMemo(() => ({ shimmer, dotPhase }), [shimmer, dotPhase]);
  return (
    <MediatingAnimContext.Provider value={value}>
      {children}
    </MediatingAnimContext.Provider>
  );
}

/** Lightweight "AI mediating…" indicator — all animation values read from shared context. */
function AIMediatingIndicator() {
  const { colors } = useTheme();
  const anim = React.useContext(MediatingAnimContext);

  // Derive per-dot styles from the single shared dotPhase via stagger offsets.
  // If provider is missing (should never happen), fall back to static display.
  const shimmerTextStyle = useAnimatedStyle(() => ({
    opacity: anim ? 0.55 + anim.shimmer.value * 0.45 : 1,
  }));

  const dotStyle0 = useAnimatedStyle(() => {
    const v = anim ? anim.dotPhase.value : 0;
    return { opacity: 0.4 + v * 0.6, transform: [{ scale: 0.6 + v * 0.4 }] };
  });
  const dotStyle1 = useAnimatedStyle(() => {
    // Offset the phase by ~0.33 for stagger effect
    const raw = anim ? (anim.dotPhase.value + 0.33) % 1 : 0;
    const v = raw > 0.5 ? 2 * (1 - raw) : 2 * raw; // triangle wave
    return { opacity: 0.4 + v * 0.6, transform: [{ scale: 0.6 + v * 0.4 }] };
  });
  const dotStyle2 = useAnimatedStyle(() => {
    const raw = anim ? (anim.dotPhase.value + 0.66) % 1 : 0;
    const v = raw > 0.5 ? 2 * (1 - raw) : 2 * raw;
    return { opacity: 0.4 + v * 0.6, transform: [{ scale: 0.6 + v * 0.4 }] };
  });

  const dotBase = {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.mediatingDotBg,
  } as const;

  return (
    <View style={styles.mediatingRow}>
      <Ionicons name="sparkles" size={12} color={colors.mediatingColor} />
      <Animated.Text style={[styles.mediatingText, { color: colors.mediatingColor }, shimmerTextStyle]}>
        AI mediating
      </Animated.Text>
      <View style={styles.mediatingDots}>
        <Animated.View style={[dotBase, dotStyle0]} />
        <Animated.View style={[dotBase, dotStyle1]} />
        <Animated.View style={[dotBase, dotStyle2]} />
      </View>
    </View>
  );
}

// ── Waveform helpers ─────────────────────────────────────────────────────────
/** Number of waveform bars shown in the playback visualiser.
 *  Reduced from 32 → 20 to cut View element count (2 layers × 20 = 40 vs 64). */
const PLAYER_WAVEFORM_BARS = 20;

/**
 * Generate a deterministic list of bar heights (0–1) seeded by the audio URI
 * so the waveform stays consistent between renders and re-mounts.
 */
function generateWaveform(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return Array.from({ length: count }, (_, i) => {
    const v = Math.abs(Math.sin(h * 9301 + i * 49297 + 233));
    // Clamp to [0.12, 1] so there are no invisible bars
    return 0.12 + v * 0.88;
  });
}

/**
 * Lightweight audio player bubble — does NOT create its own native audio player.
 * Instead it reads from the shared ChatAudioPlayerProvider. Only the bubble
 * whose messageId matches the provider's activeMessageId shows animated
 * progress; all others render a cheap static waveform + play icon.
 *
 * This eliminates N native player instances + N×100ms status subscriptions
 * during scroll, replacing them with a SINGLE shared player in the provider.
 */
const AudioPlayer = memo(function AudioPlayer({
  uri,
  isOwn,
  sentAt,
  messageId,
  initialDurationMs = 0,
}: {
  uri: string;
  isOwn: boolean;
  sentAt?: string;
  messageId: string;
  initialDurationMs?: number;
}) {
  const { colors } = useTheme();
  const normalizedUri = normalizeAudioUri(uri);
  const audioCtx = useChatAudioPlayer(); // stable context — NEVER triggers re-renders

  // Shared values kept on the UI thread for smooth animation.
  const trackWidthSV = useSharedValue(0);

  // Stable waveform shape — seeded from URI so it never jumps on re-render.
  const waveform = useMemo(() => generateWaveform(uri, PLAYER_WAVEFORM_BARS), [uri]);

  // ── Play/pause icon — only re-renders this component when state flips ──
  const [showPause, setShowPause] = useState(false);
  useAnimatedReaction(
    () => audioCtx.activeMessageId.value === messageId && audioCtx.isPlayingSV.value,
    (playing, prev) => {
      if (playing !== prev) {
        runOnJS(setShowPause)(playing);
      }
    },
  );

  // ── Time label — updates once per second, ONLY for the active bubble ───
  const defaultLabel = initialDurationMs > 0 ? formatAudioTime(initialDurationMs / 1000) : '0:00';
  const [timeLabel, setTimeLabel] = useState(defaultLabel);
  const updateTimeLabel = useCallback(
    (remaining: number) => setTimeLabel(formatAudioTime(remaining)),
    [],
  );
  const resetTimeLabel = useCallback(() => setTimeLabel(defaultLabel), [defaultLabel]);

  useAnimatedReaction(
    () => {
      const active = audioCtx.activeMessageId.value === messageId;
      if (!active) return { active: false as const, sec: -1 };
      const rem = audioCtx.durationSV.value > 0
        ? Math.max(0, audioCtx.durationSV.value - audioCtx.currentTimeSV.value)
        : 0;
      return { active: true as const, sec: Math.floor(rem) };
    },
    (curr, prev) => {
      if (!curr.active) {
        if (prev?.active) runOnJS(resetTimeLabel)();
        return;
      }
      if (curr.sec !== (prev?.sec ?? -1)) {
        const rem = audioCtx.durationSV.value - audioCtx.currentTimeSV.value;
        runOnJS(updateTimeLabel)(Math.max(0, rem));
      }
    },
  );

  // ── Waveform progress overlay (pure UI thread) ────────────────────────
  const animatedOverlayStyle = useAnimatedStyle(() => {
    if (audioCtx.activeMessageId.value !== messageId) return { width: 0 };
    return { width: audioCtx.smoothProgress.value * trackWidthSV.value };
  });
  const animatedInnerStyle = useAnimatedStyle(() => ({
    width: trackWidthSV.value,
  }));

  const handleToggle = useCallback(() => {
    if (!normalizedUri) return;
    audioCtx.toggle(messageId, normalizedUri);
  }, [audioCtx, messageId, normalizedUri]);

  const handleSeek = useCallback(
    (evt: { nativeEvent: { locationX: number } }) => {
      if (audioCtx.activeMessageId.value !== messageId || trackWidthSV.value <= 0) return;
      const fraction = Math.max(0, Math.min(1, evt.nativeEvent.locationX / trackWidthSV.value));
      audioCtx.seek(fraction);
    },
    [audioCtx, messageId, trackWidthSV],
  );
  const sentTimeStr = sentAt ? formatSentTime(sentAt) : null;

  const iconColor   = isOwn ? colors.audioIconOwn        : colors.audioIconReceived;
  const barInactive = isOwn ? colors.audioBarInactiveOwn : colors.audioBarInactiveReceived;
  const barActive   = isOwn ? colors.audioBarActiveOwn   : colors.audioBarActiveReceived;
  const timeColor   = isOwn ? colors.audioTimeOwn        : colors.audioTimeReceived;

  // Memoize the static bar elements — these only change when the waveform
  // seed or theme colours change, not on every 100ms status tick.
  const inactiveBars = useMemo(
    () => waveform.map((h, i) => (
      <View key={i} style={[styles.waveformBar, { height: Math.round(h * 28), backgroundColor: barInactive }]} />
    )),
    [waveform, barInactive],
  );
  const activeBars = useMemo(
    () => waveform.map((h, i) => (
      <View key={i} style={[styles.waveformBar, { height: Math.round(h * 28), backgroundColor: barActive }]} />
    )),
    [waveform, barActive],
  );

  return (
    <View style={styles.audioWrapper}>
      {/* ── Top row: play button + waveform ── */}
      <View style={styles.audioTopRow}>
        <Pressable
          onPress={handleToggle}
          hitSlop={8}
          style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name={showPause ? 'pause' : 'play'} size={22} color={iconColor} />
        </Pressable>

        {/* Waveform — tappable for seeking */}
        <Pressable
          onLayout={(e) => { trackWidthSV.value = e.nativeEvent.layout.width; }}
          onPress={handleSeek}
          hitSlop={8}
          style={styles.waveformContainer}
        >
          {/* Background (inactive) bars */}
          {inactiveBars}

          {/* Foreground (active) bars clipped to animated progress width */}
          <Animated.View style={[styles.waveformOverlay, animatedOverlayStyle]}>
            <Animated.View style={[styles.waveformOverlayInner, animatedInnerStyle]}>
              {activeBars}
            </Animated.View>
          </Animated.View>
        </Pressable>
      </View>

      {/* ── Footer: remaining time (left) + sent time (right) ── */}
      <View style={styles.audioFooter}>
        <Text style={[styles.audioTime, { color: timeColor }]}>{timeLabel}</Text>
        {sentTimeStr !== null && (
          <Text style={[styles.audioTime, { color: timeColor }]}>{sentTimeStr}</Text>
        )}
      </View>
    </View>
  );
});

// ── Translation Section (extracted to isolate animation hooks) ──────────────
// Owns all translation expand/collapse & TTS state so that own-sent messages
// (which never show a translation card) never allocate these hooks.
interface TranslationSectionProps {
  isOwn: boolean;
  showMediating: boolean;
  isOptimistic?: boolean;
  contentType: string;
  translations?: Translations | null;
  translatedAudioUrls?: TranslatedAudioUrls | null;
  preferredLanguage: 'english' | 'singlish' | 'tanglish';
  confidenceScore?: number | null;
  messageId: string;
  onRetry?: (messageId: string) => void;
}

const TRANSLATION_COLLAPSED_H = 3 * 20; // 3 lines × lineHeight 20
const translationLayoutCache = new Map<string, { fullHeight: number; truncatable: boolean }>();

const TranslationSection = memo(function TranslationSection({
  isOwn,
  showMediating,
  isOptimistic,
  contentType,
  translations,
  translatedAudioUrls,
  preferredLanguage,
  confidenceScore,
  messageId,
  onRetry,
}: TranslationSectionProps) {
  const { colors } = useTheme();
  const audioCtx = useChatAudioPlayer();

  const translationCacheKey = `${messageId}:${preferredLanguage}`;
  const cachedLayout = translationLayoutCache.get(translationCacheKey);

  // ── Expand/collapse animation ──────────────────────────────────────────
  const [translationExpanded, setTranslationExpanded] = useState(false);
  const [translationTruncatable, setTranslationTruncatable] = useState(cachedLayout?.truncatable ?? false);
  const translationFullHeight = useRef(cachedLayout?.fullHeight ?? 0);
  const translationHeight = useSharedValue(TRANSLATION_COLLAPSED_H);
  const translationChevronAngle = useSharedValue(0);
  const translationTextStyle = useAnimatedStyle(() => ({
    maxHeight: translationHeight.value,
  }));
  const translationChevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${translationChevronAngle.value}deg` }],
  }));

  const translatedAudioEntries = useMemo(() => {
    if (contentType !== 'AUDIO' || isOwn || !translatedAudioUrls) return [];

    const labels: Record<'english' | 'singlish' | 'tanglish', string> = {
      english: 'English',
      singlish: 'Singlish',
      tanglish: 'Tanglish',
    };

    const preferredUrl = translatedAudioUrls[preferredLanguage];
    if (!preferredUrl) return [];

    return [
      {
        language: preferredLanguage,
        label: labels[preferredLanguage],
        url: preferredUrl,
      },
    ];
  }, [contentType, isOwn, preferredLanguage, translatedAudioUrls]);

  const handleTranslatedAudioPress = useCallback(
    (language: 'english' | 'singlish' | 'tanglish', url: string) => {
      audioCtx.toggle(`${messageId}:translated:${language}`, normalizeAudioUri(url));
    },
    [audioCtx, messageId],
  );

  // ── Branching renders ─────────────────────────────────────────────────
  if (isOwn) return null;

  // IMAGE and DOCUMENT messages have no translatable text — suppress both
  // the mediating indicator and any translation card for these types.
  if (contentType === 'IMAGE' || contentType === 'DOCUMENT') return null;

  if (showMediating) {
    return (
      <View style={styles.mediatingContainer}>
        <AIMediatingIndicator />
        {!isOptimistic && onRetry && (
          <Pressable onPress={() => onRetry(messageId)} hitSlop={8} style={styles.retryBtn}>
            <Ionicons name="refresh" size={14} color={colors.mediatingColor} />
          </Pressable>
        )}
      </View>
    );
  }

  if (!translations) return null;

  const translatedText = translations[preferredLanguage];
  const score = confidenceScore != null ? Math.round(confidenceScore) : null;

  return (
    <View style={[
      styles.translationCard,
      {
        backgroundColor: isOwn ? colors.translationBgOwn : colors.translationBg,
        borderColor: isOwn ? colors.translationBorderOwn : colors.translationBorder,
      },
    ]}>
      {/* Measure the visible text directly via onTextLayout — no hidden duplicate */}
      <Animated.View style={[translationTextStyle, { overflow: 'hidden' }]}>
        <Text
          style={[styles.translationText, { color: colors.translationText }]}
          onTextLayout={(e) => {
            const lines = e.nativeEvent.lines;
            const fullH = lines.reduce((s, l) => s + l.height, 0);
            const truncatable = lines.length > 3;

            const cached = translationLayoutCache.get(translationCacheKey);
            if (cached && cached.fullHeight === fullH && cached.truncatable === truncatable) {
              return;
            }

            translationLayoutCache.set(translationCacheKey, {
              fullHeight: fullH,
              truncatable,
            });

            if (translationFullHeight.current !== fullH) {
              translationFullHeight.current = fullH;
            }
            if (truncatable !== translationTruncatable) {
              requestAnimationFrame(() => setTranslationTruncatable(truncatable));
            }
          }}
        >
          {translatedText}
        </Text>
      </Animated.View>

      {translationTruncatable && (
        <Pressable
          onPress={() => {
            const next = !translationExpanded;
            setTranslationExpanded(next);
            const targetH = next ? translationFullHeight.current : TRANSLATION_COLLAPSED_H;
            translationHeight.value = withTiming(targetH, {
              duration: 260,
              easing: Easing.out(Easing.cubic),
            });
            translationChevronAngle.value = withTiming(next ? 180 : 0, { duration: 260 });
          }}
          hitSlop={8}
          style={styles.translationExpandBtn}
        >
          <Animated.View style={translationChevronStyle}>
            <Ionicons name="chevron-down" size={14} color={colors.translationText} />
          </Animated.View>
        </Pressable>
      )}

      <View style={styles.translationFooter}>
        {translatedAudioEntries.length > 0 && (
          <View style={styles.translatedAudioRow}>
            {translatedAudioEntries.map((entry) => (
              <Pressable
                key={entry.language}
                onPress={() => handleTranslatedAudioPress(entry.language, entry.url)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.translatedAudioBtn,
                  { backgroundColor: colors.confidenceBg },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons name="play" size={12} color={colors.primaryLight} />
                <Text style={[styles.translatedAudioText, { color: colors.primaryLight }]}>
                  {entry.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {score != null && (
          <View style={[styles.confidenceBadge, { backgroundColor: colors.confidenceBg }]}>
            <Text style={[styles.confidenceText, { color: colors.confidenceText }]}>⚡ {score}%</Text>
          </View>
        )}
        {onRetry && (
          <Pressable onPress={() => onRetry(messageId)} hitSlop={8} style={styles.retryBtn}>
            <Ionicons name="refresh" size={14} color={colors.primaryLight} />
          </Pressable>
        )}
      </View>
    </View>
  );
});

// ── Main Component ───────────────────────────────────────────────────────────
function MessageBubble({
  message,
  currentUserId,
  onRetry,
  onLongPress,
  onPress,
  onOpenDocumentInterrogation,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const {
    selectionMode,
    selectionModeProgress,
    selectedIdsMap,
    highlightedMessageId,
    preferredLanguage,
  } = useChatList();

  const isOwn = message.senderId === currentUserId;
  const { contentType, rawContent, translations, confidenceScore, isOptimistic, isRetrying } = message;

  const showMediating =
    isOptimistic === true || isRetrying === true || message.isTranslating === true;

  // ── Highlight animation (from search navigation) ────────────────────────
  // Driven entirely on the UI thread via useAnimatedReaction — changing
  // highlightedMessageId.value never triggers a JS re-render.
  const highlightOpacity = useSharedValue(0);

  useAnimatedReaction(
    () => highlightedMessageId.value === message.id,
    (isHighlighted, wasHighlighted) => {
      if (isHighlighted && !wasHighlighted) {
        highlightOpacity.value = withTiming(1, { duration: 200 });
        // Auto-fade after 1.5s — using withTiming chain on the UI thread
        highlightOpacity.value = withSequence(
          withTiming(1, { duration: 200 }),
          withTiming(1, { duration: 1500 }), // hold
          withTiming(0, { duration: 800 }),   // fade out
        );
      } else if (!isHighlighted && wasHighlighted) {
        highlightOpacity.value = withTiming(0, { duration: 200 });
      }
    },
    [message.id],
  );

  // ── Selection animation (100% UI-thread) ────────────────────────────────
  const isSelectedSV = useDerivedValue(
    () => (selectedIdsMap.value[message.id] ? 1 : 0) as number,
  );

  const selectionProgress = useDerivedValue(() =>
    withTiming(isSelectedSV.value, { duration: 180 }),
  );

  const checkScale = useDerivedValue(() =>
    withTiming(isSelectedSV.value === 1 ? 1 : 0.6, { duration: 160 }),
  );

  const SELECTION_OFFSET = 28;

  // ── CONSOLIDATED animated styles (3 instead of 8) ─────────────────────
  // 1. Outer row wrapper: highlight + selection background (uses opacity
  //    overlay instead of expensive interpolateColor on every frame).
  const animatedRowWrapperStyle = useAnimatedStyle(() => ({
    opacity: 1, // keeps the row visible
    backgroundColor: selectionProgress.value > 0.01
      ? `rgba(99,102,241,${selectionProgress.value * 0.12})`
      : 'transparent',
  }));

  // 2. Highlight overlay — separate so it doesn't fight with selection
  const highlightStyle = useAnimatedStyle(() => ({
    opacity: highlightOpacity.value * 0.2,
  }));

  // 3. Bubble slide + checkmark combined
  const animatedBubbleSlide = useAnimatedStyle(() => ({
    transform: [{ translateX: (isOwn ? -1 : 1) * selectionModeProgress.value * SELECTION_OFFSET }],
  }));

  const animatedCheckStyle = useAnimatedStyle(() => ({
    opacity: selectionModeProgress.value,
    transform: [{ scale: checkScale.value }],
  }));

  // Check icon: rendered purely via animated opacity — no JS boolean bridge.
  // The checkmark icon is always mounted but invisible via the parent's opacity.
  // When selected, the background + icon become visible via the parent check style.
  const checkBgStyle = useAnimatedStyle(() => ({
    backgroundColor: isSelectedSV.value === 1
      ? colors.checkCircleActiveBg
      : colors.checkCircleBg,
    borderColor: isSelectedSV.value === 1
      ? colors.checkCircleActiveBorder
      : colors.checkCircleBorder,
  }));

  const checkIconStyle = useAnimatedStyle(() => ({
    opacity: isSelectedSV.value === 1 ? 1 : 0,
  }));

  // ── Optimistic pulse — only allocate animation for optimistic messages ──
  const optimisticOpacity = useSharedValue(isOptimistic ? 0.7 : 1);
  useEffect(() => {
    if (isOptimistic) {
      optimisticOpacity.value = withRepeat(
        withSequence(
          withTiming(0.85, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.7, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    } else {
      optimisticOpacity.value = 1;
    }
  }, [isOptimistic, optimisticOpacity]);

  // Overwrite the optimistic style only when actually optimistic
  const optimisticPulseStyle = useAnimatedStyle(() => {
    if (!isOptimistic) return {};
    return { opacity: optimisticOpacity.value };
  });

  // ── Content (memoized to avoid re-creating JSX on unrelated state changes) ─
  const content = useMemo(() => {
    switch (contentType) {
      case 'TEXT':
        return (
          <Text style={[styles.messageText, { color: isOwn ? colors.bubbleOwnText : colors.bubbleReceivedText }]}>
            {rawContent}
          </Text>
        );

      case 'IMAGE':
        return (
          <Image
            source={{ uri: rawContent }}
            style={styles.image}
            contentFit="cover"
            transition={200}
            recyclingKey={message.id}
          />
        );

      case 'AUDIO': {
        let uri = rawContent;
        let durationMs = 0;
        if (rawContent.startsWith('{')) {
          try {
            const parsed = JSON.parse(rawContent);
            if (typeof parsed.url === 'string') uri = parsed.url;
            if (typeof parsed.durationMs === 'number') durationMs = parsed.durationMs;
          } catch (e) {}
        }
        
        const isInaudible =
          confidenceScore != null &&
          confidenceScore <= 25 &&
          !translations &&
          !message.isTranslating &&
          !message.isOptimistic;

        return (
          <View>
            <AudioPlayer uri={uri} isOwn={isOwn} sentAt={message.createdAt} messageId={message.id} initialDurationMs={durationMs} />
            {isInaudible && (
              <View style={[styles.inaudibleBadge, { backgroundColor: isOwn ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.05)' }]}>
                <Ionicons name="volume-mute-outline" size={14} color={isOwn ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.4)'} style={{ marginRight: 4 }} />
                <Text style={[styles.inaudibleText, { color: isOwn ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.4)' }]}>
                  Inaudible
                </Text>
              </View>
            )}
          </View>
        );
      }

      case 'DOCUMENT':
        return (
          <DocumentBubbleContent
            messageId={message.id}
            fileUrl={rawContent}
            isOwn={isOwn}
            onOpenInterrogation={() =>
              onOpenDocumentInterrogation?.(message.id, rawContent)
            }
            onOpenInterrogationAtPage={(page) =>
              onOpenDocumentInterrogation?.(message.id, rawContent, page)
            }
          />
        );

      default:
        return null;
    }
  }, [contentType, rawContent, isOwn, message.id, message.createdAt, colors.bubbleOwnText, colors.bubbleReceivedText, onOpenDocumentInterrogation]);

  // In normal mode nothing happens; in selection mode the tap selects/
  // deselects. Checking the shared value instead of a React boolean means
  // the Pressable can always have an onPress without triggering re-renders.
  const handleTap = useCallback(() => {
    if (selectionMode) onPress?.(message.id);
  }, [selectionMode, message.id, onPress]);

  // Stable long-press handler — avoids inline closure recreation.
  const handleLongPressLocal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLongPress?.(message.id);
  }, [onLongPress, message.id]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Pressable
      onLongPress={handleLongPressLocal}
      onPress={handleTap}
      delayLongPress={300}
    >
      <Animated.View style={[styles.rowWrapper, animatedRowWrapperStyle]}>
        {/* Highlight overlay — absolutely positioned, cheap opacity-only anim */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.highlightOverlay, highlightStyle]} />

        {/* Checkmark — always mounted, visibility via parent animated opacity */}
        <Animated.View style={[
          styles.checkCircle,
          isOwn ? styles.checkCircleOwn : styles.checkCircleOther,
          animatedCheckStyle,
        ]}>
          <Animated.View style={[
            styles.checkCircleInner,
            checkBgStyle,
          ]}>
            <Animated.View style={checkIconStyle}>
              <Ionicons name="checkmark" size={13} color="#fff" />
            </Animated.View>
          </Animated.View>
        </Animated.View>

        <Animated.View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther, animatedBubbleSlide]}>
          <View style={styles.bubbleColumn}>
            <Animated.View
              style={[
                styles.bubble,
                {
                  backgroundColor: isOwn ? colors.bubbleOwn : colors.bubbleReceived,
                  shadowColor: colors.bubbleShadow,
                },
                isOwn ? styles.bubbleOwn : styles.bubbleOther,
                isOptimistic ? optimisticPulseStyle : undefined,
              ]}
            >
              {content}
            </Animated.View>

            {/* "edited" label — shown for all participants once a message is edited */}
            {message.isEdited && (
              <Text style={[styles.editedLabel, { color: colors.editedLabel }, isOwn && styles.editedLabelOwn]}>
                edited
              </Text>
            )}

            {/* Translation card */}
            <TranslationSection
              isOwn={isOwn}
              showMediating={showMediating}
              isOptimistic={isOptimistic}
              contentType={contentType}
              translations={translations}
              translatedAudioUrls={message.translatedAudioUrls}
              preferredLanguage={preferredLanguage}
              confidenceScore={confidenceScore}
              messageId={message.id}
              onRetry={onRetry}
            />

            {/* Action cards — meetings, reminders extracted by AI */}
            {message.extractedActions && message.extractedActions.length > 0 && (
              <ActionCard actions={message.extractedActions} isOwn={isOwn} />
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

// ── Custom memo comparator ───────────────────────────────────────────────────
// React.memo's default shallow comparison fails for the `message` object because
// every setMessages() creates new references. This deep-compares only the fields
// that actually affect rendering, preventing unnecessary re-renders during scroll.
function arePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  const pm = prev.message;
  const nm = next.message;
  return (
    pm.id === nm.id &&
    pm.rawContent === nm.rawContent &&
    pm.contentType === nm.contentType &&
    pm.senderId === nm.senderId &&
    pm.isOptimistic === nm.isOptimistic &&
    pm.isRetrying === nm.isRetrying &&
    pm.isEdited === nm.isEdited &&
    pm.confidenceScore === nm.confidenceScore &&
    pm.translations === nm.translations &&
    pm.translatedAudioUrls === nm.translatedAudioUrls &&
    pm.detectedLanguage === nm.detectedLanguage &&
    pm.originalTone === nm.originalTone &&
    pm.extractedActions === nm.extractedActions &&
    prev.currentUserId === next.currentUserId &&
    prev.onRetry === next.onRetry &&
    prev.onLongPress === next.onLongPress &&
    prev.onPress === next.onPress &&
    prev.onOpenDocumentInterrogation === next.onOpenDocumentInterrogation
  );
}

export default memo(MessageBubble, arePropsEqual);

// ── Styles ───────────────────────────────────────────────────────────────────
const BUBBLE_MAX_WIDTH = '78%' as const;

const styles = StyleSheet.create({
  // Animated wrapper for selection background
  rowWrapper: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },

  // Highlight overlay — a cheap absolute fill with fixed bg color
  highlightOverlay: {
    backgroundColor: 'rgba(250,204,21,1)',
    borderRadius: 12,
  },

  // Row alignment
  row: {
    marginVertical: 2,
    maxWidth: BUBBLE_MAX_WIDTH,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  rowOwn: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  rowOther: {
    alignSelf: 'flex-start',
  },

  checkCircle: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleOther: {
    position: 'absolute',
    left: 6,
    bottom: 4,
  },
  checkCircleOwn: {
    position: 'absolute',
    right: 6,
    bottom: 4,
  },
  checkCircleInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Bubble column (bubble + edited label)
  bubbleColumn: {
    flexShrink: 1,
  },

  // Bubble
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  bubbleOwn: {
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    borderBottomLeftRadius: 4,
  },

  // Text
  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },

  // Edited label
  editedLabel: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
    marginLeft: 4,
  },
  editedLabelOwn: {
    textAlign: 'right',
    marginRight: 4,
    marginLeft: 0,
  },

  // Image
  image: {
    width: 220,
    height: 180,
    borderRadius: 12,
  },

  // Audio player
  audioWrapper: {
    paddingVertical: 4,
    minWidth: 200,
  },
  audioTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playBtn: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveformContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    gap: 2,
  },
  waveformOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  waveformOverlayInner: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    gap: 2,
  },
  waveformBar: {
    flex: 1,
    borderRadius: 2,
    minHeight: 3,
  },
  audioFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
    paddingLeft: 38,
  },
  audioTime: {
    fontSize: 11,
    fontWeight: '500',
  },
  inaudibleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
    marginLeft: 38,
  },
  inaudibleText: {
    fontSize: 12,
    fontWeight: '500',
  },

  // AI mediating
  mediatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginLeft: 12,
  },
  mediatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  mediatingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 2,
  },
  mediatingText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  retryBtn: {
    marginLeft: 6,
    padding: 2,
  },

  // Translation card
  translationCard: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  translationText: {
    fontSize: 14,
    lineHeight: 20,
  },
  translationExpandBtn: {
    alignSelf: 'center',
    marginTop: 2,
    padding: 2,
  },
  translationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 6,
  },
  confidenceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: '600',
  },

  translatedAudioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  translatedAudioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  translatedAudioText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
