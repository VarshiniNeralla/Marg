/**
 * Offline site pack, storage part: floor plan files saved on the phone.
 *
 * Files are fetched by the native layer straight to app storage (Filesystem.downloadFile), so nothing big passes
 * through the JavaScript heap. The list of what is saved lives in localStorage so it can be read instantly (the image
 * address lookup is synchronous). Android app only; in a browser the pack reports "not supported".
 *
 * Importing this module registers the "use the saved copy first" lookup, so every page that shows a floor plan picks
 * the local copy automatically and falls back to the network only when there is none.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { resolveMediaUrlRemote, setOfflineMediaResolver } from '@/config/env';
import { looksLikePlanFile, mediaKey, orphanKeys, savedFileName, shortHash } from './offlinePack';

const MANIFEST_KEY = 'sitesurelabs-offline-plans-v1';
const DIR = 'offline-plans';
export const OFFLINE_PACK_CHANGED_EVENT = 'workflow:offline-pack-changed';

interface SavedFile {
  /** Native file address (file://...). */
  uri: string;
  path: string;
  bytes: number;
  savedAt: number;
}

function readManifest(): Record<string, SavedFile> {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, SavedFile>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let manifest: Record<string, SavedFile> = typeof window === 'undefined' ? {} : readManifest();

function commit(next: Record<string, SavedFile>): void {
  manifest = next;
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  } catch {
    /* best effort */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OFFLINE_PACK_CHANGED_EVENT));
}

export function offlinePackSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export function getSavedKeys(): Set<string> {
  return new Set(Object.keys(manifest));
}

export function savedBytes(): number {
  return Object.values(manifest).reduce((n, f) => n + (f.bytes || 0), 0);
}

// "Local first": the one lookup every floor plan address goes through.
if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
  setOfflineMediaResolver(url => {
    const key = mediaKey(url);
    const saved = key ? manifest[key] : undefined;
    return saved ? Capacitor.convertFileSrc(saved.uri) : null;
  });
}

export interface DownloadResult {
  saved: string[];
  failed: { key: string; reason: string }[];
}

async function headLooksValid(path: string): Promise<boolean> {
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data, offset: 0, length: 16 });
    const bin = atob(typeof data === 'string' ? data : '');
    const head = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) head[i] = bin.charCodeAt(i);
    return looksLikePlanFile(head);
  } catch {
    return false;
  }
}

async function downloadOne(key: string): Promise<{ ok: true; file: SavedFile } | { ok: false; reason: string }> {
  const url = resolveMediaUrlRemote(key);
  if (!url) return { ok: false, reason: 'No address for this plan.' };
  const path = `${DIR}/${savedFileName(key, shortHash(key))}`;
  try {
    // The native download does not create the folder itself (it failed with ENOENT on a fresh install).
    await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(() => {});
    await Filesystem.downloadFile({ url, path, directory: Directory.Data, recursive: true });
    const stat = await Filesystem.stat({ path, directory: Directory.Data });
    if (!stat.size) throw new Error('empty file');
    // A server error page saved as "the plan" would be worse than no copy at all.
    if (!(await headLooksValid(path))) throw new Error('not a valid plan file');
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    return { ok: true, file: { uri, path, bytes: stat.size, savedAt: Date.now() } };
  } catch (e) {
    await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
    return { ok: false, reason: e instanceof Error ? e.message : 'Download failed' };
  }
}

/** Save these plan files on the phone, one at a time. A failure on one never loses the others. */
export async function downloadPlanFiles(keys: string[], onProgress?: (done: number, total: number) => void): Promise<DownloadResult> {
  const result: DownloadResult = { saved: [], failed: [] };
  if (!offlinePackSupported()) {
    return { saved: [], failed: keys.map(key => ({ key, reason: 'Offline plans work in the Android app only.' })) };
  }
  let done = 0;
  for (const key of keys) {
    const r = await downloadOne(key);
    if (r.ok) {
      commit({ ...manifest, [key]: r.file });
      result.saved.push(key);
    } else {
      result.failed.push({ key, reason: r.reason });
    }
    onProgress?.(++done, keys.length);
  }
  return result;
}

/** Delete saved files no current plan needs (the plan was replaced), so a changed plan never keeps its old copy. */
export async function cleanupOrphanFiles(currentlyNeeded: ReadonlySet<string>): Promise<number> {
  const drop = orphanKeys(Object.keys(manifest), currentlyNeeded);
  if (!drop.length) return 0;
  const next = { ...manifest };
  for (const key of drop) {
    await Filesystem.deleteFile({ path: manifest[key].path, directory: Directory.Data }).catch(() => {});
    delete next[key];
  }
  commit(next);
  return drop.length;
}

/** Forget a saved file whose copy has gone missing from disk (cache cleared), so the app falls back to the network. */
export async function verifySavedFiles(): Promise<number> {
  let removed = 0;
  const next = { ...manifest };
  for (const [key, f] of Object.entries(manifest)) {
    try {
      const s = await Filesystem.stat({ path: f.path, directory: Directory.Data });
      if (!s.size) throw new Error('empty');
    } catch {
      delete next[key];
      removed++;
    }
  }
  if (removed) commit(next);
  return removed;
}
