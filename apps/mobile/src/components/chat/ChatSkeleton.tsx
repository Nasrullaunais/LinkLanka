import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../../contexts/ThemeContext';

// ── Single skeleton message bubble ───────────────────────────────────────────
interface SkeletonBubbleProps {
  align: 'left' | 'right';
  /** Width as a percentage of the container (30–80) */
  widthPercent: number;
  /** Number of text lines to render inside the bubble */
  lines?: number;
  /** Start offset so the stagger animation looks nice */
  delay?: number;
}

function SkeletonBubble({ align, widthPercent, lines = 1, delay = 0 }: SkeletonBubbleProps) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withTiming(0.9, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const isRight = align === 'right';

  return (
    <Animated.View style={[styles.row, isRight ? styles.rowRight : styles.rowLeft, animStyle]}>
      {/* Avatar dot on the left side for incoming messages */}
      {!isRight && (
        <View
          style={[
            styles.avatar,
            { backgroundColor: colors.skeletonBase },
          ]}
        />
      )}

      <View
        style={[
          styles.bubble,
          {
            width: `${widthPercent}%`,
            backgroundColor: isRight
              ? colors.bubbleOwn
              : colors.bubbleReceived,
          },
        ]}
      >
        {Array.from({ length: lines }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.textLine,
              {
                // Last line of multi-line is shorter — looks more natural
                width: i === lines - 1 && lines > 1 ? '60%' : '100%',
                backgroundColor: 'rgba(255,255,255,0.18)',
              },
            ]}
          />
        ))}
      </View>
    </Animated.View>
  );
}

// ── Skeleton layout — mirrors a realistic chat conversation ──────────────────
const SKELETON_CONFIG: {
  align: 'left' | 'right';
  width: number;
  lines: number;
}[] = [
  { align: 'right', width: 42, lines: 1 },
  { align: 'left',  width: 62, lines: 2 },
  { align: 'right', width: 55, lines: 2 },
  { align: 'left',  width: 38, lines: 1 },
  { align: 'right', width: 70, lines: 3 },
  { align: 'left',  width: 48, lines: 1 },
  { align: 'right', width: 35, lines: 1 },
  { align: 'left',  width: 66, lines: 2 },
];

// ── Exported full-screen skeleton ────────────────────────────────────────────
export default function ChatSkeleton() {
  return (
    <View style={styles.container}>
      {SKELETON_CONFIG.map((cfg, idx) => (
        <SkeletonBubble
          key={idx}
          align={cfg.align}
          widthPercent={cfg.width}
          lines={cfg.lines}
          delay={idx * 80}
        />
      ))}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 16,
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  rowLeft: {
    justifyContent: 'flex-start',
  },
  rowRight: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    flexShrink: 0,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
    // Constrain max width so wide bubbles don't eat the whole row
    maxWidth: '78%',
  },
  textLine: {
    height: 11,
    borderRadius: 5,
  },
});
