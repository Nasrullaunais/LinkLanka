import { Directory, File, Paths } from 'expo-file-system';

import { API_BASE_URL } from './api';

type MediaCacheKind = 'audio' | 'image' | 'document';

interface CachedFileEntry {
  file: File;
  modifiedAt: number;
  size: number;
}

let cacheRoot: Directory | null = null;
let cacheDirs: Record<MediaCacheKind, Directory> | null = null;

const FALLBACK_EXT: Record<MediaCacheKind, string> = {
  audio: '.m4a',
  image: '.jpg',
  document: '.pdf',
};

const MAX_CACHE_FILE_COUNT = 300;
const MAX_CACHE_TOTAL_BYTES = 220 * 1024 * 1024;

const inflightByKey = new Map<string, Promise<string>>();
let cleanupScheduled = false;

function getOrCreateCacheDirs(): Record<MediaCacheKind, Directory> | null {
  if (cacheDirs) {
    return cacheDirs;
  }

  try {
    const baseDirectory = Paths.cache ?? Paths.document;
    if (!baseDirectory) {
      return null;
    }

    cacheRoot = new Directory(baseDirectory, 'linklanka-media-cache');
    cacheDirs = {
      audio: new Directory(cacheRoot, 'audio'),
      image: new Directory(cacheRoot, 'image'),
      document: new Directory(cacheRoot, 'document'),
    };

    return cacheDirs;
  } catch {
    cacheRoot = null;
    cacheDirs = null;
    return null;
  }
}

function normalizeRemoteUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('file://')) return url;

  // Keep third-party origins (e.g. S3 presigned URLs) intact.
  // Only rewrite localhost-style origins so physical devices can reach media.
  return url.replace(
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i,
    API_BASE_URL.replace(/\/$/, ''),
  );
}

function getPathWithoutQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname || '/');
  } catch {
    return decodeURIComponent(url.split('?')[0].split('#')[0] || '/');
  }
}

function getStableRemoteKey(url: string): string {
  const normalized = normalizeRemoteUrl(url);
  try {
    const parsed = new URL(normalized);
    return `${parsed.host}${decodeURIComponent(parsed.pathname || '/')}`;
  } catch {
    return normalized.split('?')[0].split('#')[0];
  }
}

function hashStable(input: string): string {
  // FNV-1a 32-bit hash.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function getExtensionFromUrl(url: string, kind: MediaCacheKind): string {
  const path = getPathWithoutQuery(url);
  const extMatch = path.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (!extMatch) {
    return FALLBACK_EXT[kind];
  }

  const ext = `.${extMatch[1].toLowerCase()}`;
  return ext.length > 1 ? ext : FALLBACK_EXT[kind];
}

function ensureCacheDirectories(): boolean {
  const dirs = getOrCreateCacheDirs();
  if (!dirs || !cacheRoot) {
    return false;
  }

  try {
    cacheRoot.create({ idempotent: true, intermediates: true });
    dirs.audio.create({ idempotent: true, intermediates: true });
    dirs.image.create({ idempotent: true, intermediates: true });
    dirs.document.create({ idempotent: true, intermediates: true });
    return true;
  } catch {
    return false;
  }
}

function collectCacheFiles(): CachedFileEntry[] {
  const dirs = getOrCreateCacheDirs();
  if (!dirs) {
    return [];
  }

  const entries: CachedFileEntry[] = [];

  const directories = Object.values(dirs);
  for (const dir of directories) {
    if (!dir.exists) continue;

    const children = dir.list();
    for (const child of children) {
      if (!(child instanceof File)) continue;
      if (!child.exists) continue;

      const info = child.info();
      if (!info.exists) continue;

      entries.push({
        file: child,
        modifiedAt: info.modificationTime ?? 0,
        size: info.size ?? 0,
      });
    }
  }

  return entries;
}

function enforceCacheLimits(): void {
  if (!ensureCacheDirectories()) {
    return;
  }

  const files = collectCacheFiles();
  if (files.length === 0) return;

  let remainingCount = files.length;
  let totalBytes = files.reduce((sum, item) => sum + item.size, 0);
  if (
    remainingCount <= MAX_CACHE_FILE_COUNT &&
    totalBytes <= MAX_CACHE_TOTAL_BYTES
  ) {
    return;
  }

  files.sort((a, b) => a.modifiedAt - b.modifiedAt);

  for (const item of files) {
    if (
      remainingCount <= MAX_CACHE_FILE_COUNT &&
      totalBytes <= MAX_CACHE_TOTAL_BYTES
    ) {
      break;
    }

    try {
      item.file.delete();
      remainingCount -= 1;
      totalBytes -= item.size;
    } catch {
      // Ignore cleanup failures; cache remains best-effort.
    }
  }
}

function scheduleCacheCleanup(): void {
  if (cleanupScheduled) return;
  cleanupScheduled = true;

  setTimeout(() => {
    try {
      enforceCacheLimits();
    } finally {
      cleanupScheduled = false;
    }
  }, 250);
}

export function getStableMediaCacheKey(url: string): string {
  const key = getStableRemoteKey(url);
  return hashStable(key);
}

export async function getCachedMediaUri(
  remoteUrl: string,
  kind: MediaCacheKind,
): Promise<string> {
  if (!remoteUrl || remoteUrl.startsWith('file://')) {
    return remoteUrl;
  }

  if (!/^https?:\/\//i.test(remoteUrl)) {
    return remoteUrl;
  }

  const normalizedUrl = normalizeRemoteUrl(remoteUrl);
  const stableKey = getStableRemoteKey(normalizedUrl);
  const cacheId = hashStable(stableKey);

  const existingInflight = inflightByKey.get(cacheId);
  if (existingInflight) {
    return existingInflight;
  }

  const task = (async (): Promise<string> => {
    try {
      if (!ensureCacheDirectories()) {
        return normalizedUrl;
      }

      const dirs = getOrCreateCacheDirs();
      if (!dirs) {
        return normalizedUrl;
      }

      const ext = getExtensionFromUrl(normalizedUrl, kind);
      const cacheFile = new File(dirs[kind], `${cacheId}${ext}`);

      if (cacheFile.exists) {
        const info = cacheFile.info();
        if (info.exists && (info.size ?? 0) > 0) {
          return cacheFile.uri;
        }

        try {
          cacheFile.delete();
        } catch {
          // Ignore invalid stale cache entry; re-download below.
        }
      }

      const downloaded = await File.downloadFileAsync(
        normalizedUrl,
        cacheFile,
        { idempotent: true },
      );

      scheduleCacheCleanup();
      return downloaded.uri;
    } catch {
      return normalizedUrl;
    }
  })();

  inflightByKey.set(cacheId, task);

  try {
    return await task;
  } finally {
    inflightByKey.delete(cacheId);
  }
}
