import AsyncStorage from '@react-native-async-storage/async-storage';

export type QueuedMediaType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
export type QueuedMessageState = 'pending' | 'failed';

export interface QueuedAudioPayload {
  localUri: string;
  mimeType: string;
  durationMs?: number;
}

export interface QueuedFilePayload {
  fileUri: string;
  mimeType: string;
}

export interface QueuedMediaJob {
  id: string;
  groupId: string;
  optimisticId: string;
  mediaType: QueuedMediaType;
  state: QueuedMessageState;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  nextAttemptAt: number;
  text?: string;
  audio?: QueuedAudioPayload;
  file?: QueuedFilePayload;
  lastError?: string;
}

const STORAGE_PREFIX = 'chat-media-outbox:v1:';
const BASE_BACKOFF_MS = 1_500;
const MAX_BACKOFF_MS = 120_000;
export const MAX_MEDIA_OUTBOX_RETRY_ATTEMPTS = 8;

function buildStorageKey(groupId: string): string {
  return `${STORAGE_PREFIX}${groupId}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sanitizeAudioPayload(raw: unknown): QueuedAudioPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!isNonEmptyString(value.localUri) || !isNonEmptyString(value.mimeType)) {
    return null;
  }

  const durationMs =
    typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
      ? Math.max(0, value.durationMs)
      : undefined;

  return {
    localUri: value.localUri.trim(),
    mimeType: value.mimeType.trim(),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function sanitizeFilePayload(raw: unknown): QueuedFilePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!isNonEmptyString(value.fileUri) || !isNonEmptyString(value.mimeType)) {
    return null;
  }

  return {
    fileUri: value.fileUri.trim(),
    mimeType: value.mimeType.trim(),
  };
}

function sanitizeTextPayload(raw: unknown): string | null {
  if (!isNonEmptyString(raw)) return null;
  return raw.trim();
}

function sanitizeJob(raw: unknown, groupId: string): QueuedMediaJob | null {
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.optimisticId) ||
    (!isNonEmptyString(value.mediaType) &&
      !isNonEmptyString(value.messageType))
  ) {
    return null;
  }

  // Backward compatibility: older payloads use "mediaType" and no "state".
  const mediaTypeValue = isNonEmptyString(value.mediaType)
    ? value.mediaType
    : isNonEmptyString(value.messageType)
      ? value.messageType
      : null;
  if (!mediaTypeValue) return null;

  const mediaType = mediaTypeValue.toUpperCase();
  if (
    mediaType !== 'TEXT' &&
    mediaType !== 'AUDIO' &&
    mediaType !== 'IMAGE' &&
    mediaType !== 'DOCUMENT'
  ) {
    return null;
  }

  const state: QueuedMessageState = value.state === 'failed' ? 'failed' : 'pending';

  const audio = sanitizeAudioPayload(value.audio);
  const file = sanitizeFilePayload(value.file);
  const text =
    sanitizeTextPayload(value.text) ?? sanitizeTextPayload(value.rawContent);

  if (mediaType === 'TEXT' && !text) return null;
  if (mediaType === 'AUDIO' && !audio) return null;
  if ((mediaType === 'IMAGE' || mediaType === 'DOCUMENT') && !file) return null;

  const createdAt =
    isNonEmptyString(value.createdAt) ? value.createdAt : new Date().toISOString();
  const updatedAt =
    isNonEmptyString(value.updatedAt) ? value.updatedAt : createdAt;
  const attemptCount =
    typeof value.attemptCount === 'number' && Number.isFinite(value.attemptCount)
      ? Math.max(0, Math.floor(value.attemptCount))
      : 0;
  const nextAttemptAt =
    typeof value.nextAttemptAt === 'number' && Number.isFinite(value.nextAttemptAt)
      ? Math.max(0, Math.floor(value.nextAttemptAt))
      : Date.now();

  return {
    id: value.id.trim(),
    groupId,
    optimisticId: value.optimisticId.trim(),
    mediaType,
    state,
    createdAt,
    updatedAt,
    attemptCount,
    nextAttemptAt,
    ...(text ? { text } : {}),
    ...(audio ? { audio } : {}),
    ...(file ? { file } : {}),
    ...(isNonEmptyString(value.lastError)
      ? { lastError: value.lastError.trim() }
      : {}),
  };
}

function sortJobs(jobs: QueuedMediaJob[]): QueuedMediaJob[] {
  return [...jobs].sort((a, b) => {
    if (a.nextAttemptAt !== b.nextAttemptAt) {
      return a.nextAttemptAt - b.nextAttemptAt;
    }

    return a.createdAt.localeCompare(b.createdAt);
  });
}

export async function loadMediaOutbox(groupId: string): Promise<QueuedMediaJob[]> {
  try {
    const raw = await AsyncStorage.getItem(buildStorageKey(groupId));
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      await AsyncStorage.removeItem(buildStorageKey(groupId));
      return [];
    }

    return sortJobs(
      parsed
        .map((entry) => sanitizeJob(entry, groupId))
        .filter((entry): entry is QueuedMediaJob => entry != null),
    );
  } catch {
    return [];
  }
}

export async function saveMediaOutbox(
  groupId: string,
  jobs: QueuedMediaJob[],
): Promise<void> {
  const key = buildStorageKey(groupId);
  const sorted = sortJobs(jobs);

  if (sorted.length === 0) {
    await AsyncStorage.removeItem(key);
    return;
  }

  await AsyncStorage.setItem(key, JSON.stringify(sorted));
}

export function getMediaOutboxBackoffMs(attemptCount: number): number {
  const safeAttempt = Math.max(1, Math.floor(attemptCount));
  const baseDelay = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** (safeAttempt - 1),
  );

  const jitterFactor = 0.85 + Math.random() * 0.3;
  return Math.floor(baseDelay * jitterFactor);
}

export function getMediaOutboxErrorMessage(error: unknown): string {
  const err = error as {
    message?: string;
    response?: {
      status?: number;
      data?: {
        reason?: unknown;
        message?: unknown;
      };
    };
  };

  const status = err.response?.status;
  const reason = err.response?.data?.reason;
  const responseMessage = err.response?.data?.message;

  if (typeof reason === 'string' && reason.trim()) {
    return reason;
  }

  if (typeof responseMessage === 'string' && responseMessage.trim()) {
    return responseMessage;
  }

  if (Array.isArray(responseMessage)) {
    const firstString = responseMessage.find(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
    if (firstString) {
      return firstString;
    }
  }

  if (typeof status === 'number') {
    return `HTTP ${status}`;
  }

  return err.message ?? 'Unknown error';
}

export function shouldRetryMediaOutboxError(error: unknown): boolean {
  const err = error as {
    code?: string;
    response?: { status?: number };
    message?: string;
  };

  const status = err.response?.status;
  if (typeof status === 'number') {
    if (status === 408 || status === 425 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
  }

  const code = err.code?.toLowerCase?.() ?? '';
  const message = err.message?.toLowerCase?.() ?? '';

  return (
    code.includes('network') ||
    code.includes('timeout') ||
    code.includes('econn') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('socket')
  );
}
