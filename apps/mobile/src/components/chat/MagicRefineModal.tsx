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
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isAxiosError, isCancel } from 'axios';

import { refineText, RefineMode } from '../../services/api';
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

// ── Mode config ───────────────────────────────────────────────────────────────

interface ModeConfig {
  mode: RefineMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const MODES: ModeConfig[] = [
  {
    mode: 'professional',
    label: 'Professional',
    icon: 'briefcase-outline',
    color: '#4f46e5',
  },
  {
    mode: 'singlish',
    label: 'Casual Singlish',
    icon: 'chatbubble-outline',
    color: '#059669',
  },
  {
    mode: 'tanglish',
    label: 'Casual Tanglish',
    icon: 'chatbubbles-outline',
    color: '#d97706',
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
          useAnimatedStyle(() => ({
            opacity: shimmer.value,
            transform: [{ translateX: -40 + shimmer.value * 160 }],
          })),
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

// ── Main component ────────────────────────────────────────────────────────────

export default function MagicRefineModal({
  visible,
  originalText,
  onClose,
  onReplace,
  onReplaceAndSend,
}: MagicRefineModalProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors } = useTheme();
  const [selectedMode, setSelectedMode] = useState<RefineMode | null>(null);
  const [refinedText, setRefinedText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reanimated shared value for slide animation (runs on UI thread).
  const slideY = useSharedValue(windowHeight);

  // Fix #2 & #3 — track the active AbortController so:
  //   a) switching modes cancels the previous in-flight request (race condition)
  //   b) closing the modal cancels any pending request (stops wasted Gemini quota)
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fix #7 — track whether a close animation is already running to prevent
  // the visible=false useEffect from fighting the outgoing animation.
  const isAnimatingOutRef = useRef(false);

  useEffect(() => {
    if (visible) {
      // Reset state for fresh open.
      isAnimatingOutRef.current = false;
      setRefinedText(null);
      setError(null);
      setSelectedMode(null);
      // Start from off-screen, spring to 0.
      slideY.value = windowHeight;
      slideY.value = withSpring(0, { damping: 20, stiffness: 200 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const fetchRefined = useCallback(
    async (mode: RefineMode) => {
      if (!originalText.trim()) return;

      // Fix #2 — cancel any previous in-flight request before starting a new one.
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);
      setRefinedText(null);
      try {
        const result = await refineText(originalText.trim(), mode, controller.signal);
        setRefinedText(result.refinedText);
      } catch (err) {
        // Fix #3 — ignore errors from requests we deliberately cancelled.
        if (isCancel(err) || (err instanceof Error && err.name === 'AbortError')) {
          return;
        }
        // Fix #10 — surface a specific message based on HTTP status rather than
        // a generic catch-all string.
        if (isAxiosError(err)) {
          const status = err.response?.status;
          if (!err.response) {
            setError('Could not reach the server. Please check your connection.');
          } else if (status === 401) {
            setError('Your session has expired. Please log in again.');
          } else if (status === 429) {
            setError('Too many requests — please wait a moment, then retry.');
          } else if (status && status >= 500) {
            setError('Server error. Please try again in a moment.');
          } else {
            setError(`Unexpected error (${status ?? 'unknown'}). Please retry.`);
          }
        } else {
          setError('Something went wrong. Please check your connection and retry.');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [originalText],
  );

  const handleModeSelect = useCallback(
    (mode: RefineMode) => {
      setSelectedMode(mode);
      fetchRefined(mode);
    },
    [fetchRefined],
  );

  const isIdle = !selectedMode && !isLoading && !error && !refinedText;

  const handleRetry = useCallback(() => {
    if (selectedMode) fetchRefined(selectedMode);
  }, [fetchRefined, selectedMode]);

  // Fix #7 — animate the sheet off-screen first, then notify the parent so
  // the full slide-out is always visible instead of an instant vanish.
  const animateOut = useCallback(
    (cb: () => void) => {
      if (isAnimatingOutRef.current) return;
      isAnimatingOutRef.current = true;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      slideY.value = withTiming(windowHeight, { duration: 260 }, (finished) => {
        if (finished) runOnJS(cb)();
      });
    },
    [slideY, windowHeight],
  );

  const handleClose = useCallback(() => {
    animateOut(onClose);
  }, [animateOut, onClose]);

  // Animate out, then inject text (parent will flip visible=false).
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
  }));

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
          { paddingBottom: insets.bottom + 16, backgroundColor: colors.sheetBg },
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

          {/* ── Mode selector – Section 2 ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>TRANSFORM TO</Text>
            <View style={styles.modeRow}>
              {MODES.map((m) => {
                const active = selectedMode != null && selectedMode === m.mode;
                return (
                  <Pressable
                    key={m.mode}
                    onPress={() => handleModeSelect(m.mode)}
                    style={({ pressed }) => [
                      styles.modeChip,
                      { borderColor: colors.border, backgroundColor: colors.surfaceElevated },
                      active && { backgroundColor: m.color, borderColor: m.color },
                      pressed && styles.modeChipPressed,
                    ]}
                  >
                    <Ionicons
                      name={m.icon}
                      size={14}
                      color={active ? '#fff' : m.color}
                    />
                    <Text
                      style={[
                        styles.modeChipText,
                        { color: active ? '#fff' : m.color },
                      ]}
                    >
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ── Output – Section 3 ── */}
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>RESULT</Text>
            <View style={[styles.outputBox, { backgroundColor: colors.actionCardBg, borderColor: colors.actionCardBorder }]}>
              {isIdle ? (
                <Text style={[styles.idleText, { color: colors.textTertiary }]}>Choose a style above to refine your message</Text>
              ) : isLoading ? (
                <LoadingSkeleton />
              ) : error ? (
                <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
              ) : refinedText ? (
                <Text style={[styles.refinedText, { color: colors.text }]}>{refinedText}</Text>
              ) : null}
            </View>
          </View>

          {/* ── Action buttons ── */}
          <View style={styles.actionRow}>
            {/* Retry */}
            <Pressable
              onPress={handleRetry}
              disabled={isLoading || !selectedMode}
              style={({ pressed }) => [
                styles.retryBtn,
                { borderColor: colors.border, backgroundColor: colors.surface },
                (pressed || isLoading || !selectedMode) && { opacity: 0.6 },
              ]}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <>
                  <Text style={styles.retryIcon}>🔄</Text>
                  <Text style={[styles.retryText, { color: colors.modalText }]}>Retry</Text>
                </>
              )}
            </Pressable>

            {/* Replace (into input bar only) */}
            <Pressable
              onPress={handleReplace}
              disabled={!refinedText || isLoading}
              style={({ pressed }) => [
                styles.replaceBtn,
                { borderColor: colors.primary, backgroundColor: colors.primaryFaded },
                (!refinedText || isLoading) && { opacity: 0.4 },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons name="pencil-outline" size={16} color={colors.primary} />
              <Text style={[styles.replaceBtnText, { color: colors.primary }]}>Replace</Text>
            </Pressable>

            {/* Replace & Send */}
            <Pressable
              onPress={handleReplaceAndSend}
              disabled={!refinedText || isLoading}
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: colors.primary },
                (!refinedText || isLoading) && { opacity: 0.4 },
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
    left: 0,
    right: 0,
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
