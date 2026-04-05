import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  withSpring,
  interpolate,
  Easing,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import MagicRefineModal from './MagicRefineModal';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  type RecordingOptions,
  AudioModule,
} from 'expo-audio';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Image as Compressor } from 'react-native-compressor';
import {
  analyzeAudibility,
  getBlockedFeedback,
  getLiveHint,
  type AudibilityStatus,
  type FeedbackCopy,
} from './audioAudibility';

type HintTone = 'neutral' | 'warn' | 'good';

function getHintTone(status: AudibilityStatus): HintTone {
  if (status === 'good') return 'good';
  if (status === 'calibrating') return 'neutral';
  return 'warn';
}

// ── Types ────────────────────────────────────────────────────────────────────
interface ChatPayload {
  type: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  content: string;
  mimeType?: string;
  /** Local file URI — only set for AUDIO; used by the optimistic message to
   *  load playback from the device before the server URL is available. */
  localUri?: string;
  /** Track duration in milliseconds (set for AUDIO msg) */
  durationMs?: number;
}

interface ChatInputProps {
  onSendMessage: (payload: ChatPayload) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getMimeFromUri(uri: string): string {
  const ext = (uri.split('.').pop() ?? '').toLowerCase().split('?')[0];
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'wav') return 'audio/wav';
  if (ext === '3gp') return 'audio/3gpp';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'aac') return 'audio/aac';
  return 'audio/mp4'; // Gemini-safe default
}

// ── Recording preset ──────────────────────────────────────────────────────────
const RECORDING_OPTIONS_WITH_METERING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_CHAT_TEXT_LENGTH = 2000;
const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_VOICE_RECORDING_DURATION_MS = 10 * 60 * 1000;
const WAVEFORM_BARS = 24;
/** Horizontal drag distance (px) needed to trigger swipe-to-cancel. */
const CANCEL_THRESHOLD = 100;
/** Vertical drag distance (px) needed to trigger lock-to-record. */
const LOCK_THRESHOLD = 60;

function getFileSizeBytes(uri: string): number | null {
  try {
    const file = new File(uri);
    const info = file.info();
    if (info.exists && typeof info.size === 'number' && Number.isFinite(info.size)) {
      return Math.max(0, info.size);
    }
  } catch {
    // Ignore local file-stat failures and allow downstream upload handling.
  }

  return null;
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function normaliseDb(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

// ── Pulsing red dot ──────────────────────────────────────────────────────────
const PulsingDot = React.memo(function PulsingDot() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.3, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.5, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [scale, opacity]);
  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return <Animated.View style={[styles.pulsingDot, dotStyle]} />;
});

// ── Animated chevrons for "slide to cancel" hint ─────────────────────────────
const SlideHintChevrons = React.memo(function SlideHintChevrons() {
  const translateX = useSharedValue(0);
  useEffect(() => {
    translateX.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [translateX]);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  return (
    <Animated.View style={[styles.chevronRow, animStyle]}>
      <Ionicons name="chevron-back" size={14} color="#9ca3af" />
      <Ionicons name="chevron-back" size={14} color="#b0b5bf" style={{ marginLeft: -6 }} />
    </Animated.View>
  );
});

const LockHintChevron = React.memo(function LockHintChevron() {
  const translateY = useSharedValue(0);
  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [translateY]);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  return (
    <Animated.View style={[styles.chevronCol, animStyle]}>
      <Ionicons name="chevron-up" size={14} color="#9ca3af" />
    </Animated.View>
  );
});

// ── Recording bar ─────────────────────────────────────────────────────────────
interface RecordingBarProps {
  durationMs: number;
  isSending: boolean;
  isLocked: boolean;
  onCancel: () => void;
  onSend: () => void;
  waveform: number[];
  hint: string | null;
  hintTone: HintTone;
  slideX: SharedValue<number>;
}

/** Animated bar for the processing waveform */
function ProcessingBar({ index, color }: { index: number; color: string }) {
  const height = useSharedValue(4);
  useEffect(() => {
    height.value = withDelay(
      index * 60,
      withRepeat(
        withSequence(
          withTiming(18 + Math.random() * 10, { duration: 400, easing: Easing.inOut(Easing.ease) }),
          withTiming(4, { duration: 400, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );
  }, [height, index]);
  const animStyle = useAnimatedStyle(() => ({ height: height.value }));
  return (
    <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: color }, animStyle]} />
  );
}

const PROCESSING_BARS = 16;

function RecordingBar({ durationMs, isSending, isLocked, onCancel, onSend, waveform, hint, hintTone, slideX }: RecordingBarProps) {
  const { colors } = useTheme();

  // Cancel hint fades in as the user drags left.
  const cancelHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(slideX.value, [0, -CANCEL_THRESHOLD * 0.6], [0, 1], 'clamp'),
  }));

  // "Slide to cancel" text fades out as user drags.
  const slideHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(slideX.value, [0, -CANCEL_THRESHOLD * 0.3], [1, 0], 'clamp'),
  }));

  if (isSending) {
    return (
      <View style={[styles.recordingBar, { backgroundColor: colors.recordingBarBg }]}>
        <View style={styles.liveWaveformContainer}>
          {Array.from({ length: PROCESSING_BARS }).map((_, i) => (
            <ProcessingBar key={i} index={i} color={colors.processingWaveformBar} />
          ))}
        </View>
        <Text style={[styles.recordingBarText, { color: colors.recordingText }]}>Processing…</Text>
      </View>
    );
  }

  if (isLocked && !isSending) {
    return (
      <View style={[styles.recordingBar, styles.recordingPill, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
        <Pressable onPress={onCancel} style={styles.pillDeleteBtn}>
          <Ionicons name="trash-outline" size={20} color="#ef4444" />
        </Pressable>

        <View style={styles.recordingLeftSection}>
          <PulsingDot />
          <Text style={[styles.recordingTimer, { color: colors.recordingText }]}>
            {formatDuration(durationMs)}
          </Text>
        </View>

        <View style={styles.miniWaveformContainerLocked}>
          {waveform.slice(-16).map((level, i) => {
            const barH = Math.max(3, Math.round(level * 22));
            const opacity = 0.4 + (i / 15) * 0.6;
            return <View key={i} style={[styles.liveBar, { height: barH, opacity, backgroundColor: colors.primary }]} />;
          })}
        </View>

        <Pressable onPress={onSend} style={styles.pillSendBtn}>
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.recordingBar}>
      {/* Left: pulsing dot + timer */}
      <View style={styles.recordingLeftSection}>
        <PulsingDot />
        <Text style={[styles.recordingTimer, { color: colors.recordingText }]}>
          {formatDuration(durationMs)}
        </Text>
      </View>

      {/* Center: slide-to-cancel hint */}
      <View style={styles.recordingCenterSection}>
        {/* Default: animated "slide to cancel" and lock hints */}
        <Animated.View style={[styles.slideHintContainer, slideHintStyle]}>
          <SlideHintChevrons />
          <Text style={styles.slideHintText}>Slide to cancel</Text>
          <View style={{ width: 8 }} />
          <LockHintChevron />
        </Animated.View>
        {/* As user drags: cancel confirmation */}
        <Animated.View style={[styles.cancelConfirmContainer, cancelHintStyle]}>
          <Ionicons name="trash-outline" size={16} color="#ef4444" />
          <Text style={styles.cancelConfirmText}>Release to cancel</Text>
        </Animated.View>
      </View>

      {/* Right: mini waveform */}
      <View style={styles.miniWaveformContainer}>
        {waveform.slice(-12).map((level, i) => {
          const barH = Math.max(3, Math.round(level * 22));
          const opacity = 0.4 + (i / 11) * 0.6;
          return (
            <View key={i} style={[styles.liveBar, { height: barH, opacity }]} />
          );
        })}
      </View>
    </View>
  );
}

// ── Attachment bottom sheet ───────────────────────────────────────────────────
interface AttachSheetProps {
  visible: boolean;
  onClose: () => void;
  onCamera: () => void;
  onGallery: () => void;
  onDocument: () => void;
  bottomInset: number;
}

function AttachSheet({ visible, onClose, onCamera, onGallery, onDocument, bottomInset }: AttachSheetProps) {
  const { colors } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={[styles.sheetOverlay, { backgroundColor: colors.overlayBg }]}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: bottomInset + 16, backgroundColor: colors.sheetBg }]}>
              <View style={[styles.sheetHandle, { backgroundColor: colors.sheetHandle }]} />
              <Text style={[styles.sheetTitle, { color: colors.sheetTitleText }]}>Attach</Text>
              <View style={styles.sheetRow}>
                <Pressable
                  style={({ pressed }) => [styles.sheetBtn, pressed && styles.sheetBtnPressed]}
                  onPress={() => { onClose(); onCamera(); }}
                >
                  <View style={[styles.sheetIcon, { backgroundColor: '#6366f1' }]}>
                    <Ionicons name="camera" size={26} color="#fff" />
                  </View>
                  <Text style={[styles.sheetBtnLabel, { color: colors.sheetBtnLabel }]}>Camera</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.sheetBtn, pressed && styles.sheetBtnPressed]}
                  onPress={() => { onClose(); onGallery(); }}
                >
                  <View style={[styles.sheetIcon, { backgroundColor: '#8b5cf6' }]}>
                    <Ionicons name="image" size={26} color="#fff" />
                  </View>
                  <Text style={[styles.sheetBtnLabel, { color: colors.sheetBtnLabel }]}>Gallery</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.sheetBtn, pressed && styles.sheetBtnPressed]}
                  onPress={() => { onClose(); onDocument(); }}
                >
                  <View style={[styles.sheetIcon, { backgroundColor: '#0ea5e9' }]}>
                    <Ionicons name="document-text" size={26} color="#fff" />
                  </View>
                  <Text style={[styles.sheetBtnLabel, { color: colors.sheetBtnLabel }]}>Document</Text>
                </Pressable>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

function FloatingHint({ hint, hintTone }: { hint: string | null; hintTone: HintTone }) {
  const [hintVisible, setHintVisible] = useState(false);
  const hintOpacity = useSharedValue(0);
  const hintScale = useSharedValue(0.8);
  const hintTranslateY = useSharedValue(10);

  useEffect(() => {
    if (hint) {
      setHintVisible(true);
      hintOpacity.value = withTiming(1, { duration: 300 });
      hintScale.value = withSpring(1, { damping: 15, stiffness: 200 });
      hintTranslateY.value = withSpring(0, { damping: 15, stiffness: 200 });
    } else {
      hintOpacity.value = withTiming(0, { duration: 200 }, (finished) => {
        if (finished) runOnJS(setHintVisible)(false);
      });
      hintScale.value = withTiming(0.8, { duration: 200 });
      hintTranslateY.value = withTiming(10, { duration: 200 });
    }
  }, [hint, hintOpacity, hintScale, hintTranslateY]);

  const hintStyle = useAnimatedStyle(() => ({
    opacity: hintOpacity.value,
    transform: [
      { scale: hintScale.value },
      { translateY: hintTranslateY.value }
    ]
  }));

  if (!hintVisible) return null;

  return (
    <Animated.View style={[styles.floatingHintContainer, hintStyle]}>
      <Text
        style={[
          styles.floatingHintText,
          hintTone === 'good' ? styles.floatingHintTextGood : null,
          hintTone === 'neutral' ? styles.floatingHintTextNeutral : null,
        ]}
      >
        {hint}
      </Text>
    </Animated.View>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export default function ChatInput({ onSendMessage }: ChatInputProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [inputText, setInputText] = useState('');
  const [androidKeyboardOffset, setAndroidKeyboardOffset] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [showMagicModal, setShowMagicModal] = useState(false);
  const [recordingHint, setRecordingHint] = useState<string | null>(null);
  const [recordingHintTone, setRecordingHintTone] = useState<HintTone>('neutral');
  const [blockedFeedback, setBlockedFeedback] = useState<FeedbackCopy | null>(null);

  // ── Sync refs ─────────────────────────────────────────────────────────────
  const isRecordingRef = useRef(false);
  /**
   * Shared value so the gesture worklet (UI thread) can read/write the
   * cancelled flag synchronously — JS refs are invisible to worklets.
   */
  const isCancelled = useSharedValue(0); // 0 = active, 1 = cancelled
  /**
   * Stores the promise returned by doStartRecording so that
   * handleStopRecording can await it — eliminates the race condition where
   * the user releases their finger before the async start flow completes.
   */
  const startPromiseRef = useRef<Promise<void> | null>(null);

  const recorder = useAudioRecorder(RECORDING_OPTIONS_WITH_METERING);
  const recorderState = useAudioRecorderState(recorder, 100);
  const durationRef = useRef(0);
  const meteringHistoryRef = useRef<number[]>([]);
  const [waveform, setWaveform] = useState<number[]>(() => Array(WAVEFORM_BARS).fill(0));
  const stableLiveStatusRef = useRef<AudibilityStatus>('calibrating');
  const candidateLiveStatusRef = useRef<AudibilityStatus>('calibrating');
  const candidateLiveTicksRef = useRef(0);
  const hasReachedRecordingLimitRef = useRef(false);

  // ── Slide-to-cancel & Slide-to-lock shared values ───────────────────────────
  const slideX = useSharedValue(0);
  const slideY = useSharedValue(0);
  const isLockEngaged = useSharedValue(0);

  const micBtnAnimStyle = useAnimatedStyle(() => {
    // If locked, we don't translate the button because the button is replaced by pills.
    if (isLockEngaged.value === 1) return { transform: [] };
    return {
      transform: [
        { translateX: Math.min(0, slideX.value) },
        { translateY: Math.min(0, slideY.value) },
      ],
    };
  });

  // ── Metering + real-time hints ────────────────────────────────────────────
  useEffect(() => {
    durationRef.current = recorderState.durationMillis ?? 0;

    if (!isRecording || recorderState.metering == null) return;

    const raw = recorderState.metering;
    meteringHistoryRef.current.push(raw);

    // Live waveform
    const normalised = normaliseDb(raw);
    setWaveform((prev) => {
      const next = [...prev, normalised];
      return next.length > WAVEFORM_BARS ? next.slice(next.length - WAVEFORM_BARS) : next;
    });

    const analysis = analyzeAudibility(
      meteringHistoryRef.current,
      durationRef.current,
    );

    let nextLiveStatus: AudibilityStatus = analysis.status;
    if (durationRef.current < 350 || analysis.metrics.sampleCount < 4) {
      nextLiveStatus = 'calibrating';
    } else if (nextLiveStatus === 'tooShort') {
      nextLiveStatus = 'calibrating';
    }

    if (candidateLiveStatusRef.current !== nextLiveStatus) {
      candidateLiveStatusRef.current = nextLiveStatus;
      candidateLiveTicksRef.current = 1;
    } else {
      candidateLiveTicksRef.current += 1;
    }

    const requiredTicks = nextLiveStatus === 'good' ? 2 : 3;
    if (
      stableLiveStatusRef.current !== candidateLiveStatusRef.current &&
      candidateLiveTicksRef.current >= requiredTicks
    ) {
      stableLiveStatusRef.current = candidateLiveStatusRef.current;
    }

    setRecordingHint(getLiveHint(stableLiveStatusRef.current));
    setRecordingHintTone(getHintTone(stableLiveStatusRef.current));
  }, [recorderState.durationMillis, recorderState.metering, isRecording]);

  useEffect(() => {
    if (!blockedFeedback) return;
    const timer = setTimeout(() => {
      setBlockedFeedback(null);
    }, 5500);
    return () => clearTimeout(timer);
  }, [blockedFeedback]);

  const showBlockedFeedback = useMemo(() => {
    return Boolean(blockedFeedback) && !isRecording && !isSending;
  }, [blockedFeedback, isRecording, isSending]);

  const dismissBlockedFeedback = useCallback(() => {
    setBlockedFeedback(null);
  }, []);

  const validateAttachmentSize = useCallback(
    ({
      uri,
      label,
      sizeHint,
    }: {
      uri: string;
      label: string;
      sizeHint?: number | null;
    }): boolean => {
      const resolvedSize =
        getFileSizeBytes(uri) ??
        (typeof sizeHint === 'number' && Number.isFinite(sizeHint)
          ? Math.max(0, sizeHint)
          : null);

      if (resolvedSize != null && resolvedSize > MAX_CHAT_ATTACHMENT_BYTES) {
        Alert.alert(
          'File too large',
          `${label} must be smaller than 5 MB. Selected file is ${formatMegabytes(resolvedSize)}.`,
        );
        return false;
      }

      return true;
    },
    [],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      const keyboardHeight = event.endCoordinates?.height ?? 0;
      setAndroidKeyboardOffset(Math.max(0, keyboardHeight));
    });

    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardOffset(0);
    });

    return () => {
      setAndroidKeyboardOffset(0);
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const showFriendlyBlockFeedback = useCallback((status: AudibilityStatus) => {
    setBlockedFeedback(getBlockedFeedback(status));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);

  // ── Reset helper ──────────────────────────────────────────────────────────
  const resetRecordingState = useCallback(() => {
    isRecordingRef.current = false;
    isCancelled.value = 0;
    isLockEngaged.value = 0;
    hasReachedRecordingLimitRef.current = false;
    startPromiseRef.current = null;
    setIsRecording(false);
    setIsLocked(false);
    setRecordingHint(null);
    setRecordingHintTone('neutral');
    stableLiveStatusRef.current = 'calibrating';
    candidateLiveStatusRef.current = 'calibrating';
    candidateLiveTicksRef.current = 0;
    slideX.value = withSpring(0, { damping: 20, stiffness: 300 });
  }, [slideX, isCancelled, isLockEngaged]);

  // ── Audio: Start ─────────────────────────────────────────────────────────
  const doStartRecording = useCallback(async () => {
    if (isRecordingRef.current) return;

    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission required', 'Microphone access is needed to record audio.');
        return;
      }

      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();

      // Bail if cancelled during async setup (user slid away or lifted early)
      if (isCancelled.value === 1) {
        try { await recorder.stop(); } catch { /* ok */ }
        await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        return;
      }

      durationRef.current = 0;
      meteringHistoryRef.current = [];
      setWaveform(Array(WAVEFORM_BARS).fill(0));
      setBlockedFeedback(null);
      hasReachedRecordingLimitRef.current = false;
      stableLiveStatusRef.current = 'calibrating';
      candidateLiveStatusRef.current = 'calibrating';
      candidateLiveTicksRef.current = 0;
      setRecordingHint(getLiveHint('calibrating'));
      setRecordingHintTone(getHintTone('calibrating'));

      recorder.record();
      isRecordingRef.current = true;
      setIsRecording(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.error('[ChatInput] Failed to start recording:', error);
      resetRecordingState();
      Alert.alert('Recording Error', 'Could not start audio recording.');
    }
  }, [recorder, resetRecordingState, isCancelled]);

  /** Wrapper that stores the start promise for stop to await. */
  const handleStartRecording = useCallback(() => {
    Keyboard.dismiss();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    isCancelled.value = 0;
    startPromiseRef.current = doStartRecording();
  }, [doStartRecording, isCancelled]);

  // ── Audio: Cancel ────────────────────────────────────────────────────────
  const handleCancelRecording = useCallback(async () => {
    isCancelled.value = 1;

    // If start is still in progress, wait for it so we can stop cleanly
    if (startPromiseRef.current) {
      try { await startPromiseRef.current; } catch { /* ok */ }
      startPromiseRef.current = null;
    }

    resetRecordingState();

    try {
      await recorder.stop();
    } catch {
      // Recorder might not have started — ignore
    }
    await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [recorder, resetRecordingState, isCancelled]);

  // ── Audio: Stop (send) ────────────────────────────────────────────────────
  const handleStopRecording = useCallback(async () => {
    // CRITICAL: await the async start to finish first.
    // This solves the race where the user releases before start completes.
    if (startPromiseRef.current) {
      try { await startPromiseRef.current; } catch { /* ok */ }
      startPromiseRef.current = null;
    }

    // After awaiting start, check conditions
    if (!isRecordingRef.current || isCancelled.value === 1) {
      resetRecordingState();
      return;
    }

    const capturedDuration = Math.min(
      durationRef.current,
      MAX_VOICE_RECORDING_DURATION_MS,
    );
    const meteringHistory = [...meteringHistoryRef.current];
    resetRecordingState();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await recorder.stop();
      await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

      const hasEnoughMetering = meteringHistory.length >= 4;
      if (hasEnoughMetering) {
        const finalAnalysis = analyzeAudibility(meteringHistory, capturedDuration);
        if (!finalAnalysis.canSend) {
          showFriendlyBlockFeedback(finalAnalysis.status);
          return;
        }
      } else if (capturedDuration < 900) {
        showFriendlyBlockFeedback('tooShort');
        return;
      }

      const uri = recorder.uri;
      if (!uri) {
        Alert.alert('Recording Error', 'No audio was captured. Please try again.');
        return;
      }

      setIsSending(true);

      const mimeType = getMimeFromUri(uri);
      const audioFile = new File(uri);
      const base64 = await audioFile.base64();

      if (!base64 || base64.length < 10) {
        Alert.alert('Recording Error', 'Audio file was empty. Please try again.');
        return;
      }

      onSendMessage({ type: 'AUDIO', content: base64, mimeType, localUri: uri, durationMs: capturedDuration });
    } catch (error) {
      console.error('[ChatInput] Failed to process recording:', error);
      Alert.alert('Recording Error', 'Could not process the recorded audio.');
    } finally {
      setIsSending(false);
    }
  }, [recorder, onSendMessage, resetRecordingState, isCancelled, showFriendlyBlockFeedback]);

  useEffect(() => {
    const durationMs = recorderState.durationMillis ?? 0;

    if (
      !isRecording ||
      durationMs < MAX_VOICE_RECORDING_DURATION_MS ||
      hasReachedRecordingLimitRef.current
    ) {
      return;
    }

    hasReachedRecordingLimitRef.current = true;
    setRecordingHint('Maximum length reached (10:00)');
    setRecordingHintTone('warn');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    void handleStopRecording();
  }, [isRecording, recorderState.durationMillis, handleStopRecording]);

  const handleLockRecording = useCallback(() => {
    setIsLocked(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  // ── Mic gesture ───────────────────────────────────────────────────────────
  //
  // Single Pan gesture with activateAfterLongPress — simple & reliable.
  // The useCallback handlers already have stable identities (memoized deps),
  // so passing them directly keeps the gesture stable without needing ref
  // indirection (which causes Reanimated "modify key current" warnings).
  //
  const micGesture = useMemo(() => {
    return Gesture.Pan()
      .activateAfterLongPress(180)
      .minDistance(0)
      .onStart(() => {
        isCancelled.value = 0;
        isLockEngaged.value = 0;
        runOnJS(handleStartRecording)();
      })
      .onUpdate((e) => {
        if (isLockEngaged.value === 1) return;

        slideX.value = Math.min(0, e.translationX);
        slideY.value = Math.min(0, e.translationY); // Slide up to lock

        // Past cancel threshold → cancel
        if (e.translationX < -CANCEL_THRESHOLD && isCancelled.value === 0) {
          isCancelled.value = 1;
          runOnJS(handleCancelRecording)();
        } 
        // Past lock threshold → lock
        else if (e.translationY < -LOCK_THRESHOLD && isLockEngaged.value === 0 && isCancelled.value === 0) {
          isLockEngaged.value = 1;
          runOnJS(handleLockRecording)();
        }
      })
      .onEnd(() => {
        // If they released the finger AND didn't lock, stop recording
        if (isCancelled.value === 0 && isLockEngaged.value === 0) {
          runOnJS(handleStopRecording)();
        }
      })
      .onFinalize(() => {
        slideX.value = withSpring(0, { damping: 20, stiffness: 300 });
        slideY.value = withSpring(0, { damping: 20, stiffness: 300 });
      });
  }, [slideX, slideY, isCancelled, isLockEngaged, handleStartRecording, handleStopRecording, handleCancelRecording, handleLockRecording]);

  // ── Text send ────────────────────────────────────────────────────────────
  const handleSendText = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    setBlockedFeedback(null);
    onSendMessage({ type: 'TEXT', content: trimmed });
    setInputText('');
  }, [inputText, onSendMessage]);

  // ── Attachment ───────────────────────────────────────────────────────────
  const pickFromCamera = useCallback(async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission required', 'Camera access is needed to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      // Compress before sending — reduces upload time + decode cost in bubbles
      const compressed = await Compressor.compress(result.assets[0].uri, {
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 0.7,
      });
      if (!validateAttachmentSize({ uri: compressed, label: 'Image' })) {
        return;
      }
      onSendMessage({ type: 'IMAGE', content: compressed });
    }
  }, [onSendMessage, validateAttachmentSize]);

  const pickFromGallery = useCallback(async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission required', 'Gallery access is needed to select photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      // Compress before sending — reduces upload time + decode cost in bubbles
      const compressed = await Compressor.compress(result.assets[0].uri, {
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 0.7,
      });
      if (!validateAttachmentSize({ uri: compressed, label: 'Image' })) {
        return;
      }
      onSendMessage({ type: 'IMAGE', content: compressed });
    }
  }, [onSendMessage, validateAttachmentSize]);

  const handleAttachment = useCallback(() => setShowSheet(true), []);

  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        if (
          !validateAttachmentSize({
            uri: asset.uri,
            label: 'Document',
            sizeHint: asset.size,
          })
        ) {
          return;
        }
        onSendMessage({ type: 'DOCUMENT', content: asset.uri, mimeType: asset.mimeType ?? 'application/pdf' });
      }
    } catch {
      Alert.alert('Error', 'Failed to pick document. Please try again.');
    }
  }, [onSendMessage, validateAttachmentSize]);

  // ── Magic Refine ─────────────────────────────────────────────────────────
  const handleMagicReplace = useCallback((refined: string) => {
    setShowMagicModal(false);
    setInputText(refined);
  }, []);

  const handleMagicReplaceAndSend = useCallback(
    (refined: string) => {
      setShowMagicModal(false);
      onSendMessage({ type: 'TEXT', content: refined });
      setInputText('');
    },
    [onSendMessage],
  );

  // ── Render ───────────────────────────────────────────────────────────────
  const showRecordingBar = isRecording || isSending;
  const hasText = inputText.trim().length > 0;
  const charCount = inputText.length;

  return (
    <>
      <View style={[styles.wrapper, {
        paddingBottom: insets.bottom + 6,
        marginBottom: Platform.OS === 'android' ? androidKeyboardOffset : 0,
        backgroundColor: colors.inputWrapperBg,
        borderTopColor: colors.inputBorder,
      }]}>
        
        {/* Floating Hint Pill */}
        <FloatingHint hint={recordingHint} hintTone={recordingHintTone} />

        {/* Recording / processing bar */}
        {showRecordingBar && (
          <RecordingBar
            durationMs={recorderState.durationMillis ?? 0}
            isSending={isSending}
            isLocked={isLocked}
            onCancel={() => {
              isCancelled.value = 1;
              handleCancelRecording();
            }}
            onSend={() => {
              isCancelled.value = 0;
              handleStopRecording();
            }}
            waveform={waveform}
            hint={recordingHint}
            hintTone={recordingHintTone}
            slideX={slideX}
          />
        )}

        {showBlockedFeedback && blockedFeedback && (
          <View style={styles.blockedCard}>
            <View style={styles.blockedCardIconWrap}>
              <Ionicons name="mic-off-outline" size={16} color="#b45309" />
            </View>
            <View style={styles.blockedCardTextWrap}>
              <Text style={styles.blockedCardTitle}>{blockedFeedback.title}</Text>
              <Text style={styles.blockedCardMessage}>{blockedFeedback.message}</Text>
            </View>
            <Pressable onPress={dismissBlockedFeedback} style={styles.blockedCardAction}>
              <Text style={styles.blockedCardActionText}>{blockedFeedback.actionLabel}</Text>
            </Pressable>
          </View>
        )}

        {/* Character count — only in normal mode */}
        {charCount > 200 && !showRecordingBar && (
          <Text
            style={[
              styles.charCount,
              charCount > MAX_CHAT_TEXT_LENGTH - 100 && styles.charCountWarn,
            ]}
          >
            {charCount}/{MAX_CHAT_TEXT_LENGTH}
          </Text>
        )}

        <View style={[styles.container, { backgroundColor: colors.inputBg, display: isLocked ? 'none' : 'flex' }]}>
          {/* Attachment — hidden while recording/sending */}
          {!showRecordingBar && (
            <Pressable
              onPress={handleAttachment}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              hitSlop={8}
            >
              <Ionicons name="attach" size={24} color={colors.inputIconColor} />
            </Pressable>
          )}

          {/* Text input — invisible but kept for layout during recording */}
          <TextInput
            style={[styles.input, { color: colors.inputText }, showRecordingBar && styles.inputHidden]}
            placeholder="Type a message…"
            placeholderTextColor={colors.inputPlaceholder}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={MAX_CHAT_TEXT_LENGTH}
            editable={!showRecordingBar}
          />

          {/* Dynamic action button */}
          {hasText && !showRecordingBar ? (
            <>
              {/* ✨ Magic Refine button */}
              <Pressable
                onPress={() => setShowMagicModal(true)}
                style={({ pressed }) => [styles.magicBtn, { backgroundColor: colors.magicBtnBg, borderColor: colors.magicBtnBorder }, pressed && { backgroundColor: colors.magicBtnPressedBg }]}
                hitSlop={8}
              >
                <Text style={styles.magicBtnIcon}>✨</Text>
              </Pressable>
              {/* Send button */}
              <Pressable
                onPress={handleSendText}
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.primary }, pressed && styles.actionBtnPressed]}
                hitSlop={8}
              >
                <Ionicons name="send" size={20} color="#fff" />
              </Pressable>
            </>
          ) : isSending ? (
            <View style={[styles.actionBtn, styles.actionBtnRecording]}>
              <ActivityIndicator size="small" color="#fff" />
            </View>
          ) : (
            /* Mic button — wrapped in GestureDetector for pan + long-press */
            <GestureDetector gesture={micGesture}>
              <Animated.View
                style={[
                  styles.actionBtn,
                  { backgroundColor: isRecording ? '#ef4444' : colors.primary },
                  micBtnAnimStyle,
                ]}
              >
                <Ionicons name="mic" size={20} color="#fff" />
              </Animated.View>
            </GestureDetector>
          )}
        </View>
      </View>

      {/* Attachment sheet */}
      <AttachSheet
        visible={showSheet}
        onClose={() => setShowSheet(false)}
        onCamera={pickFromCamera}
        onGallery={pickFromGallery}
        onDocument={pickDocument}
        bottomInset={insets.bottom}
      />

      {/* Magic Refine modal */}
      <MagicRefineModal
        visible={showMagicModal}
        originalText={inputText}
        onClose={() => setShowMagicModal(false)}
        onReplace={handleMagicReplace}
        onReplaceAndSend={handleMagicReplaceAndSend}
      />
    </>
  );
}

ChatInput.displayName = 'ChatInput';

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: 24,
    paddingHorizontal: 6,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnPressed: {
    opacity: 0.7,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    paddingHorizontal: 8,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    textAlignVertical: 'top',
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnPressed: {
    opacity: 0.8,
  },
  actionBtnRecording: {
    backgroundColor: '#ef4444',
  },
  // ── Magic refine button
  magicBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  magicBtnIcon: {
    fontSize: 16,
  },
  // ── Input hidden state while recording
  inputHidden: {
    display: 'none',
  },
  // ── Recording bar
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
    gap: 8,
    minHeight: 36,
  },
  recordingPill: {
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'space-between',
    marginHorizontal: 8,
    marginBottom: 8,
    borderWidth: 1,
  },
  pillDeleteBtn: {
    padding: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 20,
  },
  pillSendBtn: {
    padding: 8,
    backgroundColor: '#0ea5e9',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniWaveformContainerLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    height: 24,
    gap: 2,
    marginHorizontal: 8,
    justifyContent: 'center',
  },
  recordingLeftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  recordingTimer: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 36,
  },
  recordingCenterSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: 24,
  },
  slideHintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    position: 'absolute',
  },
  chevronRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chevronCol: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  slideHintText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
  },
  cancelConfirmContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    position: 'absolute',
  },
  cancelConfirmText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ef4444',
  },
  miniWaveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 24,
    gap: 2,
    overflow: 'hidden',
  },
  liveWaveformContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    gap: 2,
    overflow: 'hidden',
  },
  liveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: '#ef4444',
  },
  floatingHintContainer: {
    position: 'absolute',
    top: -46, // Float nicely above the input area
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 100,
  },
  floatingHintText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fbbf24', // Amber/warning as default
  },
  floatingHintTextGood: {
    color: '#4ade80', // Green
  },
  floatingHintTextNeutral: {
    color: '#d1d5db', // Gray
  },
  recordingBarText: {
    flex: 1,
    fontSize: 13,
  },
  blockedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    gap: 10,
  },
  blockedCardIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef3c7',
  },
  blockedCardTextWrap: {
    flex: 1,
    gap: 2,
  },
  blockedCardTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: '#92400e',
  },
  blockedCardMessage: {
    fontSize: 12,
    lineHeight: 16,
    color: '#a16207',
  },
  blockedCardAction: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f59e0b',
  },
  blockedCardActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
  },
  // character count
  charCount: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'right',
    paddingBottom: 2,
  },
  charCountWarn: {
    color: '#ef4444',
  },
  // attachment sheet
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 20,
  },
  sheetRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  sheetBtn: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  sheetBtnPressed: {
    opacity: 0.7,
  },
  sheetIcon: {
    width: 60,
    height: 60,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetBtnLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
});