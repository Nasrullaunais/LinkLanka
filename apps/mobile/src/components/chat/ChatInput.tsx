import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import MagicRefineModal from './MagicRefineModal';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  RecordingOptions,
  AudioModule,
} from 'expo-audio';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';

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
// Spreads the stock HIGH_QUALITY preset and enables real-time metering so we
// can visualise audio amplitude during recording and detect silent clips.
const RECORDING_OPTIONS_WITH_METERING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

// ── Constants ────────────────────────────────────────────────────────────────
/** Number of amplitude bars shown in the live waveform. */
const WAVEFORM_BARS = 24;
/** dBFS threshold below which a recording is considered silent. */
const SILENCE_THRESHOLD_DB = -45;

/** Normalise a raw dBFS metering value (typically -160 to 0) to 0-1 range. */
function normaliseDb(db: number): number {
  // Map [-60, 0] dBFS → [0, 1] and clamp
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

// ── Recording bar ─────────────────────────────────────────────────────────────
interface RecordingBarProps {
  durationMs: number;
  isSending: boolean;
  onCancel: () => void;
  /** Normalised amplitude levels (0–1) for live waveform bars. */
  waveform: number[];
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
  const animStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));
  return (
    <Animated.View
      style={[
        { width: 3, borderRadius: 2, backgroundColor: color },
        animStyle,
      ]}
    />
  );
}

const PROCESSING_BARS = 16;

function RecordingBar({ durationMs, isSending, onCancel, waveform }: RecordingBarProps) {
  const { colors } = useTheme();

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
      {/* Live waveform — bars height-mapped from real-time metering amplitude */}
      <View style={styles.liveWaveformContainer}>
        {waveform.map((level, i) => {
          const barH = Math.max(4, Math.round(level * 28));
          // Bars towards the tail (most recent) are brighter; older ones fade
          const opacity = 0.35 + (i / (WAVEFORM_BARS - 1)) * 0.65;
          return (
            <View
              key={i}
              style={[
                styles.liveBar,
                {
                  height: barH,
                  opacity,
                },
              ]}
            />
          );
        })}
      </View>

      <Text style={[styles.recordingTimer, { color: colors.recordingText }]}>{formatDuration(durationMs)}</Text>

      <Pressable
        onPress={onCancel}
        style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.6 }]}
        hitSlop={10}
      >
        <Ionicons name="trash-outline" size={16} color={colors.destructive} />
        <Text style={[styles.cancelText, { color: colors.destructive }]}>Cancel</Text>
      </Pressable>
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

  // Ref tracks recording state synchronously — avoids the React render-timing
  // race where onPressOut fires before setIsRecording(true) has re-rendered,
  // leaving onPressOut={undefined} and silently dropping the send.
  const isRecordingRef = useRef(false);
  // Set to true when the user taps Cancel so handleStopRecording discards audio.
  const isCancelledRef = useRef(false);

  const recorder = useAudioRecorder(RECORDING_OPTIONS_WITH_METERING);
  // Live recorder state updated every 100ms — gives us durationMillis for timer
  const recorderState = useAudioRecorderState(recorder, 100);
  // Mirror durationMillis into a ref so handleStopRecording can read the
  // final duration without being recreated every 100ms as recorderState updates.
  const durationRef = useRef(0);
  /** Raw dBFS metering samples collected during the current recording session. */
  const meteringHistoryRef = useRef<number[]>([]);
  /** Normalised (0–1) amplitude levels for the live waveform visual —
   *  a sliding window of the last WAVEFORM_BARS samples. */
  const [waveform, setWaveform] = useState<number[]>(() => Array(WAVEFORM_BARS).fill(0));

  useEffect(() => {
    durationRef.current = recorderState.durationMillis ?? 0;

    // Collect metering and update the live waveform only while actually recording.
    if (isRecording && recorderState.metering != null) {
      const raw = recorderState.metering;
      meteringHistoryRef.current.push(raw);

      const normalised = normaliseDb(raw);
      setWaveform((prev) => {
        const next = [...prev, normalised];
        return next.length > WAVEFORM_BARS ? next.slice(next.length - WAVEFORM_BARS) : next;
      });
    }
  }, [recorderState.durationMillis, recorderState.metering, isRecording]);

  const hasText = inputText.trim().length > 0;
  const charCount = inputText.length;

  // ── Text Send ────────────────────────────────────────────────────────────
  const handleSendText = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    onSendMessage({ type: 'TEXT', content: trimmed });
    setInputText('');
  }, [inputText, onSendMessage]);

  // ── Audio: Cancel ────────────────────────────────────────────────────────
  const handleCancelRecording = useCallback(async () => {
    isCancelledRef.current = true;
    isRecordingRef.current = false;
    setIsRecording(false);
    try {
      await recorder.stop();
    } catch {
      // ignore — we just want the recorder stopped cleanly
    }
    await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [recorder]);

  // ── Audio: Start ─────────────────────────────────────────────────────────
  const handleStartRecording = useCallback(async () => {
    // Prevent double-trigger
    if (isRecordingRef.current) return;

    try {
      const { granted } = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission required', 'Microphone access is needed to record audio.');
        return;
      }
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      isCancelledRef.current = false;
      durationRef.current = 0;
      // Reset metering history and waveform display for the new session.
      meteringHistoryRef.current = [];
      setWaveform(Array(WAVEFORM_BARS).fill(0));
      // prepareToRecordAsync() MUST be called before record() — without it the
      // native recorder is never initialised, durationMillis stays 0, and
      // recorder.uri is null after stop (which was the root cause of the
      // "No audio was captured" error).
      await recorder.prepareToRecordAsync();
      recorder.record();
      // Set ref BEFORE state so onPressOut sees it immediately without waiting
      // for the React re-render that follows setIsRecording.
      isRecordingRef.current = true;
      setIsRecording(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.error('[ChatInput] Failed to start recording:', error);
      Alert.alert('Recording Error', 'Could not start audio recording.');
    }
  }, [recorder]);

  // ── Audio: Stop (send or discard) ─────────────────────────────────────────
  // Always attached to onPressOut — the isRecordingRef guard ensures it only
  // acts when we are genuinely mid-recording, preventing spurious triggers.
  const handleStopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      // Snapshot duration now — before stop() resets the native recorder state.
      const capturedDuration = durationRef.current;

      await recorder.stop();
      // Restore audio mode for playback: keep playsInSilentMode so the
      // recorded clip (and any other audio in the app) can be heard even
      // when the iOS ring/silent switch is off.
      await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

      // User hit Cancel — discard
      if (isCancelledRef.current) {
        isCancelledRef.current = false;
        return;
      }

      // Silently reject accidental taps shorter than 500ms
      if (capturedDuration < 500) {
        return;
      }

      // ── Client-side silence guard ──────────────────────────────────────────────
      // Inspect collected metering samples. If the peak level never exceeded
      // SILENCE_THRESHOLD_DB, the recording is considered silent — reject it
      // immediately, before any network call, to give instant feedback.
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

      // No compression — the recorder already produces a compact 128kbps AAC
      // M4A file which is ideal for Gemini. Re-compressing with
      // react-native-compressor was degrading the audio to ~32kbps and
      // introducing artefacts that made speech recognition unusably inaccurate.
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
  }, [recorder, onSendMessage]);

  // ── Attachment ───────────────────────────────────────────────────────────
  const pickFromCamera = useCallback(async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission required', 'Camera access is needed to take photos.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      onSendMessage({ type: 'IMAGE', content: result.assets[0].uri });
    }
  }, [onSendMessage]);

  const pickFromGallery = useCallback(async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      Alert.alert('Permission required', 'Gallery access is needed to select photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      onSendMessage({ type: 'IMAGE', content: result.assets[0].uri });
    }
  }, [onSendMessage]);

  const handleAttachment = useCallback(() => {
    setShowSheet(true);
  }, []);

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
        onSendMessage({
          type: 'DOCUMENT',
          content: asset.uri,
          mimeType: asset.mimeType ?? 'application/pdf',
        });
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

  return (
    <>
      <View style={[styles.wrapper, { paddingBottom: insets.bottom + 6, backgroundColor: colors.inputWrapperBg, borderTopColor: colors.inputBorder }]}>
        {/* Recording / processing bar */}
        {showRecordingBar && (
          <RecordingBar
            durationMs={recorderState.durationMillis ?? 0}
            isSending={isSending}
            onCancel={handleCancelRecording}
            waveform={waveform}
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
            <Pressable
              onLongPress={handleStartRecording}
              onPressOut={handleStopRecording}
              delayLongPress={200}
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: colors.primary },
                isRecording && styles.actionBtnRecording,
                pressed && !isRecording && styles.actionBtnPressed,
              ]}
              hitSlop={8}
            >
              <Ionicons name={isRecording ? 'stop' : 'mic'} size={20} color="#fff" />
            </Pressable>
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
  },
  // Live waveform (replaces pulsing dot)
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
  recordingTimer: {
    fontSize: 15,
    fontWeight: '600',
    minWidth: 36,
  },
  recordingBarText: {
    flex: 1,
    fontSize: 13,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  cancelText: {
    fontSize: 12,
    fontWeight: '600',
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
