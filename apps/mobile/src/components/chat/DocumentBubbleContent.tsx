import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchDocumentSummary, type SummaryBullet } from '../../services/api';
import { useTheme } from '../../contexts/ThemeContext';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface DocumentBubbleContentProps {
  messageId: string;
  fileUrl: string;
  isOwn: boolean;
  /** Called when the user taps the document card body (opens interrogation modal). */
  onOpenInterrogation: () => void;
  /** Called when the user taps a summary bullet with a page number. */
  onOpenInterrogationAtPage?: (page: number) => void;
}

/** Extract a human-readable filename from a server URL. */
function extractFilename(url: string): string {
  const segments = url.split('/');
  const raw = segments[segments.length - 1] ?? 'Document';
  // Remove the leading UUID prefix (e.g., "a1b2c3d4-...-filename.pdf" → "filename.pdf")
  // Server stores files as "uuid.ext", so just show it as-is but trim long UUIDs.
  if (raw.length > 40) {
    const ext = raw.split('.').pop() ?? '';
    return `Document.${ext}`;
  }
  return raw;
}

/** Map file extension to a display label. */
function getFileTypeLabel(url: string): string {
  const ext = (url.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = {
    pdf: 'PDF',
    doc: 'DOC',
    docx: 'DOCX',
    txt: 'TXT',
  };
  return map[ext] ?? 'FILE';
}

export default function DocumentBubbleContent({
  messageId,
  fileUrl,
  isOwn,
  onOpenInterrogation,
  onOpenInterrogationAtPage,
}: DocumentBubbleContentProps) {
  const [bullets, setBullets] = useState<SummaryBullet[] | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();

  const filename = extractFilename(fileUrl);
  const typeLabel = getFileTypeLabel(fileUrl);

  const handleAiPeek = useCallback(async () => {
    // If already expanded, just toggle collapse
    if (isExpanded && bullets) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsExpanded(false);
      return;
    }

    // If we already have bullets cached, just expand
    if (bullets) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsExpanded(true);
      return;
    }

    // Fetch from API
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchDocumentSummary(messageId);
      setBullets(response.bullets);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsExpanded(true);
    } catch (err) {
      setError('Failed to generate summary');
      console.error('[DocumentBubbleContent] Summary fetch failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [messageId, bullets, isExpanded]);

  const handleBulletPress = useCallback(
    (bullet: SummaryBullet) => {
      if (bullet.page != null && onOpenInterrogationAtPage) {
        onOpenInterrogationAtPage(bullet.page);
      } else {
        onOpenInterrogation();
      }
    },
    [onOpenInterrogation, onOpenInterrogationAtPage],
  );

  const peekBg = isOwn
    ? 'rgba(255,255,255,0.2)'
    : colors.primaryFaded;

  return (
    <View style={styles.container}>
      {/* ── Document card: tappable to open interrogation ── */}
      <Pressable
        onPress={onOpenInterrogation}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={[styles.iconBadge, {
          backgroundColor: isOwn ? 'rgba(255,255,255,0.2)' : colors.primaryFaded,
        }]}>
          <Ionicons name="document-text" size={28} color={isOwn ? '#fff' : colors.primary} />
        </View>
        <View style={styles.meta}>
          <Text style={[styles.filename, { color: isOwn ? '#fff' : colors.text }]} numberOfLines={1}>
            {filename}
          </Text>
          <Text style={[styles.typeLabel, { color: isOwn ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>{typeLabel}</Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={isOwn ? 'rgba(255,255,255,0.6)' : colors.chevronColor}
        />
      </Pressable>

      {/* ── AI Peek button ── */}
      <Pressable
        onPress={handleAiPeek}
        disabled={isLoading}
        style={({ pressed }) => [
          styles.peekBtn,
          { backgroundColor: peekBg },
          pressed && styles.peekBtnPressed,
        ]}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <>
            <Text style={styles.peekBtnIcon}>✨</Text>
            <Text style={[styles.peekBtnText, { color: isOwn ? '#fff' : colors.primary }]}>
              {isExpanded ? 'Hide Summary' : 'AI Peek'}
            </Text>
          </>
        )}
      </Pressable>

      {/* ── Error state ── */}
      {error && (
        <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
      )}

      {/* ── Expanded summary bullets ── */}
      {isExpanded && bullets && (
        <View style={styles.bulletsContainer}>
          {bullets.map((bullet, idx) => (
            <Pressable
              key={idx}
              onPress={() => handleBulletPress(bullet)}
              style={({ pressed }) => [styles.bulletRow, pressed && { backgroundColor: colors.primaryFaded }]}
            >
              <Text style={[styles.bulletDot, { color: colors.primary }]}>•</Text>
              <View style={styles.bulletContent}>
                <Text style={[styles.bulletText, { color: isOwn ? 'rgba(255,255,255,0.9)' : colors.modalText }]}>
                  {bullet.text}
                </Text>
                {bullet.page != null && (
                  <Text style={[styles.bulletPage, { color: colors.textTertiary }]}>p. {bullet.page}</Text>
                )}
              </View>
              <Ionicons name="open-outline" size={14} color={colors.textTertiary} style={styles.bulletLink} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    width: 240,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  cardPressed: {
    opacity: 0.7,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
  },
  filename: {
    fontSize: 14,
    fontWeight: '600',
  },
  typeLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  peekBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 20,
    gap: 4,
  },
  peekBtnPressed: {
    opacity: 0.7,
  },
  peekBtnIcon: {
    fontSize: 14,
  },
  peekBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 6,
    paddingHorizontal: 12,
  },
  bulletsContainer: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  bulletDot: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 1,
  },
  bulletContent: {
    flex: 1,
  },
  bulletText: {
    fontSize: 13,
    lineHeight: 18,
  },
  bulletPage: {
    fontSize: 10,
    marginTop: 2,
  },
  bulletLink: {
    marginTop: 3,
  },
});
