import axios from 'axios';

import {
  getSecureItem,
  setSecureItem,
  deleteSecureItem,
} from '../utils/secureStorage';

// ── Config ───────────────────────────────────────────────────────────────────
// Change this to your local IP (or production URL) before running the app.
export const API_BASE_URL = 'http://192.168.8.114:3000';

const TOKEN_KEY = 'jwt_token';

// In-memory copy so requests made immediately after login never race
// against SecureStore finishing its async write.
let _memoryToken: string | null = null;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor ──────────────────────────────────────────────────────
apiClient.interceptors.request.use(
  async (config) => {
    const token = _memoryToken ?? (await getSecureItem(TOKEN_KEY));
    if (token) config.headers.Authorization = 'Bearer ' + token;
    return config;
  },
  (error) => Promise.reject(error),
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
  const formData = new FormData();
  const fileName = fileUri.split('/').pop() ?? 'profile.jpg';
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as unknown as Blob);

  const { data } = await apiClient.post<{ url: string }>(
    '/users/me/profile-picture',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
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
}

export async function retranslateMessage(messageId: string): Promise<TranslationResult> {
  const { data } = await apiClient.post<TranslationResult>(
    `/chat/messages/${messageId}/retranslate`,
  );
  return data;
}

// ── Audio ─────────────────────────────────────────────────────────────────────

export interface AudioProcessResult {
  success: true;
  messageId: string;
  transcription: string | null;
  translations: {
    english: string;
    singlish: string;
    tanglish: string;
  } | null;
  confidenceScore: number;
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
): Promise<AudioProcessResult> {
  const { data } = await apiClient.post<AudioProcessResult>('/audio/process', {
    groupId,
    audioBase64,
    audioMimeType,
  });
  return data;
}

// ── Dialect / Magic Refine ───────────────────────────────────────────────────────────────

export type RefineMode = 'professional' | 'singlish' | 'tanglish';

export interface RefineResult {
  refinedText: string;
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
  const formData = new FormData();
  const fileName = fileUri.split('/').pop() ?? 'file';
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as unknown as Blob);

  const { data } = await apiClient.post<{ url: string }>(
    '/media/upload',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
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
 * Ask a question about a document. The backend sends the full file to Gemini
 * alongside the chat history. Returns an answer with page-level citations.
 */
export async function askDocumentQuestion(
  messageId: string,
  userQuestion: string,
  chatHistory: QAChatTurn[],
): Promise<DocumentQAResponse> {
  const { data } = await apiClient.post<DocumentQAResponse>(
    `/document-ai/${messageId}/qa`,
    { userQuestion, chatHistory },
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
