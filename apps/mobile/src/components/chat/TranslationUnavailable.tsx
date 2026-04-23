import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface TranslationUnavailableProps {
  onRetry: () => void;
}

const TranslationUnavailable = memo(function TranslationUnavailable({
  onRetry,
}: TranslationUnavailableProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color: colors.bubbleReceivedText }]}>
        Translation unavailable
      </Text>
      <Pressable onPress={onRetry} style={styles.retryButton}>
        <Text style={[styles.retryText, { color: colors.link }]}>Retry</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
  },
  retryButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  retryText: {
    fontSize: 15,
    lineHeight: 21,
  },
});

export default TranslationUnavailable;