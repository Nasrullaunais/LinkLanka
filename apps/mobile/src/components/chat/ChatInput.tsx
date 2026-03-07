import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

// ── Types ────────────────────────────────────────────────────────────────────
interface ChatPayload {
  type: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  content: string;
  mimeType?: string;
  /** Local file URI — only set for AUDIO; used by the optimistic message to
   *  load playback from the device before the server URL is available. */
  localUri?: string;
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
const WAVEFORM_BARS = 24;
const SILENCE_THRESHOLD_DB = -40;
/** Horizontal drag distance (px) needed to trigger swipe-to-cancel. */
const CANCEL_THRESHOLD = 100;
const HINT_NEAR_SILENT_DB = -55;
const HINT_QUIET_DB = -45;
const HINT_SILENCE_TICKS = 20;
const HINT_CLEAR_TICKS = 5;

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

// ── Recording bar ─────────────────────────────────────────────────────────────
interface RecordingBarProps {
  durationMs: number;
  isSending: boolean;
  waveform: number[];
  hint: string | null;
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

function RecordingBar({ durationMs, isSending, waveform, hint, slideX }: RecordingBarProps) {
  const { colors } = useTheme();

  // Cancel hint fades in as the user drags left.
  const cancelHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(slideX.value, [0, -CANCEL_THRESHOLD * 0.6], [0, 1], 'clamp'),
  }));

  // "Slide to cancel" text fades out as user drags.
  const slideHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(slideX.value, [0, -CANCEL_THRESHOLD * 0.3], [1, 0], 'clamp'),
  }));

  // Hint text fades in/out.
  const [hintVisible, setHintVisible] = useState(false);
  const hintOpacity = useSharedValue(0);
  useEffect(() => {
    if (hint) {
      setHintVisible(true);
      hintOpacity.value = withTiming(1, { duration: 300 });
    } else {
      hintOpacity.value = withTiming(0, { duration: 200 }, (finished) => {
        if (finished) runOnJS(setHintVisible)(false);
      });
    }
  }, [hint, hintOpacity]);
  const hintStyle = useAnimatedStyle(() => ({ opacity: hintOpacity.value }));

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
        {/* Default: animated "slide to cancel" hint */}
        <Animated.View style={[styles.slideHintContainer, slideHintStyle]}>
          <SlideHintChevrons />
          <Text style={styles.slideHintText}>Slide to cancel</Text>
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

      {/* Inline hint for audio quality */}
      {hintVisible && (
        <Animated.Text style={[styles.recordingHint, hintStyle]}>
          {hint}
        </Animated.Text>
      )}
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

// ── Component ────────────────────────────────────────────────────────────────
export default function ChatInput({ onSendMessage }: ChatInputProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [showMagicModal, setShowMagicModal] = useState(false);
  const [recordingHint, setRecordingHint] = useState<string | null>(null);

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

  const silentTicksRef = useRef(0);
  const loudTicksRef = useRef(0);

  // ── Slide-to-cancel shared value ──────────────────────────────────────────
  const slideX = useSharedValue(0);
  const micBtnAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.min(0, slideX.value) }],
  }));

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

    // Real-time audio quality hints
    if (raw < HINT_NEAR_SILENT_DB) {
      silentTicksRef.current += 1;
      loudTicksRef.current = 0;
      if (silentTicksRef.current >= HINT_SILENCE_TICKS) {
        setRecordingHint('Move closer to the mic');
      }
    } else if (raw < HINT_QUIET_DB) {
      silentTicksRef.current += 1;
      loudTicksRef.current = 0;
      if (silentTicksRef.current >= HINT_SILENCE_TICKS) {
        setRecordingHint('Speak up');
      }
    } else {
      loudTicksRef.current += 1;
      silentTicksRef.current = 0;
      if (loudTicksRef.current >= HINT_CLEAR_TICKS) {
        setRecordingHint(null);
      }
    }
  }, [recorderState.durationMillis, recorderState.metering, isRecording]);

  // ── Reset helper ──────────────────────────────────────────────────────────
  const resetRecordingState = useCallback(() => {
    isRecordingRef.current = false;
    isCancelled.value = 0;
    startPromiseRef.current = null;
    setIsRecording(false);
    setRecordingHint(null);
    silentTicksRef.current = 0;
    loudTicksRef.current = 0;
    slideX.value = withSpring(0, { damping: 20, stiffness: 300 });
  }, [slideX, isCancelled]);

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
      silentTicksRef.current = 0;
      loudTicksRef.current = 0;
      setWaveform(Array(WAVEFORM_BARS).fill(0));
      setRecordingHint(null);

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

    const capturedDuration = durationRef.current;
    resetRecordingState();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await recorder.stop();
      await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

      // Discard accidental taps shorter than 400ms
      if (capturedDuration < 400) return;

      // Client-side silence guard
      const meteringHistory = meteringHistoryRef.current;
      if (meteringHistory.length > 0) {
        const peakDb = Math.max(...meteringHistory);
        if (peakDb < SILENCE_THRESHOLD_DB) {
          Alert.alert(
            'Audio Too Quiet',
            'Your recording appears to be silent.\nPlease check your microphone and try again.',
          );
          return;
        }
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

      onSendMessage({ type: 'AUDIO', content: base64, mimeType, localUri: uri });
    } catch (error) {
      console.error('[ChatInput] Failed to process recording:', error);
      Alert.alert('Recording Error', 'Could not process the recorded audio.');
    } finally {
      setIsSending(false);
    }
  }, [recorder, onSendMessage, resetRecordingState, isCancelled]);

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
        runOnJS(handleStartRecording)();
      })
      .onUpdate((e) => {
        slideX.value = Math.min(0, e.translationX);

        // Past cancel threshold → cancel
        if (e.translationX < -CANCEL_THRESHOLD && isCancelled.value === 0) {
          isCancelled.value = 1;
          runOnJS(handleCancelRecording)();
        }
      })
      .onEnd(() => {
        if (isCancelled.value === 0) {
          runOnJS(handleStopRecording)();
        }
      })
      .onFinalize(() => {
        slideX.value = withSpring(0, { damping: 20, stiffness: 300 });
      });
  }, [slideX, isCancelled, handleStartRecording, handleStopRecording, handleCancelRecording]);

  // ── Text send ────────────────────────────────────────────────────────────
  const handleSendText = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
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
      onSendMessage({ type: 'IMAGE', content: compressed });
    }
  }, [onSendMessage]);

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
      onSendMessage({ type: 'IMAGE', content: compressed });
    }
  }, [onSendMessage]);

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
        onSendMessage({ type: 'DOCUMENT', content: asset.uri, mimeType: asset.mimeType ?? 'application/pdf' });
      }
    } catch {
      Alert.alert('Error', 'Failed to pick document. Please try again.');
    }
  }, [onSendMessage]);

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
      <View style={[styles.wrapper, { paddingBottom: insets.bottom + 6, backgroundColor: colors.inputWrapperBg, borderTopColor: colors.inputBorder }]}>
        {/* Recording / processing bar */}
        {showRecordingBar && (
          <RecordingBar
            durationMs={recorderState.durationMillis ?? 0}
            isSending={isSending}
            waveform={waveform}
            hint={recordingHint}
            slideX={slideX}
          />
        )}

        {/* Character count — only in normal mode */}
        {charCount > 200 && !showRecordingBar && (
          <Text style={[styles.charCount, charCount > 1900 && styles.charCountWarn]}>
            {charCount}/2000
          </Text>
        )}

        <View style={[styles.container, { backgroundColor: colors.inputBg }]}>
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
            maxLength={2000}
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
    opacity: 0,
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
  recordingHint: {
    fontSize: 11,
    fontWeight: '500',
    color: '#f59e0b',
    position: 'absolute',
    right: 0,
    bottom: -2,
  },
  recordingBarText: {
    flex: 1,
    fontSize: 13,
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