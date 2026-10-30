/**
 * Safe, VERIFIED copies of captured photos into the app's durable storage.
 *
 * Why this exists (field incident, 2026-10-30): a burst of ~20 Insta360 captures taken offline produced queue copies
 * that were 2% to 105% LARGER than the camera original, and the server then (correctly) could not stitch them.
 * Cause: the background writer for a photo and the memory-pressure "spill" path could both write the SAME file at the
 * same time. The writer appends base64 chunks, so two writers interleave and duplicate chunks.
 *
 * Rules enforced here:
 *   1. ONE writer per photo at a time (SingleFlight).
 *   2. A copy is only ever reported good after its size on disk equals the source size.
 *   3. Prefer a native file copy from the camera download (no base64, no memory, atomic) over JS chunk writes.
 *   4. A damaged copy can be healed from the intact camera original instead of being thrown away.
 *
 * The functions take the filesystem as a parameter so they can be tested without a device.
 */

export interface FsLike {
  writeFile(o: { path: string; data: string; directory: string; recursive?: boolean }): Promise<unknown>;
  appendFile(o: { path: string; data: string; directory: string }): Promise<unknown>;
  stat(o: { path: string; directory: string }): Promise<{ size: number }>;
  copy(o: { from: string; to: string; directory: string; toDirectory: string }): Promise<unknown>;
  deleteFile(o: { path: string; directory: string }): Promise<unknown>;
  mkdir(o: { path: string; directory: string; recursive?: boolean }): Promise<unknown>;
}

/** Runs at most one task per key; callers that arrive while one is running share its result. */
export class SingleFlight {
  private running = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.running.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise: Promise<T> = task().finally(() => {
      if (this.running.get(key) === promise) this.running.delete(key);
    });
    this.running.set(key, promise);
    return promise;
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }
}

export interface WriteCopyOptions {
  file: { size: number; slice(start: number, end: number): Blob };
  /** Destination under `dir`, e.g. "pending-uploads/123_1_IMG.insp". */
  path: string;
  dir: string;
  /** Parent folder of `path`, created if missing. */
  folder: string;
  /** Name of the intact camera download in `cacheDir`, if the photo came from the camera. */
  cacheName?: string;
  cacheDir?: string;
  chunkBytes: number;
  toBase64(blob: Blob): Promise<string>;
  cancelled(): boolean;
  /** Called between chunks so the UI can breathe. */
  yieldFn?(): Promise<void>;
}

export interface WriteCopyResult {
  ok: boolean;
  via: 'native-copy' | 'chunks' | 'none';
  cancelled?: boolean;
}

async function sizeOf(fs: FsLike, path: string, directory: string): Promise<number | null> {
  try {
    return (await fs.stat({ path, directory })).size;
  } catch {
    return null;
  }
}

async function removeQuietly(fs: FsLike, path: string, directory: string): Promise<void> {
  try {
    await fs.deleteFile({ path, directory });
  } catch {
    /* nothing to delete */
  }
}

/** Native copy from the camera download when it exists and has exactly the expected size. */
async function copyFromCache(fs: FsLike, o: { cacheName: string; cacheDir: string; path: string; dir: string; expected: number }): Promise<boolean> {
  const original = await sizeOf(fs, o.cacheName, o.cacheDir);
  if (original !== o.expected) return false;
  await removeQuietly(fs, o.path, o.dir);
  try {
    await fs.copy({ from: o.cacheName, directory: o.cacheDir, to: o.path, toDirectory: o.dir });
  } catch {
    await removeQuietly(fs, o.path, o.dir);
    return false;
  }
  if ((await sizeOf(fs, o.path, o.dir)) === o.expected) return true;
  await removeQuietly(fs, o.path, o.dir);
  return false;
}

/**
 * Writes `file` to `path` and only returns ok when the result is byte-count exact. On any failure the partial
 * destination file is removed (the caller still holds the photo in memory or in the camera download).
 */
export async function writeVerifiedCopy(fs: FsLike, o: WriteCopyOptions): Promise<WriteCopyResult> {
  try {
    await fs.mkdir({ path: o.folder, directory: o.dir, recursive: true });
  } catch {
    /* folder already exists */
  }

  if (o.cacheName && o.cacheDir) {
    if (await copyFromCache(fs, { cacheName: o.cacheName, cacheDir: o.cacheDir, path: o.path, dir: o.dir, expected: o.file.size })) {
      return { ok: true, via: 'native-copy' };
    }
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    let offset = 0;
    let first = true;
    while (offset < o.file.size) {
      if (o.cancelled()) {
        await removeQuietly(fs, o.path, o.dir);
        return { ok: false, via: 'none', cancelled: true };
      }
      const end = Math.min(offset + o.chunkBytes, o.file.size);
      const data = await o.toBase64(o.file.slice(offset, end));
      if (first) {
        await fs.writeFile({ path: o.path, data, directory: o.dir, recursive: true });
        first = false;
      } else {
        await fs.appendFile({ path: o.path, data, directory: o.dir });
      }
      offset = end;
      if (o.yieldFn) await o.yieldFn();
    }
    if (o.cancelled()) {
      await removeQuietly(fs, o.path, o.dir);
      return { ok: false, via: 'none', cancelled: true };
    }
    if ((await sizeOf(fs, o.path, o.dir)) === o.file.size) return { ok: true, via: 'chunks' };
    await removeQuietly(fs, o.path, o.dir); // wrong size: start over once with a clean file
  }
  return { ok: false, via: 'none' };
}

export type HealOutcome = 'ok' | 'repaired' | 'unverifiable' | 'damaged';

export interface HealOptions {
  path: string;
  dir: string;
  cacheName?: string;
  cacheDir?: string;
  /** Known size of the original, if recorded when the photo was queued. */
  expectedBytes?: number;
}

export interface HealResult {
  outcome: HealOutcome;
  expectedBytes?: number;
}

/**
 * Checks a stored copy against what it should be and repairs it from the camera original when it is wrong.
 *  ok           the copy has exactly the expected size
 *  repaired     the copy was wrong/missing and was replaced from the intact camera original
 *  unverifiable nothing to compare against (no recorded size, no camera original)
 *  damaged      the copy is wrong/missing and cannot be repaired
 */
export async function healCopy(fs: FsLike, o: HealOptions): Promise<HealResult> {
  const disk = await sizeOf(fs, o.path, o.dir);
  const original = o.cacheName && o.cacheDir ? await sizeOf(fs, o.cacheName, o.cacheDir) : null;
  const expected = o.expectedBytes ?? original ?? undefined;
  if (expected === undefined) return { outcome: disk === null ? 'damaged' : 'unverifiable' };
  if (disk === expected) return { outcome: 'ok', expectedBytes: expected };
  if (original === expected && o.cacheName && o.cacheDir) {
    if (await copyFromCache(fs, { cacheName: o.cacheName, cacheDir: o.cacheDir, path: o.path, dir: o.dir, expected })) {
      return { outcome: 'repaired', expectedBytes: expected };
    }
  }
  return { outcome: 'damaged', expectedBytes: expected };
}

/** The moment a photo was actually taken: the queued time if we have it, else now. Never the upload time. */
export function resolveCapturedAt(capturedAtMs: number | undefined, now: Date = new Date()): string {
  if (typeof capturedAtMs === 'number' && Number.isFinite(capturedAtMs) && capturedAtMs > 0) {
    return new Date(capturedAtMs).toISOString();
  }
  return now.toISOString();
}
