import React, { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import ActionEventEditor, {
  type EventEditorData,
} from './ActionEventEditor';

// ── Types ────────────────────────────────────────────────────────────────────
export interface ExtractedAction {
  type: 'MEETING' | 'REMINDER';
  title: string;
  timestamp: string; // ISO 8601
  description?: string;
}

interface ActionCardProps {
  actions: ExtractedAction[];
  isOwn: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Formats an ISO timestamp into a human-friendly string like "Tomorrow, 8:00 PM" */
function formatActionTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();

  // Check if it's today or tomorrow
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const timeStr = date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) return `Today, ${timeStr}`;
  if (isTomorrow) return `Tomorrow, ${timeStr}`;

  // Otherwise show full date
  const dateStr = date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${dateStr}, ${timeStr}`;
}

function getActionIcon(type: ExtractedAction['type']): string {
  return type === 'MEETING' ? 'calendar' : 'alarm';
}

function getActionLabel(type: ExtractedAction['type']): string {
  return type === 'MEETING' ? 'Meeting proposed' : 'Reminder';
}

// ── Component ────────────────────────────────────────────────────────────────

function SingleActionCard({
  action,
  isOwn,
}: {
  action: ExtractedAction;
  isOwn: boolean;
}) {
  const [isAdded, setIsAdded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const { colors, isDark } = useTheme();

  const editorData: EventEditorData = {
    title: action.title,
    startDate: new Date(action.timestamp),
    endDate: new Date(new Date(action.timestamp).getTime() + 60 * 60 * 1000),
    description: action.description,
  };

  const handleAddToCalendar = useCallback(() => {
    if (isAdded) return;
    setEditorVisible(true);
  }, [isAdded]);

  const handleSaved = useCallback(() => {
    setIsAdded(true);
  }, []);

  const meetingBadgeBg = isDark ? 'rgba(99,102,241,0.18)' : '#e0e7ff';
  const reminderBadgeBg = isDark ? 'rgba(245,158,11,0.15)' : '#fef3c7';
  const calBtnAddedBg = isDark ? 'rgba(34,197,94,0.15)' : '#d1fae5';
  const calBtnAddedText = isDark ? '#34d399' : '#059669';

  if (isDismissed) return null;

  return (
    <View style={[styles.actionCard, {
      backgroundColor: isOwn ? colors.translationBgOwn : colors.actionCardBg,
      borderColor: isOwn ? colors.translationBorderOwn : colors.actionCardBorder,
    }]}>
      {/* Header row: icon + type label + close button */}
      <View style={styles.actionHeader}>
        <View style={[styles.iconBadge, {
          backgroundColor: action.type === 'MEETING' ? meetingBadgeBg : reminderBadgeBg,
        }]}>
          <Ionicons
            name={getActionIcon(action.type) as any}
            size={14}
            color={action.type === 'MEETING' ? colors.primary : colors.warning}
          />
        </View>
        <Text style={[styles.actionLabel, { color: colors.primary }]}>{getActionLabel(action.type)}</Text>
        <Pressable
          onPress={() => setIsDismissed(true)}
          hitSlop={10}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Title */}
      <Text style={[styles.actionTitle, { color: colors.text }]}>{action.title}</Text>

      {/* Time */}
      <View style={styles.timeRow}>
        <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
        <Text style={[styles.timeText, { color: colors.textSecondary }]}>{formatActionTime(action.timestamp)}</Text>
      </View>

      {/* Description (optional) */}
      {action.description ? (
        <Text style={[styles.descriptionText, { color: colors.textTertiary }]}>{action.description}</Text>
      ) : null}

      {/* Add to Calendar button */}
      <Pressable
        onPress={handleAddToCalendar}
        disabled={isAdded}
        style={[
          styles.calendarButton,
          { backgroundColor: isAdded ? calBtnAddedBg : colors.primaryFaded },
        ]}
      >
        <Ionicons
          name={isAdded ? 'checkmark-circle' : 'calendar-outline'}
          size={15}
          color={isAdded ? calBtnAddedText : colors.primary}
        />
        <Text
          style={[
            styles.calendarButtonText,
            { color: isAdded ? calBtnAddedText : colors.primary },
          ]}
        >
          {isAdded ? 'Added to Calendar' : 'Add to Calendar'}
        </Text>
      </Pressable>

      {/* Event editor modal */}
      <ActionEventEditor
        visible={editorVisible}
        initialData={editorData}
        onClose={() => setEditorVisible(false)}
        onSaved={handleSaved}
      />
    </View>
  );
}

export default function ActionCard({ actions, isOwn }: ActionCardProps) {
  if (!actions || actions.length === 0) return null;

  return (
    <View style={styles.container}>
      {actions.map((action, index) => (
        <SingleActionCard key={`${action.type}-${index}`} action={action} isOwn={isOwn} />
      ))}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    marginTop: 4,
    gap: 4,
  },
  actionCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  closeButton: {
    marginLeft: 'auto',
    padding: 2,
  },
  iconBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '500',
  },
  descriptionText: {
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  calendarButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginTop: 2,
  },
  calendarButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
