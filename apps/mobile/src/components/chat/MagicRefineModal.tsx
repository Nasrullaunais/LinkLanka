import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isAxiosError, isCancel } from 'axios';

import {
  DialectSuggestionResult,
  DialectTargetLanguage,
  DialectTargetTone,
  refineTextV2,
  suggestDialectOptions,
} from '../../services/api';
import { useTheme } from '../../contexts/ThemeContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MagicRefineModalProps {
  /** Whether the modal is visible. */
  visible: boolean;
  /** The raw text the user typed. */
  originalText: string;
  /** Called when the user wants to close without doing anything. */
  onClose: () => void;
  /** Called when the user taps "Replace" — injects refined text into input. */
  onReplace: (refinedText: string) => void;
  /** Called when the user taps "Replace & Send" — sends immediately. */
  onReplaceAndSend: (refinedText: string) => void;
}

// ── Option configs ─────────────────────────────────────────────────────────────

interface LanguageOption {
  value: DialectTargetLanguage;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

interface ToneOption {
  value: DialectTargetTone;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    value: 'english',
    label: 'English',
    icon: 'language-outline',
    color: '#4f46e5',
  },
  {
    value: 'singlish',
    label: 'Singlish',
    icon: 'chatbubble-outline',
    color: '#059669',
  },
  {
    value: 'tanglish',
    label: 'Tanglish',
    icon: 'chatbubbles-outline',
    color: '#d97706',
  },
];

const TONE_OPTIONS: ToneOption[] = [
  {
    value: 'professional',
    label: 'Professional',
    icon: 'briefcase-outline',
    color: '#2563eb',
  },
  {
    value: 'casual',
    label: 'Casual',
    icon: 'happy-outline',
    color: '#db2777',
  },
];

// ── Skeleton loader (Reanimated — runs on UI thread) ──────────────────────────

function SkeletonLine({ width, style }: { width: string | number; style?: object }) {
  const { colors } = useTheme();
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [shimmer]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + shimmer.value * 0.7,
  }));

  const highlightAnimStyle = useAnimatedStyle(() => ({
    opacity: shimmer.value,
    transform: [{ translateX: -40 + shimmer.value * 160 }],
  }));

  return (
    <Animated.View
      style={[
        skeletonStyles.line,
        { width, backgroundColor: colors.skeletonBase },
        animatedStyle,
        style,
      ]}
    >
      {/* Highlight sweep band */}
      <Animated.View
        style={[
          skeletonStyles.highlight,
          { backgroundColor: colors.skeletonHighlight },
          highlightAnimStyle,
        ]}
      />
    </Animated.View>
  );
}

const skeletonStyles = StyleSheet.create({
  line: {
    height: 14,
    borderRadius: 7,
    marginBottom: 8,
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    borderRadius: 7,
  },
});

function LoadingSkeleton() {
  return (
    <View style={{ gap: 4 }}>
      <SkeletonLine width="90%" />
      <SkeletonLine width="75%" />
      <SkeletonLine width="60%" />
    </View>
  );
}

interface AnimatedOptionChipProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  active: boolean;
  disabled?: boolean;
  borderColor: string;
  backgroundColor: string;
  onPress: () => void;
}

function AnimatedOptionChip({
  label,
  icon,
  color,
  active,
  disabled,
  borderColor,
  backgroundColor,
  onPress,
}: AnimatedOptionChipProps) {
  const activeProgress = useSharedValue(active ? 1 : 0);
  const pressScale = useSharedValue(1);

  useEffect(() => {
    activeProgress.value = withTiming(active ? 1 : 0, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, activeProgress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value * (1 + activeProgress.value * 0.03) }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={() => {
          pressScale.value = withTiming(0.96, { duration: 80 });
        }}
        onPressOut={() => {
          pressScale.value = withTiming(1, {
            duration: 120,
            easing: Easing.out(Easing.cubic),
          });
        }}
        style={({ pressed }) => [
          styles.modeChip,
          { borderColor, backgroundColor },
          active && { backgroundColor: color, borderColor: color },
          (pressed || disabled) && styles.modeChipPressed,
        ]}
      >
        <Ionicons name={icon} size={14} color={active ? '#fff' : color} />
        <Text style={[styles.modeChipText, { color: active ? '#fff' : color }]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MagicRefineModal({
  visible,
  originalText,
  onClose,
  onReplace,
  onReplaceAndSend,
}: MagicRefineModalProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const { colors } = useTheme();
  const [selectedLanguage, setSelectedLanguage] =
    useState<DialectTargetLanguage | null>(null);
  const [selectedTone, setSelectedTone] = useState<DialectTargetTone | null>(null);
  const [suggestion, setSuggestion] = useState<DialectSuggestionResult | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [refinedText, setRefinedText] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Smooth sheet transition with no overshoot.
  const slideY = useSharedValue(32);
  const fade = useSharedValue(0);
  const resultReveal = useSharedValue(0);
  const resultLift = useSharedValue(8);

  const detectAbortRef = useRef<AbortController | null>(null);
  const refineAbortRef = useRef<AbortController | null>(null);

  const isAnimatingOutRef = useRef(false);

  const animateOut = useCallback(
    (cb: () => void) => {
      if (isAnimatingOutRef.current) return;
      isAnimatingOutRef.current = true;
      detectAbortRef.current?.abort();
      detectAbortRef.current = null;
      refineAbortRef.current?.abort();
      refineAbortRef.current = null;

      slideY.value = withTiming(36, {
        duration: 180,
        easing: Easing.in(Easing.cubic),
      });
      fade.value = withTiming(
        0,
        {
          duration: 180,
          easing: Easing.in(Easing.cubic),
        },
        (finished) => {
          if (finished) runOnJS(cb)();
        },
      );
    },
    [fade, slideY],
  );

  const applyApiError = useCallback(
    (err: unknown, setMessage: (msg: string) => void) => {
      if (isCancel(err) || (err instanceof Error && err.name === 'AbortError')) {
        return;
      }

      if (isAxiosError(err)) {
        const status = err.response?.status;
        if (!err.response) {
          setMessage('Could not reach the server. Please check your connection.');
        } else if (status === 401) {
          setMessage('Your session has expired. Please log in again.');
        } else if (status === 429) {
          setMessage('Too many requests. Please wait a moment and retry.');
        } else if (status && status >= 500) {
          setMessage('Server error. Please try again in a moment.');
        } else {
          setMessage(`Unexpected error (${status ?? 'unknown'}). Please retry.`);
        }
      } else {
        setMessage('Something went wrong. Please check your connection and retry.');
      }
    },
    [],
  );

  const fetchSuggestions = useCallback(async () => {
    const text = originalText.trim();
    if (!text) return;

    detectAbortRef.current?.abort();
    const controller = new AbortController();
    detectAbortRef.current = controller;

    setIsDetecting(true);
    setDetectError(null);
    setGenerateError(null);

    try {
      const result = await suggestDialectOptions(text, controller.signal);
      setSuggestion(result);
      setSelectedLanguage(result.suggestedTargetLanguages[0] ?? 'english');
      setSelectedTone(result.suggestedTones[0] ?? 'casual');
    } catch (err) {
      applyApiError(err, setDetectError);
      setSuggestion(null);
      setSelectedLanguage('english');
      setSelectedTone('casual');
    } finally {
      setIsDetecting(false);
    }
  }, [applyApiError, originalText]);

  const handleGenerate = useCallback(async () => {
    const text = originalText.trim();
    if (!text || !selectedLanguage || !selectedTone) return;

    refineAbortRef.current?.abort();
    const controller = new AbortController();
    refineAbortRef.current = controller;

    setIsGenerating(true);
    setGenerateError(null);
    setRefinedText(null);

    try {
      const result = await refineTextV2(
        text,
        selectedLanguage,
        selectedTone,
        controller.signal,
      );
      setRefinedText(result.refinedText);
    } catch (err) {
      applyApiError(err, setGenerateError);
    } finally {
      setIsGenerating(false);
    }
  }, [applyApiError, originalText, selectedLanguage, selectedTone]);

  useEffect(() => {
    if (!visible) return;

    isAnimatingOutRef.current = false;
    setSuggestion(null);
    setIsDetecting(false);
    setDetectError(null);
    setRefinedText(null);
    setIsGenerating(false);
    setGenerateError(null);
    setSelectedLanguage(null);
    setSelectedTone(null);
    resultReveal.value = 0;
    resultLift.value = 8;

    slideY.value = 32;
    fade.value = 0;

    slideY.value = withTiming(0, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
    fade.value = withTiming(1, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });

    void fetchSuggestions();
  }, [fade, fetchSuggestions, resultLift, resultReveal, slideY, visible]);

  useEffect(() => {
    if (!refinedText) {
      resultReveal.value = 0;
      resultLift.value = 8;
      return;
    }

    resultReveal.value = 0;
    resultLift.value = 8;
    resultReveal.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    resultLift.value = withTiming(0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [refinedText, resultLift, resultReveal]);

  useEffect(() => {
    return () => {
      detectAbortRef.current?.abort();
      refineAbortRef.current?.abort();
    };
  }, []);

  const handleClose = useCallback(() => {
    animateOut(onClose);
  }, [animateOut, onClose]);

  const handleReplace = useCallback(() => {
    if (!refinedText) return;
    const text = refinedText;
    animateOut(() => onReplace(text));
  }, [refinedText, onReplace, animateOut]);

  const handleReplaceAndSend = useCallback(() => {
    if (!refinedText) return;
    const text = refinedText;
    animateOut(() => onReplaceAndSend(text));
  }, [refinedText, onReplaceAndSend, animateOut]);

  const slideAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideY.value }],
    opacity: fade.value,
  }));

  const resultRevealStyle = useAnimatedStyle(() => ({
    opacity: resultReveal.value,
    transform: [{ translateY: resultLift.value }],
  }));

  const isIdle = !isGenerating && !generateError && !refinedText;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      {/* Dimmed backdrop */}
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={[StyleSheet.absoluteFill, styles.backdrop, { backgroundColor: colors.overlayBg }]} />
      </TouchableWithoutFeedback>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            paddingBottom: insets.bottom + 16,
            backgroundColor: colors.sheetBg,
            maxHeight: Math.min(windowHeight * 0.88, 720),
            maxWidth: Math.min(windowWidth - 12, 580),
            alignSelf: 'center',
          },
          slideAnimStyle,
        ]}
      >
        {/* Handle */}
        <View style={[styles.handle, { backgroundColor: colors.sheetHandle }]} />

        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>✨ Magic Refine</Text>
          <Pressable onPress={handleClose} hitSlop={10}>
            <Ionicons name="close-circle" size={24} color={colors.textTertiary} />
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Original text – Section 1 ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>YOUR MESSAGE</Text>
            <View style={[styles.originalBox, { backgroundColor: colors.surface }]}>
              <Text style={[styles.originalText, { color: colors.modalText }]}>{originalText}</Text>
            </View>
          </View>

          {/* ── Smart preset status (no verbose details) ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>SMART PRESET</Text>
            <View style={[styles.presetCard, { backgroundColor: colors.surface }]}> 
              {isDetecting ? (
                <View style={styles.detectLoadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.detectLoadingText, { color: colors.textSecondary }]}>Preparing best defaults...</Text>
                </View>
              ) : detectError ? (
                <Pressable
                  onPress={fetchSuggestions}
                  style={({ pressed }) => [
                    styles.inlineRetryBtn,
                    { borderColor: colors.border, backgroundColor: colors.surfaceElevated },
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <Ionicons name="refresh-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.inlineRetryBtnText, { color: colors.textSecondary }]}>Retry Preset</Text>
                </Pressable>
              ) : (
                <Text style={[styles.presetText, { color: colors.textSecondary }]}>Smart preset applied. You can change language and tone below.</Text>
              )}
            </View>
          </View>

          {/* ── Target language ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>TARGET LANGUAGE</Text>
            <View style={styles.modeRow}>
              {LANGUAGE_OPTIONS.map((option) => {
                const active = selectedLanguage === option.value;
                return (
                  <AnimatedOptionChip
                    key={option.value}
                    label={option.label}
                    icon={option.icon}
                    color={option.color}
                    active={active}
                    disabled={isGenerating}
                    borderColor={colors.border}
                    backgroundColor={colors.surfaceElevated}
                    onPress={() => setSelectedLanguage(option.value)}
                  />
                );
              })}
            </View>
          </View>

          {/* ── Target tone ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>TARGET TONE</Text>
            <View style={styles.modeRow}>
              {TONE_OPTIONS.map((option) => {
                const active = selectedTone === option.value;
                return (
                  <AnimatedOptionChip
                    key={option.value}
                    label={option.label}
                    icon={option.icon}
                    color={option.color}
                    active={active}
                    disabled={isGenerating}
                    borderColor={colors.border}
                    backgroundColor={colors.surfaceElevated}
                    onPress={() => setSelectedTone(option.value)}
                  />
                );
              })}
            </View>
          </View>

          {/* ── Output – Section 3 ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>RESULT</Text>
            <View style={[styles.outputBox, { backgroundColor: colors.actionCardBg, borderColor: colors.actionCardBorder }]}>
              {isIdle ? (
                <Text style={[styles.idleText, { color: colors.textTertiary }]}>Choose a target language and tone, then tap Generate</Text>
              ) : isGenerating ? (
                <LoadingSkeleton />
              ) : generateError ? (
                <Text style={[styles.errorText, { color: colors.destructive }]}>{generateError}</Text>
              ) : refinedText ? (
                <Animated.View style={resultRevealStyle}>
                  <Text style={[styles.refinedText, { color: colors.text }]}>{refinedText}</Text>
                </Animated.View>
              ) : null}
            </View>
          </View>

          {/* ── Action buttons ── */}
          <View style={styles.actionRow}>
            <Pressable
              onPress={fetchSuggestions}
              disabled={isDetecting || isGenerating}
              style={({ pressed }) => [
                styles.retryBtn,
                { borderColor: colors.border, backgroundColor: colors.surface },
                (pressed || isDetecting || isGenerating) && { opacity: 0.6 },
              ]}
            >
              {isDetecting ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <>
                  <Ionicons name="flash-outline" size={14} color={colors.textSecondary} />
                  <Text style={[styles.retryText, { color: colors.modalText }]}>Detect</Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={handleGenerate}
              disabled={!selectedLanguage || !selectedTone || isDetecting || isGenerating}
              style={({ pressed }) => [
                styles.generateBtn,
                { backgroundColor: colors.primary },
                (!selectedLanguage || !selectedTone || isDetecting || isGenerating) && {
                  opacity: 0.4,
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              {isGenerating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="sparkles-outline" size={16} color="#fff" />
              )}
              <Text style={styles.sendBtnText}>Generate</Text>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            <Pressable
              onPress={handleReplace}
              disabled={!refinedText || isGenerating || isDetecting}
              style={({ pressed }) => [
                styles.replaceBtn,
                { borderColor: colors.primary, backgroundColor: colors.primaryFaded },
                (!refinedText || isGenerating || isDetecting) && { opacity: 0.4 },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons name="pencil-outline" size={16} color={colors.primary} />
              <Text style={[styles.replaceBtnText, { color: colors.primary }]}>Replace</Text>
            </Pressable>

            <Pressable
              onPress={handleReplaceAndSend}
              disabled={!refinedText || isGenerating || isDetecting}
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: colors.primary },
                (!refinedText || isGenerating || isDetecting) && { opacity: 0.4 },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={styles.sendBtnText}>Replace & Send</Text>
            </Pressable>
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {},  
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 6,
    right: 6,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  section: {
    gap: 8,
  },
  presetCard: {
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  detectLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detectLoadingText: {
    fontSize: 13,
    fontWeight: '500',
  },
  presetText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  inlineRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  inlineRetryBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  originalBox: {
    borderRadius: 12,
    padding: 12,
  },
  originalText: {
    fontSize: 14,
    lineHeight: 20,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  modeChipPressed: {
    opacity: 0.75,
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  outputBox: {
    minHeight: 80,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    justifyContent: 'center',
  },
  refinedText: {
    fontSize: 15,
    lineHeight: 22,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 20,
  },
  idleText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 8,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  retryIcon: {
    fontSize: 13,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
  },
  generateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
  },
  replaceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  replaceBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sendBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
  },
  sendBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
});
