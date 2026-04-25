import axios from 'axios';
import Constants from 'expo-constants';
import { File as ExpoFile } from 'expo-file-system';
import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

import {
  getSecureItem,
  setSecureItem,
  deleteSecureItem,
} from '../utils/secureStorage';

// ── Config ───────────────────────────────────────────────────────────────────
// API URL is injected via EXPO_PUBLIC_API_URL in apps/mobile/.env
// Run `./use-home.sh` or `./use-uni.sh` from the workspace root to switch environments.
function resolveApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (envUrl) return envUrl;

  // In Expo dev sessions, hostUri usually points to the machine running Metro.
  const hostUri = Constants.expoConfig?.hostUri;
  const metroHost = hostUri?.split(':')[0];
  if (metroHost) return `http://${metroHost}:3000`;

  // Android emulator cannot reach host localhost directly.
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000';
  return 'http://localhost:3000';
}

export const API_BASE_URL = resolveApiBaseUrl();

if (__DEV__ && !process.env.EXPO_PUBLIC_API_URL) {
  console.warn(
    `[api] EXPO_PUBLIC_API_URL is not set. Falling back to ${API_BASE_URL}.`,
  );
}

const TOKEN_KEY = 'jwt_token';
const MULTIPART_UPLOAD_TIMEOUT_MS = 30_000;
const MULTIPART_UPLOAD_RETRY_DELAY_MS = 400;

type UnauthorizedHandler = () => void | Promise<void>;

// In-memory copy so requests made immediately after login never race
// against SecureStore finishing its async write.
let _memoryToken: string | null = null;
let _onUnauthorized: UnauthorizedHandler | null = null;
let _isHandlingUnauthorized = false;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  _onUnauthorized = handler;
}

// ── Request interceptor ──────────────────────────────────────────────────────
apiClient.interceptors.request.use(
  async (config) => {
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      // Let React Native set the multipart boundary automatically.
      const headers = config.headers as
        | (Record<string, unknown> & {
            set?: (name: string, value?: string) => void;
          })
        | undefined;

      headers?.set?.('Content-Type', undefined);
      if (headers) {
        delete headers['Content-Type'];
        delete headers['content-type'];
      }
    }

    const token = _memoryToken ?? (await getSecureItem(TOKEN_KEY));
    if (token) config.headers.Authorization = 'Bearer ' + token;
    return config;
  },
  (error) => Promise.reject(error),
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const authHeader =
      error?.config?.headers?.Authorization ??
      error?.config?.headers?.authorization;

    if (status === 401 && authHeader && !_isHandlingUnauthorized) {
      _isHandlingUnauthorized = true;
      void (async () => {
        try {
          await removeAuthToken();
          await _onUnauthorized?.();
        } finally {
          _isHandlingUnauthorized = false;
        }
      })();
    }

    return Promise.reject(error);
  },
);

// ── Token helpers ────────────────────────────────────────────────────────────
export async function setAuthToken(token: string): Promise<void> {
  _memoryToken = token;
  await setSecureItem(TOKEN_KEY, token);
}

export async function removeAuthToken(): Promise<void> {
  _memoryToken = null;
  await deleteSecureItem(TOKEN_KEY);
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface OtherUser {
  id: string;
  displayName: string;
  nativeDialect: string;
  profilePictureUrl: string | null;
}

export interface GroupItem {
  id: string;
  name: string | null;
  isGroup: boolean;
  createdAt: string;
  memberCount: number;
  lastMessageAt: string | null;
  /** Current user's per-conversation language preference (null = use nativeDialect). */
  preferredLanguage: string | null;
  /** Populated for DMs (isGroup = false). The other participant. */
  otherUser: OtherUser | null;
}

export interface UserItem {
  id: string;
  displayName: string;
  nativeDialect: string;
  profilePictureUrl: string | null;
}

export interface CurrentUser {
  id: string;
  displayName: string;
  nativeDialect: string;
  email: string;
  createdAt: string;
  profilePictureUrl: string | null;
}
export interface GroupMemberUser {
  id: string;
  displayName: string;
  nativeDialect: string;
  profilePictureUrl: string | null;
  email: string;
}

export interface GroupMemberItem {
  id: string;
  groupId: string;
  userId: string;
  role: 'ADMIN' | 'MEMBER';
  preferredLanguage: string | null;
  joinedAt: string;
  user: GroupMemberUser | null;
}
// ── Groups ───────────────────────────────────────────────────────────────────

export async function fetchGroups(): Promise<GroupItem[]> {
  const { data } = await apiClient.get<GroupItem[]>('/groups');
  return data;
}

export async function createGroup(payload: {
  name: string;
  memberIds?: string[];
}): Promise<GroupItem> {
  const { data } = await apiClient.post<GroupItem>('/groups', payload);
  return data;
}

/** Find or create a DM conversation with targetUserId. Idempotent. */
export async function createDm(targetUserId: string): Promise<GroupItem> {
  const { data } = await apiClient.post<GroupItem>('/groups/dm', { targetUserId });
  return data;
}

/** Set the per-conversation language preference. Pass null to reset to global default. */
export async function setLanguagePreference(
  groupId: string,
  language: string | null,
): Promise<void> {
  await apiClient.patch(`/groups/${groupId}/language`, { language });
}
/** Fetch all members of a group with their profile data and roles. */
export async function fetchGroupMembers(groupId: string): Promise<GroupMemberItem[]> {
  const { data } = await apiClient.get<GroupMemberItem[]>(`/groups/${groupId}/members`);
  return data;
}

/** Add a user to a group. Any existing member can call this. */
export async function addGroupMember(groupId: string, userId: string): Promise<void> {
  await apiClient.post(`/groups/${groupId}/members`, { userId });
}

/** Leave a group by removing yourself from the member list. */
export async function leaveGroup(groupId: string, currentUserId: string): Promise<void> {
  await apiClient.delete(`/groups/${groupId}/members/${currentUserId}`);
}

/** Update group details. Any member can call this. */
export async function updateGroupName(groupId: string, name: string): Promise<void> {
  await apiClient.patch(`/groups/${groupId}`, { name });
}

/** Fetch a user's public profile by ID. */
export async function fetchUserById(userId: string): Promise<CurrentUser> {
  const { data } = await apiClient.get<CurrentUser>(`/users/${userId}`);
  return data;
}
// ── Users ────────────────────────────────────────────────────────────────────

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const { data } = await apiClient.get<CurrentUser>('/users/me');
  return data;
}

export async function updateProfile(payload: {
  displayName?: string;
  nativeDialect?: string;
}): Promise<CurrentUser> {
  const { data } = await apiClient.patch<CurrentUser>('/users/me', payload);
  return data;
}

export async function uploadProfilePicture(
  fileUri: string,
  mimeType = 'image/jpeg',
): Promise<{ url: string }> {
  return uploadMultipartFile(
    '/users/me/profile-picture',
    fileUri,
    mimeType,
    'profile.jpg',
  );
}

export async function searchUsers(query: string, limit = 20): Promise<UserItem[]> {
  const { data } = await apiClient.get<UserItem[]>('/users', {
    params: { search: query, limit },
  });
  return data;
}

// ── Chat Search ──────────────────────────────────────────────────────────────

export interface SearchResultItem {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  contentType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT';
  rawContent: string;
  transcription: string | null;
  headline: string;
  createdAt: string;
}

export interface SearchResponse {
  results: SearchResultItem[];
  total: number;
}

/**
 * Full-text search within a chat group. Searches across raw_content
 * and transcription columns using PostgreSQL FTS + ILIKE fallback.
 */
export async function searchChatMessages(
  groupId: string,
  query: string,
  page = 1,
  limit = 20,
): Promise<SearchResponse> {
  const { data } = await apiClient.get<SearchResponse>(
    `/chat/groups/${groupId}/search`,
    { params: { q: query, page, limit } },
  );
  return data;
}

// ── Translation ───────────────────────────────────────────────────────────────

export interface TranslationResult {
  translations: {
    english: string;
    singlish: string;
    tanglish: string;
  };
  confidenceScore: number;
  detectedLanguage?: 'english' | 'singlish' | 'tanglish' | 'mixed' | 'unknown' | null;
  originalTone?: string | null;
  translatedAudioUrls?: {
    english?: string;
    singlish?: string;
    tanglish?: string;
  } | null;
}

export async function retranslateMessage(messageId: string): Promise<TranslationResult> {
  const { data } = await apiClient.post<TranslationResult>(
    `/chat/messages/${messageId}/retranslate`,
  );
  return data;
}

export async function retryTranslation(messageId: string): Promise<TranslationResult> {
  const { data } = await apiClient.post<TranslationResult>(
    `/chat/messages/${messageId}/retranslate`,
  );
  return data;
}

// ── Audio ─────────────────────────────────────────────────────────────────────

export interface AudioProcessResult {
  success: true;
  messageId: string;
  rawContent: string;
}

/**
 * Send a base64-encoded audio recording to the dedicated REST endpoint for
 * processing (save → silence check → Gemini transcription → persist → broadcast).
 *
 * Throws AxiosError with response.data.reason === 'audioNotAudible' (HTTP 422)
 * when the AI determines the recording is silent or inaudible.
 */
export async function processAudio(
  groupId: string,
  audioBase64: string,
  audioMimeType: string,
  durationMs?: number,
  clientTempId?: string,
): Promise<AudioProcessResult> {
  const { data } = await apiClient.post<AudioProcessResult>('/audio/process', {
    groupId,
    audioBase64,
    audioMimeType,
    durationMs,
    clientTempId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return data;
}

// ── Dialect / Magic Refine ───────────────────────────────────────────────────────────────

export type RefineMode = 'professional' | 'singlish' | 'tanglish';
export type DialectTargetLanguage = 'english' | 'singlish' | 'tanglish';
export type DialectTargetTone = 'professional' | 'casual';
export type DialectDetectedLanguage = 'english' | 'singlish' | 'tanglish' | 'mixed';
export type DialectDetectedTone = 'professional' | 'casual' | 'neutral';

export interface RefineResult {
  refinedText: string;
}

export interface DialectSuggestionResult {
  detectedLanguage: DialectDetectedLanguage;
  detectedTone: DialectDetectedTone;
  confidence: number;
  suggestedTargetLanguages: DialectTargetLanguage[];
  suggestedTones: DialectTargetTone[];
  reason?: string;
}

/**
 * Send raw text to the `/dialect/refine` endpoint.
 * Returns the text rewritten in the requested style.
 *
 * @param text    Raw message text (max 2 000 chars).
 * @param mode    Target style.
 * @param signal  Optional AbortSignal — pass a controller.signal to cancel
 *                the request when the user switches mode or closes the modal.
 */
export async function refineText(
  text: string,
  mode: RefineMode,
  signal?: AbortSignal,
): Promise<RefineResult> {
  const { data } = await apiClient.post<RefineResult>(
    '/dialect/refine',
    { text, mode },
    { signal, timeout: 30_000 },
  );
  return data;
}

/**
 * Detect source language and tone, then return ranked target suggestions for
 * AI Magic refinement.
 */
export async function suggestDialectOptions(
  text: string,
  signal?: AbortSignal,
): Promise<DialectSuggestionResult> {
  const { data } = await apiClient.post<DialectSuggestionResult>(
    '/dialect/suggest',
    { text },
    { signal, timeout: 15_000 },
  );
  return data;
}

/**
 * Refine text with explicit target language and tone.
 */
export async function refineTextV2(
  text: string,
  targetLanguage: DialectTargetLanguage,
  targetTone: DialectTargetTone,
  signal?: AbortSignal,
): Promise<RefineResult> {
  const { data } = await apiClient.post<RefineResult>(
    '/dialect/refine-v2',
    { text, targetLanguage, targetTone },
    { signal, timeout: 30_000 },
  );
  return data;
}

export default apiClient;

// ── Media Upload ─────────────────────────────────────────────────────────────

/**
 * Upload any file (image, PDF, document) to the server via `POST /media/upload`.
 * Returns the public URL for the uploaded file.
 */
export async function uploadMedia(
  fileUri: string,
  mimeType: string,
): Promise<{ url: string }> {
  return uploadMultipartFile(
    '/media/upload',
    fileUri,
    mimeType,
    'file',
  );
}

class MultipartHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MultipartHttpError';
  }
}

type MultipartResponse = {
  status: number;
  bodyText: string;
};

async function uploadMultipartFile(
  endpoint: string,
  fileUri: string,
  mimeType: string,
  fallbackFileName: string,
): Promise<{ url: string }> {
  const normalizedUri = normalizeUploadFileUri(fileUri);
  const fileName = getUploadFileName(normalizedUri, fallbackFileName);
  const uploadUrl = resolveApiUrl(endpoint);
  const token = await getAuthTokenForUpload();
  const hasBlobUtil = supportsBlobUtilMultipart();

  const attempts: {
    label: string;
    run: () => Promise<MultipartResponse>;
  }[] = [
    {
      label: 'fetch-formdata',
      run: () => uploadMultipartViaFetch(uploadUrl, token, normalizedUri, fileName, mimeType),
    },
  ];

  const localPath = toBlobUtilLocalPath(normalizedUri);
  if (hasBlobUtil && localPath) {
    attempts.push({
      label: 'blobutil-file-path',
      run: () =>
        uploadMultipartViaBlobUtilPath(uploadUrl, token, localPath, fileName, mimeType),
    });
  }

  if (hasBlobUtil) {
    attempts.push({
      label: 'blobutil-base64',
      run: () =>
        uploadMultipartViaBlobUtilBase64(uploadUrl, token, normalizedUri, fileName, mimeType),
    });
  }

  const networkFailures: string[] = [];

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];

    try {
      const result = await attempt.run();
      const parsed = parseJsonSafely(result.bodyText);

      if (result.status < 200 || result.status >= 300) {
        const message =
          extractApiMessage(parsed) ??
          `Upload failed with status ${result.status}.`;
        if (result.status === 401 && token) {
          await handleMultipartUnauthorized();
        }
        throw new MultipartHttpError(result.status, message);
      }

      const url = extractUploadUrl(parsed);
      if (!url) {
        throw new Error('Upload succeeded but response did not include a URL.');
      }

      return { url };
    } catch (error) {
      if (error instanceof MultipartHttpError) {
        throw toApiStyleError(error.status, error.message);
      }

      networkFailures.push(`${attempt.label}: ${toErrorMessage(error)}`);

      if (i < attempts.length - 1) {
        await delay(MULTIPART_UPLOAD_RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(
    `Upload network failure after ${attempts.length} attempts. ${networkFailures.join(' | ')}`,
  );
}

async function uploadMultipartViaFetch(
  uploadUrl: string,
  token: string | null,
  fileUri: string,
  fileName: string,
  mimeType: string,
): Promise<MultipartResponse> {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as unknown as Blob);

  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MULTIPART_UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });

    const bodyText = await response.text();
    return {
      status: response.status,
      bodyText,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function uploadMultipartViaBlobUtilPath(
  uploadUrl: string,
  token: string | null,
  localPath: string,
  fileName: string,
  mimeType: string,
): Promise<MultipartResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'multipart/form-data',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await ReactNativeBlobUtil.config({
    timeout: MULTIPART_UPLOAD_TIMEOUT_MS,
  }).fetch('POST', uploadUrl, headers, [
    {
      name: 'file',
      filename: fileName,
      type: mimeType,
      data: ReactNativeBlobUtil.wrap(localPath),
    },
  ]);

  const bodyText = await Promise.resolve(response.text());
  return {
    status: response.info().status,
    bodyText,
  };
}

async function uploadMultipartViaBlobUtilBase64(
  uploadUrl: string,
  token: string | null,
  fileUri: string,
  fileName: string,
  mimeType: string,
): Promise<MultipartResponse> {
  const file = new ExpoFile(fileUri);
  const base64 = await file.base64();
  if (!base64 || base64.length < 8) {
    throw new Error('Selected file is empty or unreadable.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'multipart/form-data',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await ReactNativeBlobUtil.config({
    timeout: MULTIPART_UPLOAD_TIMEOUT_MS,
  }).fetch('POST', uploadUrl, headers, [
    {
      name: 'file',
      filename: fileName,
      type: mimeType,
      data: base64,
    },
  ]);

  const bodyText = await Promise.resolve(response.text());
  return {
    status: response.info().status,
    bodyText,
  };
}

async function getAuthTokenForUpload(): Promise<string | null> {
  return _memoryToken ?? (await getSecureItem(TOKEN_KEY));
}

async function handleMultipartUnauthorized(): Promise<void> {
  if (_isHandlingUnauthorized) return;

  _isHandlingUnauthorized = true;
  try {
    await removeAuthToken();
    await _onUnauthorized?.();
  } finally {
    _isHandlingUnauthorized = false;
  }
}

function resolveApiUrl(endpoint: string): string {
  const base = API_BASE_URL.replace(/\/+$/, '');
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}

function parseJsonSafely(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractApiMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim().length > 0) {
    return message;
  }

  if (Array.isArray(message)) {
    const lines = message.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    );
    if (lines.length > 0) {
      return lines.join('\n');
    }
  }

  return null;
}

function extractUploadUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const url = (payload as { url?: unknown }).url;
  if (typeof url === 'string' && url.trim().length > 0) {
    return url;
  }
  return null;
}

function toApiStyleError(status: number, message: string): Error & {
  response: {
    status: number;
    data: {
      message: string;
    };
  };
} {
  const error = new Error(message) as Error & {
    response: {
      status: number;
      data: {
        message: string;
      };
    };
  };

  error.response = {
    status,
    data: {
      message,
    },
  };

  return error;
}

function toBlobUtilLocalPath(uri: string): string | null {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.replace(/^file:\/\//, ''));
  }
  if (uri.startsWith('/')) {
    return decodeURIComponent(uri);
  }
  return null;
}

function supportsBlobUtilMultipart(): boolean {
  const maybeBlobUtil = ReactNativeBlobUtil as {
    fetch?: unknown;
    config?: unknown;
    wrap?: unknown;
  };

  return (
    typeof maybeBlobUtil.fetch === 'function' &&
    typeof maybeBlobUtil.config === 'function' &&
    typeof maybeBlobUtil.wrap === 'function'
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeUploadFileUri(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return trimmed;

  if (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('content://') ||
    trimmed.startsWith('ph://') ||
    trimmed.startsWith('assets-library://')
  ) {
    return trimmed;
  }

  // Some Android/native libraries return absolute local paths without scheme.
  if (trimmed.startsWith('/')) {
    return `file://${trimmed}`;
  }

  return trimmed;
}

function getUploadFileName(uri: string, fallback: string): string {
  const withoutQuery = uri.split('?')[0] ?? uri;
  const candidate = withoutQuery.split('/').pop();
  if (candidate && candidate.trim().length > 0) {
    return candidate;
  }
  return fallback;
}

// ── Document AI ──────────────────────────────────────────────────────────────

export interface SummaryBullet {
  text: string;
  page: number | null;
}

export interface DocumentSummaryResponse {
  bullets: SummaryBullet[];
}

export interface QACitation {
  page: number;
  excerpt: string;
}

export interface DocumentQAResponse {
  answer: string;
  citations: QACitation[];
}

export interface QAChatTurn {
  role: 'user' | 'ai';
  text: string;
}

/**
 * Fetch the 3-bullet AI summary for a document message.
 * Results are server-cached after the first call.
 */
export async function fetchDocumentSummary(
  messageId: string,
): Promise<DocumentSummaryResponse> {
  const { data } = await apiClient.get<DocumentSummaryResponse>(
    `/document-ai/${messageId}/summary`,
  );
  return data;
}

/**
 * Fetch CSV content for a spreadsheet message. Only available for .xlsx/.xls files.
 * Returns the full CSV text and sheet names for tab navigation.
 */
export interface SpreadsheetCsvResponse {
  csv: string;
  sheetNames: string[];
}

export async function fetchSpreadsheetCsv(
  messageId: string,
): Promise<SpreadsheetCsvResponse> {
  const { data } = await apiClient.get<SpreadsheetCsvResponse>(
    `/document-ai/${messageId}/csv`,
  );
  return data;
}

/**
 * Ask a question about a document. The backend sends the full file to Gemini
 * alongside the chat history. Returns an answer with page-level citations.
 */
export async function askDocumentQuestion(
  messageId: string,
  userQuestion: string,
  chatHistory: QAChatTurn[],
  preferredLanguage?: 'english' | 'singlish' | 'tanglish',
): Promise<DocumentQAResponse> {
  const { data } = await apiClient.post<DocumentQAResponse>(
    `/document-ai/${messageId}/qa`,
    {
      userQuestion,
      chatHistory,
      ...(preferredLanguage ? { preferredLanguage } : {}),
    },
  );
  return data;
}

// ── Push Notifications ───────────────────────────────────────────────────────

/**
 * Register or update the current device's Expo push token on the server.
 * Called after requesting notification permissions on the mobile client.
 */
export async function registerPushToken(token: string): Promise<void> {
  await apiClient.put('/notifications/token', { token });
}

/**
 * Clear the current device's push token on the server.
 * Called on logout to stop receiving notifications.
 */
export async function unregisterPushToken(): Promise<void> {
  await apiClient.delete('/notifications/token');
}
