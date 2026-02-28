import * as ExpoCalendar from 'expo-calendar';
import { Alert, Linking, Platform } from 'react-native';

export interface CalendarEvent {
  title: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
  calendarId?: string;
}

/** Simplified calendar info for the UI picker. */
export interface CalendarInfo {
  id: string;
  title: string;
  color?: string;
  isPrimary: boolean;
  source?: string;
}

// ── Permission helpers ───────────────────────────────────────────────────────

/**
 * Modern two-step permission flow:
 *  1. Check current status without prompting.
 *  2. If undetermined → request the native runtime prompt.
 *  3. If denied (user tapped "Don't allow" previously) → show a friendly
 *     Alert with an "Open Settings" button so they can flip the toggle.
 *
 * Returns true when calendar access is granted.
 */
export async function ensureCalendarPermission(): Promise<boolean> {
  // Step 1 — check what we already have
  const { status: existingStatus } =
    await ExpoCalendar.getCalendarPermissionsAsync();

  if (existingStatus === 'granted') return true;

  // Step 2 — first time? Show the native runtime prompt
  if (existingStatus === 'undetermined') {
    const { status: newStatus } =
      await ExpoCalendar.requestCalendarPermissionsAsync();
    return newStatus === 'granted';
  }

  // Step 3 — previously denied → guide to Settings (no more native prompt)
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Calendar Access Needed',
      'LinkLanka needs calendar permission to add meetings and reminders ' +
        'from your chats.\n\nPlease tap "Open Settings" and enable Calendar access.',
      [
        { text: 'Not Now', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Open Settings',
          onPress: () => {
            Linking.openSettings();
            resolve(false);
          },
        },
      ],
    );
  });
}

// ── Calendar discovery ───────────────────────────────────────────────────────

/**
 * Returns a list of writable calendars the user can choose from.
 * Ensures permissions are granted before querying.
 */
export async function getAvailableCalendars(): Promise<CalendarInfo[]> {
  const granted = await ensureCalendarPermission();
  if (!granted) return [];

  const calendars = await ExpoCalendar.getCalendarsAsync(
    ExpoCalendar.EntityTypes.EVENT,
  );

  // Filter to writable calendars
  const writable = calendars.filter((c) => {
    if (Platform.OS === 'ios') return c.allowsModifications !== false;
    return (
      c.accessLevel === 'owner' ||
      c.accessLevel === 'root' ||
      c.accessLevel === 'contributor' ||
      c.allowsModifications !== false
    );
  });

  return writable.map((c) => ({
    id: c.id,
    title: c.title || c.name || 'Unnamed Calendar',
    color: c.color ?? undefined,
    isPrimary: !!(c.isPrimary),
    source: c.source?.name ?? undefined,
  }));
}

/**
 * Returns the ID of the preferred default calendar.
 */
export async function getDefaultCalendarId(): Promise<string | null> {
  const calendars = await getAvailableCalendars();
  if (calendars.length === 0) return null;
  const primary = calendars.find((c) => c.isPrimary);
  return primary?.id ?? calendars[0]?.id ?? null;
}

// ── Event creation ───────────────────────────────────────────────────────────

/**
 * Adds an event to a specific calendar.
 * Returns true if the event was successfully created, false otherwise.
 */
export async function addEventToCalendar(
  event: CalendarEvent,
): Promise<boolean> {
  try {
    const granted = await ensureCalendarPermission();
    if (!granted) return false;

    let calendarId = event.calendarId;

    if (!calendarId) {
      calendarId = (await getDefaultCalendarId()) ?? undefined;
    }

    if (!calendarId) {
      Alert.alert(
        'No Calendar Available',
        'No writable calendar was found on this device. ' +
          'Please add a calendar account in your device settings.',
      );
      return false;
    }

    await ExpoCalendar.createEventAsync(calendarId, {
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      notes: event.notes,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    return true;
  } catch (error) {
    console.error('[addEventToCalendar] Failed:', error);
    Alert.alert(
      'Something Went Wrong',
      'Failed to add the event to your calendar. Please try again.',
    );
    return false;
  }
}
