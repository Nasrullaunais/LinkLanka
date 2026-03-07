/**
 * Shared upload validation constants.
 *
 * Two profiles are defined:
 *  - MEDIA_UPLOAD  → general chat attachments (images, audio, documents)
 *  - PROFILE_PICTURE_UPLOAD → avatar images only
 *
 * Each profile specifies an allowed MIME-type set and a max file-size in bytes.
 */

// ── Allowed MIME types ───────────────────────────────────────────────────────

export const ALLOWED_MEDIA_MIMES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // Audio
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
  'audio/wav',
  'audio/m4a',
  // Documents
  'application/pdf',
]);

export const ALLOWED_PROFILE_PICTURE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// ── Size limits ──────────────────────────────────────────────────────────────

/** 10 MB for general media uploads. */
export const MAX_MEDIA_FILE_SIZE = 10 * 1024 * 1024;

/** 5 MB for profile pictures. */
export const MAX_PROFILE_PICTURE_SIZE = 5 * 1024 * 1024;

// ── Safe MIME → extension mapping ────────────────────────────────────────────
// Used to derive the saved file extension from the validated MIME type
// instead of trusting file.originalname.

export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
};
