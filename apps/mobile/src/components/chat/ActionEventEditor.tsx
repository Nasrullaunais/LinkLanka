import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import {
  addEventToCalendar,
  getAvailableCalendars,
  type CalendarInfo,
} from '../../utils/calendar';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EventEditorData {
  title: string;
  startDate: Date;
  endDate: Date;
  description?: string;
}

interface ActionEventEditorProps {
  visible: boolean;
  initialData: EventEditorData | null;
  onClose: () => void;
  onSaved: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleDateString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ActionEventEditor({
  visible,
  initialData,
  onClose,
  onSaved,
}: ActionEventEditorProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // ── Form state ─────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [notes, setNotes] = useState('');

  // ── Calendar picker state ──────────────────────────────────────────────
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(
    null,
  );
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  // ── Date/Time picker state (Android shows inline modals) ───────────────
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  // ── Save state ─────────────────────────────────────────────────────────
  const [isSaving, setIsSaving] = useState(false);

  // ── Initialize form when opened ────────────────────────────────────────
  useEffect(() => {
    if (visible && initialData) {
      setTitle(initialData.title);
      setStartDate(initialData.startDate);
      setEndDate(initialData.endDate);
      setNotes(initialData.description ?? '');
      setShowCalendarPicker(false);
      setShowStartDatePicker(false);
      setShowStartTimePicker(false);
      setShowEndDatePicker(false);
      setShowEndTimePicker(false);

      // Fetch available calendars
      setLoadingCalendars(true);
      getAvailableCalendars()
        .then((cals) => {
          setCalendars(cals);
          const primary = cals.find((c) => c.isPrimary);
          setSelectedCalendarId(primary?.id ?? cals[0]?.id ?? null);
        })
        .finally(() => setLoadingCalendars(false));
    }
  }, [visible, initialData]);

  const selectedCalendar = useMemo(
    () => calendars.find((c) => c.id === selectedCalendarId),
    [calendars, selectedCalendarId],
  );

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleStartDateChange = useCallback(
    (_: DateTimePickerEvent, date?: Date) => {
      setShowStartDatePicker(false);
      if (date) {
        // Preserve the existing time
        const updated = new Date(startDate);
        updated.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        setStartDate(updated);
        // Auto-adjust end date if it's before start
        if (updated > endDate) {
          setEndDate(new Date(updated.getTime() + 60 * 60 * 1000));
        }
      }
    },
    [startDate, endDate],
  );

  const handleStartTimeChange = useCallback(
    (_: DateTimePickerEvent, date?: Date) => {
      setShowStartTimePicker(false);
      if (date) {
        const updated = new Date(startDate);
        updated.setHours(date.getHours(), date.getMinutes());
        setStartDate(updated);
        if (updated > endDate) {
          setEndDate(new Date(updated.getTime() + 60 * 60 * 1000));
        }
      }
    },
    [startDate, endDate],
  );

  const handleEndDateChange = useCallback(
    (_: DateTimePickerEvent, date?: Date) => {
      setShowEndDatePicker(false);
      if (date) {
        const updated = new Date(endDate);
        updated.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
        if (updated >= startDate) setEndDate(updated);
      }
    },
    [endDate, startDate],
  );

  const handleEndTimeChange = useCallback(
    (_: DateTimePickerEvent, date?: Date) => {
      setShowEndTimePicker(false);
      if (date) {
        const updated = new Date(endDate);
        updated.setHours(date.getHours(), date.getMinutes());
        if (updated >= startDate) setEndDate(updated);
      }
    },
    [endDate, startDate],
  );

  // Dismiss keyboard before closing to prevent KeyboardAvoidingView race
  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    Keyboard.dismiss();
    setIsSaving(true);
    try {
      const success = await addEventToCalendar({
        title: title.trim(),
        startDate,
        endDate,
        notes: notes.trim() || undefined,
        calendarId: selectedCalendarId ?? undefined,
      });
      if (success) {
        onSaved();
        onClose();
      }
    } finally {
      setIsSaving(false);
    }
  }, [title, startDate, endDate, notes, selectedCalendarId, onSaved, onClose]);

  // ── Shared style values ────────────────────────────────────────────────
  const fieldBg = isDark ? 'rgba(255,255,255,0.06)' : '#f3f4f6';
  const fieldBorder = isDark ? 'rgba(255,255,255,0.1)' : '#e5e7eb';
  const dimmedText = isDark ? '#9ca3af' : '#6b7280';

  if (!visible || !initialData) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <View
          style={[styles.header, { borderBottomColor: fieldBorder }]}
        >
          <Pressable onPress={handleClose} hitSlop={12}>
            <Text style={[styles.headerBtn, { color: colors.textSecondary }]}>
              Cancel
            </Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            New Event
          </Text>
          <Pressable
            onPress={handleSave}
            disabled={isSaving || !title.trim()}
            hitSlop={12}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text
                style={[
                  styles.headerBtn,
                  styles.headerSave,
                  { color: title.trim() ? colors.primary : dimmedText },
                ]}
              >
                Add
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          contentInset={{ bottom: insets.bottom }}
          scrollIndicatorInsets={{ bottom: insets.bottom }}
        >
          {/* ── Title ───────────────────────────────────────────────── */}
          <View
            style={[
              styles.field,
              { backgroundColor: fieldBg, borderColor: fieldBorder },
            ]}
          >
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Event title"
              placeholderTextColor={dimmedText}
              style={[styles.titleInput, { color: colors.text }]}
              autoFocus
            />
          </View>

          {/* ── Calendar Picker ─────────────────────────────────────── */}
          <Pressable
            onPress={() => setShowCalendarPicker((v) => !v)}
            style={[
              styles.field,
              styles.row,
              { backgroundColor: fieldBg, borderColor: fieldBorder },
            ]}
          >
            <View style={styles.fieldIcon}>
              {selectedCalendar?.color ? (
                <View
                  style={[
                    styles.calendarDot,
                    { backgroundColor: selectedCalendar.color },
                  ]}
                />
              ) : (
                <Ionicons name="calendar" size={18} color={colors.primary} />
              )}
            </View>
            <View style={styles.fieldBody}>
              <Text style={[styles.fieldLabel, { color: dimmedText }]}>
                Calendar
              </Text>
              {loadingCalendars ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text
                  style={[styles.fieldValue, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {selectedCalendar?.title ?? 'No calendars available'}
                  {selectedCalendar?.source
                    ? ` (${selectedCalendar.source})`
                    : ''}
                </Text>
              )}
            </View>
            <Ionicons
              name="chevron-down"
              size={16}
              color={dimmedText}
            />
          </Pressable>

          {/* Calendar list dropdown */}
          {showCalendarPicker && calendars.length > 0 && (
            <View
              style={[
                styles.dropdown,
                {
                  backgroundColor: isDark ? '#1f2937' : '#fff',
                  borderColor: fieldBorder,
                },
              ]}
            >
              {calendars.map((cal) => {
                const isSelected = cal.id === selectedCalendarId;
                return (
                  <Pressable
                    key={cal.id}
                    onPress={() => {
                      setSelectedCalendarId(cal.id);
                      setShowCalendarPicker(false);
                    }}
                    style={[
                      styles.dropdownItem,
                      isSelected && {
                        backgroundColor: isDark
                          ? 'rgba(79,70,229,0.15)'
                          : '#eef2ff',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.calendarDot,
                        { backgroundColor: cal.color ?? colors.primary },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.dropdownText,
                          { color: colors.text },
                          isSelected && { fontWeight: '600' },
                        ]}
                        numberOfLines={1}
                      >
                        {cal.title}
                      </Text>
                      {cal.source ? (
                        <Text
                          style={[
                            styles.dropdownSubtext,
                            { color: dimmedText },
                          ]}
                        >
                          {cal.source}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected && (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={colors.primary}
                      />
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* ── Start Date/Time ─────────────────────────────────────── */}
          <View
            style={[
              styles.field,
              { backgroundColor: fieldBg, borderColor: fieldBorder },
            ]}
          >
            <View style={styles.fieldIcon}>
              <Ionicons
                name="time-outline"
                size={18}
                color={colors.primary}
              />
            </View>
            <View style={styles.fieldBody}>
              <Text style={[styles.fieldLabel, { color: dimmedText }]}>
                Starts
              </Text>
              <View style={styles.dateTimeRow}>
                <Pressable
                  onPress={() => setShowStartDatePicker(true)}
                  style={[
                    styles.dateTimePill,
                    { backgroundColor: isDark ? 'rgba(79,70,229,0.12)' : '#e0e7ff' },
                  ]}
                >
                  <Text style={[styles.dateTimeText, { color: colors.primary }]}>
                    {formatDate(startDate)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowStartTimePicker(true)}
                  style={[
                    styles.dateTimePill,
                    { backgroundColor: isDark ? 'rgba(79,70,229,0.12)' : '#e0e7ff' },
                  ]}
                >
                  <Text style={[styles.dateTimeText, { color: colors.primary }]}>
                    {formatTime(startDate)}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Native pickers (Android: shown as dialogs, iOS: inline) */}
          {showStartDatePicker && (
            <DateTimePicker
              value={startDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={handleStartDateChange}
              minimumDate={new Date()}
            />
          )}
          {showStartTimePicker && (
            <DateTimePicker
              value={startDate}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleStartTimeChange}
            />
          )}

          {/* ── End Date/Time ───────────────────────────────────────── */}
          <View
            style={[
              styles.field,
              { backgroundColor: fieldBg, borderColor: fieldBorder },
            ]}
          >
            <View style={styles.fieldIcon}>
              <Ionicons
                name="time-outline"
                size={18}
                color={dimmedText}
              />
            </View>
            <View style={styles.fieldBody}>
              <Text style={[styles.fieldLabel, { color: dimmedText }]}>
                Ends
              </Text>
              <View style={styles.dateTimeRow}>
                <Pressable
                  onPress={() => setShowEndDatePicker(true)}
                  style={[
                    styles.dateTimePill,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f3f4f6' },
                  ]}
                >
                  <Text style={[styles.dateTimeText, { color: colors.text }]}>
                    {formatDate(endDate)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setShowEndTimePicker(true)}
                  style={[
                    styles.dateTimePill,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#f3f4f6' },
                  ]}
                >
                  <Text style={[styles.dateTimeText, { color: colors.text }]}>
                    {formatTime(endDate)}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          {showEndDatePicker && (
            <DateTimePicker
              value={endDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={handleEndDateChange}
              minimumDate={startDate}
            />
          )}
          {showEndTimePicker && (
            <DateTimePicker
              value={endDate}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleEndTimeChange}
            />
          )}

          {/* ── Notes ───────────────────────────────────────────────── */}
          <View
            style={[
              styles.field,
              { backgroundColor: fieldBg, borderColor: fieldBorder },
            ]}
          >
            <View style={styles.fieldIcon}>
              <Ionicons
                name="document-text-outline"
                size={18}
                color={dimmedText}
              />
            </View>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Add notes..."
              placeholderTextColor={dimmedText}
              style={[styles.notesInput, { color: colors.text }]}
              multiline
              numberOfLines={3}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headerBtn: {
    fontSize: 16,
  },
  headerSave: {
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    gap: 12,
  },
  field: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  row: {
    gap: 10,
  },
  fieldIcon: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  fieldBody: {
    flex: 1,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fieldValue: {
    fontSize: 15,
  },
  titleInput: {
    fontSize: 17,
    fontWeight: '500',
    flex: 1,
    paddingVertical: 2,
  },
  notesInput: {
    fontSize: 15,
    flex: 1,
    paddingVertical: 2,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  dateTimePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  dateTimeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  calendarDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dropdown: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginTop: -8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  dropdownText: {
    fontSize: 14,
  },
  dropdownSubtext: {
    fontSize: 11,
    marginTop: 1,
  },
});
