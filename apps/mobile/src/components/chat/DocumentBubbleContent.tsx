import React, { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { fetchDocumentSummary, type SummaryBullet } from '../../services/api';
import { useTheme } from '../../contexts/ThemeContext';

interface DocumentBubbleContentProps {
  messageId: string;
  fileUrl: string;
  isOwn: boolean;
  isPendingUpload?: boolean;
  /** Original filename from the sender's device (null when unknown). */
  fileName?: string | null;
  onOpenInterrogation: () => void;
  onOpenInterrogationAtPage?: (page: number) => void;
}

/** Extract a human-readable filename from a server URL. */
function extractFilename(url: string): string {
  const cleanUrl = url.split('?')[0];
  const segments = cleanUrl.split('/');
  const raw = segments[segments.length - 1] ?? 'Document';
  if (raw.length > 40) {
    const ext = raw.split('.').pop() ?? '';
    return `Document.${ext}`;
  }
  return raw;
}

/** Map file extension to a display label. */
function getFileTypeLabel(url: string): string {
  const cleanUrl = url.split('?')[0];
  const ext = (cleanUrl.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = {
    pdf: 'PDF',
    doc: 'DOC',
    docx: 'DOCX',
    txt: 'TXT',
    xlsx: 'XLSX',
    xls: 'XLS',
  };
  return map[ext] ?? 'FILE';
}

function getFileExtension(url: string): string {
  const segments = url.split('/').pop() ?? '';
  return segments.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
}

export default memo(function DocumentBubbleContent({
  messageId,
  fileUrl,
  isOwn,
  isPendingUpload = false,
  fileName = null,
  onOpenInterrogation,
  onOpenInterrogationAtPage,
}: DocumentBubbleContentProps) {
  const [bullets, setBullets] = useState<SummaryBullet[] | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();

  const displayFilename = fileName ?? extractFilename(fileUrl);
  const typeLabel = getFileTypeLabel(fileUrl);
  const isLocalFileUri = fileUrl.trim().startsWith('file://');
  const interrogationReady = !isPendingUpload && !isLocalFileUri;

  const handleAiPeek = useCallback(async () => {
    if (!interrogationReady) {
      return;
    }

    // If already expanded, just toggle collapse
    if (isExpanded && bullets) {
      setIsExpanded(false);
      return;
    }

    // If we already have bullets cached, just expand
    if (bullets) {
      setIsExpanded(true);
      return;
    }

    const ext = getFileExtension(fileUrl);
    if (ext === 'xlsx' || ext === 'xls') {
      setError('Summaries are not available for spreadsheets. Tap the document to ask questions instead.');
      return;
    }

    // Fetch from API
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchDocumentSummary(messageId);
      setBullets(response.bullets);
      setIsExpanded(true);
    } catch (err) {
      setError('Failed to generate summary');
      console.error('[DocumentBubbleContent] Summary fetch failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [messageId, bullets, isExpanded, interrogationReady, fileUrl]);

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
    <Animated.View style={styles.container}>
      {/* ── Document card: tappable to open interrogation ── */}
      <Pressable
        onPress={interrogationReady ? onOpenInterrogation : undefined}
        disabled={!interrogationReady}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={[styles.iconBadge, {
          backgroundColor: isOwn ? 'rgba(255,255,255,0.2)' : colors.primaryFaded,
        }]}>
          <Ionicons name="document-text" size={28} color={isOwn ? '#fff' : colors.primary} />
        </View>
        <View style={styles.meta}>
          <Text style={[styles.filename, { color: isOwn ? '#fff' : colors.text }]} numberOfLines={1}>
            {displayFilename}
          </Text>
          <Text style={[styles.typeLabel, { color: isOwn ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>{typeLabel}</Text>
          {!interrogationReady && (
            <Text style={[styles.pendingText, { color: isOwn ? 'rgba(255,255,255,0.8)' : colors.textSecondary }]}>
              Available after upload finishes
            </Text>
          )}
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
        disabled={isLoading || !interrogationReady}
        style={({ pressed }) => [
          styles.peekBtn,
          { backgroundColor: peekBg },
          !interrogationReady && styles.peekBtnDisabled,
          pressed && styles.peekBtnPressed,
        ]}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : !interrogationReady ? (
          <>
            <Ionicons name="cloud-upload-outline" size={14} color={isOwn ? '#fff' : colors.primary} />
            <Text style={[styles.peekBtnText, { color: isOwn ? '#fff' : colors.primary }]}>Uploading document…</Text>
          </>
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
        <Animated.View
          entering={FadeIn.duration(250)}
          exiting={FadeOut.duration(200)}
          style={styles.bulletsContainer}
        >
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
        </Animated.View>
      )}
    </Animated.View>
  );
});

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
  pendingText: {
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
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
  peekBtnDisabled: {
    opacity: 0.75,
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
