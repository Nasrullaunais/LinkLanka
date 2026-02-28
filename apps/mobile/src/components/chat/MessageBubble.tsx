import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import * as Speech from 'expo-speech';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, AudioModule } from 'expo-audio';
import { API_BASE_URL } from '../../services/api';
import { useTheme } from '../../contexts/ThemeContext';
import { useChatList } from '../../contexts/ChatListContext';
import DocumentBubbleContent from './DocumentBubbleContent';
import ActionCard, { type ExtractedAction } from './ActionCard';

// ── Types ────────────────────────────────────────────────────────────────────
interface Translations {
  english: string;
  singlish: string;
  tanglish: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  contentType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  rawContent: string;
  translations?: Translations | null;
  confidenceScore?: number | null;
  extractedActions?: ExtractedAction[] | null;
  isOptimistic?: boolean;
  isRetrying?: boolean;
  isEdited?: boolean;
  isSelected?: boolean;
  createdAt?: string;
}

type PreferredLanguage = 'english' | 'singlish' | 'tanglish';

interface MessageBubbleProps {
  message: ChatMessage;
  currentUserId: string;
  preferredLanguage: PreferredLanguage;
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
/** Enhanced "AI mediating…" indicator with wave-dots and shimmer text. */
function AIMediatingIndicator() {
  const { colors } = useTheme();

  // ── Sparkle icon: subtle continuous rotation ──
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 4000, easing: Easing.linear }),
      -1, // infinite
      false,
    );
  }, [rotation]);
  const sparkleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // ── Three wave-dots: staggered scale + opacity ──
  const dot0 = useSharedValue(0);
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  useEffect(() => {
    const bounce = withRepeat(
      withSequence(
        withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 400, easing: Easing.in(Easing.ease) }),
      ),
      -1,
      false,
    );
    dot0.value = bounce;
    dot1.value = withDelay(150, bounce);
    dot2.value = withDelay(300, bounce);
  }, [dot0, dot1, dot2]);

  const dotStyle0 = useAnimatedStyle(() => ({
    opacity: 0.4 + dot0.value * 0.6,
    transform: [{ scale: 0.6 + dot0.value * 0.4 }],
  }));
  const dotStyle1 = useAnimatedStyle(() => ({
    opacity: 0.4 + dot1.value * 0.6,
    transform: [{ scale: 0.6 + dot1.value * 0.4 }],
  }));
  const dotStyle2 = useAnimatedStyle(() => ({
    opacity: 0.4 + dot2.value * 0.6,
    transform: [{ scale: 0.6 + dot2.value * 0.4 }],
  }));

  // ── Shimmer sweep on the label text ──
  const shimmer = useSharedValue(0);
  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
  }, [shimmer]);
  const shimmerTextStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + shimmer.value * 0.45,
  }));

  const dotBase = {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.mediatingDotBg,
  } as const;

  return (
    <View style={styles.mediatingRow}>
      <Animated.View style={sparkleStyle}>
        <Ionicons name="sparkles" size={12} color={colors.mediatingColor} />
      </Animated.View>
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
/** Number of waveform bars shown in the playback visualiser. */
const PLAYER_WAVEFORM_BARS = 32;

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

/** Audio player with play/pause, smooth waveform progress, tap-to-seek, and footer timestamps. */
function AudioPlayer({ uri, isOwn, sentAt }: { uri: string; isOwn: boolean; sentAt?: string }) {
  const { colors } = useTheme();
  const normalizedUri = normalizeAudioUri(uri);
  // Pass null instead of empty string to avoid creating a broken native player
  // for optimistic messages whose URI hasn't been resolved yet.
  const player = useAudioPlayer(normalizedUri || null);
  const status = useAudioPlayerStatus(player);

  // Keep a ref so callbacks can read the latest status without being in their
  // dependency array — prevents recreating on every 100 ms status tick.
  const statusRef = useRef(status);
  statusRef.current = status;

  // Shared values kept on the UI thread for smooth animation.
  const trackWidthSV   = useSharedValue(0);
  const smoothProgress = useSharedValue(0);

  // Stable waveform shape — seeded from URI so it never jumps on re-render.
  const waveform = useMemo(() => generateWaveform(uri, PLAYER_WAVEFORM_BARS), [uri]);

  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

  // Smoothly interpolate between status-update ticks (≈ 100 ms).
  useEffect(() => {
    smoothProgress.value = withTiming(progress, { duration: 100 });
  }, [progress, smoothProgress]);

  // The overlay width drives the "filled" portion of the waveform.
  const animatedOverlayStyle = useAnimatedStyle(() => ({
    width: smoothProgress.value * trackWidthSV.value,
  }));
  // The inner row inside the overlay must always span the full track width
  // so bars line up correctly with the background layer.
  const animatedInnerStyle = useAnimatedStyle(() => ({
    width: trackWidthSV.value,
  }));

  const togglePlayback = useCallback(async () => {
    const s = statusRef.current;
    if (!normalizedUri) return;
    try {
      if (s.playing) {
        player.pause();
      } else {
        await AudioModule.setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
        // seekTo is async — await it so play() starts from the correct position.
        if (s.duration > 0 && s.currentTime >= s.duration - 0.1) {
          await player.seekTo(0);
        }
        player.play();
      }
    } catch (err) {
      console.error('[AudioPlayer] Playback error:', err);
    }
  }, [player, normalizedUri]);

  const handleSeek = useCallback(
    (evt: { nativeEvent: { locationX: number } }) => {
      const duration = statusRef.current.duration;
      if (trackWidthSV.value <= 0 || duration <= 0) return;
      const fraction = Math.max(0, Math.min(1, evt.nativeEvent.locationX / trackWidthSV.value));
      // seekTo is async but we fire-and-forget here (no await needed for seek-on-tap).
      player.seekTo(fraction * duration);
    },
    [player, trackWidthSV],
  );

  const timeLabel = status.duration > 0
    ? formatAudioTime(Math.max(0, status.duration - status.currentTime))
    : '0:00';
  const sentTimeStr = sentAt ? formatSentTime(sentAt) : null;

  const iconColor   = isOwn ? colors.audioIconOwn        : colors.audioIconReceived;
  const barInactive = isOwn ? colors.audioBarInactiveOwn : colors.audioBarInactiveReceived;
  const barActive   = isOwn ? colors.audioBarActiveOwn   : colors.audioBarActiveReceived;
  const timeColor   = isOwn ? colors.audioTimeOwn        : colors.audioTimeReceived;

  return (
    <View style={styles.audioWrapper}>
      {/* ── Top row: play button + waveform ── */}
      <View style={styles.audioTopRow}>
        <Pressable
          onPress={togglePlayback}
          hitSlop={8}
          style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name={status.playing ? 'pause' : 'play'} size={22} color={iconColor} />
        </Pressable>

        {/* Waveform — tappable for seeking */}
        <Pressable
          onLayout={(e) => { trackWidthSV.value = e.nativeEvent.layout.width; }}
          onPress={handleSeek}
          hitSlop={8}
          style={styles.waveformContainer}
        >
          {/* Background (inactive) bars */}
          {waveform.map((h, i) => (
            <View
              key={i}
              style={[styles.waveformBar, { height: Math.round(h * 28), backgroundColor: barInactive }]}
            />
          ))}

          {/* Foreground (active) bars clipped to animated progress width */}
          <Animated.View style={[styles.waveformOverlay, animatedOverlayStyle]}>
            <Animated.View style={[styles.waveformOverlayInner, animatedInnerStyle]}>
              {waveform.map((h, i) => (
                <View
                  key={i}
                  style={[styles.waveformBar, { height: Math.round(h * 28), backgroundColor: barActive }]}
                />
              ))}
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
}

// ── Main Component ───────────────────────────────────────────────────────────
function MessageBubble({
  message,
  currentUserId,
  preferredLanguage,
  onRetry,
  onLongPress,
  onPress,
  onOpenDocumentInterrogation,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  // Read selectionMode & highlightedMessageId from context so that
  // the FlatList's renderItem doesn't need them in its dependency array.
  const { selectionMode, highlightedMessageId } = useChatList();
  const isHighlighted = message.id === highlightedMessageId;

  const isOwn = message.senderId === currentUserId;
  const { contentType, rawContent, translations, confidenceScore, isOptimistic, isRetrying } = message;
  const isSelected = message.isSelected ?? false;

  const showMediating =
    isOptimistic === true || isRetrying === true || translations === undefined || translations === null;

  // ── Highlight animation (from search navigation) ────────────────────────
  const highlightOpacity = useSharedValue(0);

  useEffect(() => {
    if (isHighlighted) {
      highlightOpacity.value = withTiming(1, { duration: 200 });
      // Auto-fade after 1.5s
      const timer = setTimeout(() => {
        highlightOpacity.value = withTiming(0, { duration: 800 });
      }, 1500);
      return () => clearTimeout(timer);
    } else {
      highlightOpacity.value = 0;
    }
  }, [isHighlighted, highlightOpacity]);

  const highlightAnimStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      highlightOpacity.value,
      [0, 1],
      ['rgba(250,204,21,0)', 'rgba(250,204,21,0.2)'],
    ),
    borderRadius: 12,
  }));

  // ── Selection animation ─────────────────────────────────────────────────
  const selectionProgress = useSharedValue(isSelected ? 1 : 0);

  useEffect(() => {
    selectionProgress.value = withTiming(isSelected ? 1 : 0, { duration: 180 });
  }, [isSelected, selectionProgress]);

  const animatedRowBgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      selectionProgress.value,
      [0, 1],
      [colors.selectionBgOff, colors.selectionBg],
    ),
    borderRadius: 10,
  }));

  // Checkmark circle: scales in on selection and collapses to 0 width when
  // selection mode is off, so it doesn't reserve invisible horizontal space.
  const checkScale = useSharedValue(isSelected ? 1 : 0.4);
  const checkOpacity = useSharedValue(selectionMode ? 1 : 0);
  // Width animates from 0 (hidden, takes no space) to 22 (visible).
  const checkWidthSV = useSharedValue(selectionMode ? 22 : 0);

  useEffect(() => {
    checkOpacity.value = withTiming(selectionMode ? 1 : 0, { duration: 180 });
    checkWidthSV.value = withTiming(selectionMode ? 22 : 0, { duration: 180 });
  }, [selectionMode, checkOpacity, checkWidthSV]);

  useEffect(() => {
    checkScale.value = withTiming(isSelected ? 1 : 0.6, { duration: 160 });
  }, [isSelected, checkScale]);

  const animatedCheckStyle = useAnimatedStyle(() => ({
    opacity: checkOpacity.value,
    transform: [{ scale: checkScale.value }],
    // Collapse width to 0 so the invisible circle doesn't push the bubble
    // away from the screen edge in normal (non-selection) mode.
    width: checkWidthSV.value,
  }));

  // ── Content ────────────────────────────────────────────────────────────
  const renderContent = () => {
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
            resizeMode="cover"
          />
        );

      case 'AUDIO':
        return <AudioPlayer uri={rawContent} isOwn={isOwn} sentAt={message.createdAt} />;

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
  };

  // ── Text-to-Speech for translated audio messages ──────────────────────
  const [isSpeaking, setIsSpeaking] = useState(false);

  /** Whether this message qualifies for the "Listen" TTS button:
   *  - It's an AUDIO message (voice recording)
   *  - It's a received message (not own)
   *  - The user's preferred language is English
   *  - Translations are available */
  const showListenButton =
    contentType === 'AUDIO' &&
    !isOwn &&
    preferredLanguage === 'english' &&
    !!translations?.english;

  const handleListenPress = useCallback(() => {
    if (!translations?.english) return;

    if (isSpeaking) {
      Speech.stop();
      setIsSpeaking(false);
      return;
    }

    setIsSpeaking(true);
    Speech.speak(translations.english, {
      language: 'en-US',
      rate: 0.95,
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  }, [translations?.english, isSpeaking]);

  // Stop TTS when the component unmounts
  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  // ── Translation Card ──────────────────────────────────────────────────
  const renderTranslation = () => {
    // Own messages never show the translation card — you already know what you wrote.
    if (isOwn) return null;

    if (showMediating) {
      return (
        <View style={styles.mediatingContainer}>
          <AIMediatingIndicator />
          {/* Allow manual retry when the message is not optimistic (already persisted) */}
          {!isOptimistic && onRetry && (
            <Pressable onPress={() => onRetry(message.id)} hitSlop={8} style={styles.retryBtn}>
              <Ionicons name="refresh" size={14} color={colors.mediatingColor} />
            </Pressable>
          )}
        </View>
      );
    }

    if (!translations) return null;

    const translatedText = translations[preferredLanguage];
    const score =
      confidenceScore != null ? Math.round(confidenceScore) : null;

    return (
      <View style={[
        styles.translationCard,
        {
          backgroundColor: isOwn ? colors.translationBgOwn : colors.translationBg,
          borderColor: isOwn ? colors.translationBorderOwn : colors.translationBorder,
        },
      ]}>
        <Text style={[styles.translationText, { color: colors.translationText }]}>{translatedText}</Text>

        <View style={styles.translationFooter}>
          {/* 🔊 Listen button — TTS for translated audio messages */}
          {showListenButton && (
            <Pressable
              onPress={handleListenPress}
              hitSlop={8}
              style={({ pressed }) => [
                styles.listenBtn,
                { backgroundColor: isSpeaking ? colors.primaryLight : colors.confidenceBg },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons
                name={isSpeaking ? 'stop-circle' : 'volume-high'}
                size={13}
                color={isSpeaking ? '#fff' : colors.primaryLight}
              />
              <Text style={[
                styles.listenText,
                { color: isSpeaking ? '#fff' : colors.primaryLight },
              ]}>
                {isSpeaking ? 'Stop' : 'Listen'}
              </Text>
            </Pressable>
          )}

          {score != null && (
            <View style={[styles.confidenceBadge, { backgroundColor: colors.confidenceBg }]}>
              <Text style={[styles.confidenceText, { color: colors.confidenceText }]}>⚡ {score}%</Text>
            </View>
          )}
          {onRetry && (
            <Pressable onPress={() => onRetry(message.id)} hitSlop={8} style={styles.retryBtn}>
              <Ionicons name="refresh" size={14} color={colors.primaryLight} />
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  // ── Optimistic bubble pulse (alive "sending" feel) ───────────────────
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
      optimisticOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [isOptimistic, optimisticOpacity]);
  const optimisticAnimStyle = useAnimatedStyle(() => ({
    opacity: optimisticOpacity.value,
  }));

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Pressable
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress?.(message.id);
      }}
      onPress={selectionMode ? () => onPress?.(message.id) : undefined}
      delayLongPress={300}
    >
      <Animated.View style={[styles.rowWrapper, animatedRowBgStyle, highlightAnimStyle]}>
        <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}>
          {/* ── Selection checkmark (left for others, right for own is reversed via row) ── */}
          <Animated.View style={[styles.checkCircle, animatedCheckStyle]}>
            <View style={[
              styles.checkCircleInner,
              { borderColor: colors.checkCircleBorder, backgroundColor: colors.checkCircleBg },
              isSelected && { backgroundColor: colors.checkCircleActiveBg, borderColor: colors.checkCircleActiveBorder },
            ]}>
              {isSelected && (
                <Ionicons name="checkmark" size={13} color="#fff" />
              )}
            </View>
          </Animated.View>

          {/* ── Bubble + edited label + translation card ── */}
          <View style={styles.bubbleColumn}>
            <Animated.View
              style={[
                styles.bubble,
                {
                  backgroundColor: isOwn ? colors.bubbleOwn : colors.bubbleReceived,
                  shadowColor: colors.bubbleShadow,
                },
                isOwn ? styles.bubbleOwn : styles.bubbleOther,
                optimisticAnimStyle,
              ]}
            >
              {renderContent()}
            </Animated.View>

            {/* "edited" label — shown for all participants once a message is edited */}
            {message.isEdited && (
              <Text style={[styles.editedLabel, { color: colors.editedLabel }, isOwn && styles.editedLabelOwn]}>
                edited
              </Text>
            )}

            {/* Translation card is inside bubbleColumn so it is constrained
                to the same width as the bubble, not span the full screen. */}
            {renderTranslation()}

            {/* Action cards — meetings, reminders extracted by AI */}
            {message.extractedActions && message.extractedActions.length > 0 && (
              <ActionCard actions={message.extractedActions} isOwn={isOwn} />
            )}
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default memo(MessageBubble);

// ── Styles ───────────────────────────────────────────────────────────────────
const BUBBLE_MAX_WIDTH = '78%' as const;

const styles = StyleSheet.create({
  // Animated wrapper for selection background
  rowWrapper: {
    paddingHorizontal: 6,
    paddingVertical: 2,
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

  // Selection checkmark circle
  checkCircle: {
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
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

  // Listen (TTS) button
  listenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  listenText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
