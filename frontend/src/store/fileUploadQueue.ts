/**
 * Durable offline file-upload queue (Phase 1 of the mobile-app effort).
 *
 * `writeQueue.ts` already makes PIN/CAPTURE METADATA durable — a pin placed
 * offline survives a reload and replays once the backend is reachable. This
 * queue makes the photo BYTES durable too, without OOMing the WebView.
 *
 * Critical design (learned the hard way on-device with ~12MB Insta360 .insp):
 *   • Enqueue is MEMORY-FIRST: register the pin + keep the File in RAM, then
 *     kick `flush()` immediately so `/uploads/captures` can start. A prior
 *     "await full-file base64 → Filesystem.writeFile before any POST" path
 *     held ~16MB strings × N captures on the JS heap, ANR'd / OOM-killed the
 *     app (logs: OPTIONS /uploads/captures, multi-minute gap, process restart,
 *     almost no POST bodies).
 *   • Disk durability runs in the BACKGROUND, one file at a time, via chunked
 *     base64 appends that yield to the event loop — so a camera-WiFi hang or
 *     app kill still has a recoverable copy once the write finishes, without
 *     blocking upload or the UI.
 *   • At most one multipart upload runs at a time (serial pin flush). Concurrent
 *     12MB POSTs plus base64 copies were a second OOM vector.
 *   • `memoryFiles` caps how many live File handles we keep; older ones are
 *     spilled to disk before accepting more.
 *
 * On web (no Capacitor native layer), Filesystem/Preferences fall back to
 * their web implementations (IndexedDB-backed), so this module works
 * unchanged in the browser dev flow — it isn't Android-only.
 */
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { useAuthStore } from './authStore';
import { useWorkflowStore } from './workflowStore';
import { uploadCaptureFiles, getCaptureStitchJob, retryCaptureStitchJob, type UploadedFileResponse } from '@/services/uploadService';
import { captureAwaitingPanorama, captureStitchJobId } from '@/utils/captureMedia';
import { setPendingUploadPins, removePendingUploadPin, addPendingUploadPin } from './pendingUploadRegistry';
import { isTombstoned } from './tombstones';

const QUEUE_KEY = 'sitesurelabs-file-upload-queue-v1';
const FILE_DIR = 'pending-uploads';
const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const POLL_MS = 20_000;
// While a stitch is running server-side we poll far more often than POLL_MS: a
// stitch takes ~25s, so a 20s cadence would routinely add most of another cycle
// of dead waiting after the panorama was already finished.
const STITCH_POLL_MS = 4_000;
/** Max live File handles in RAM. Beyond this, enqueue spills the oldest to disk
 *  before accepting another ~12MB capture — otherwise 11 captures ≈ 130MB+ and
 *  the Android WebView is OOM-killed. */
const MAX_MEMORY_FILES = 2;
/** Binary chunk size for durable writes. Keeps each base64 string ~340KB so we
 *  never allocate one giant 16MB+ string on the JS heap. */
const DISK_CHUNK_BYTES = 256 * 1024;
/** Attach/upload aborted because the pin was intentionally deleted. Not a
 *  network failure — must discard the queue entry, never retry/repost. */
const PIN_DELETED_STATUS = 410;

/** Emitted whenever a queued upload's status changes, so the UI can reflect
 *  'queued' | 'uploading' | 'failed' without polling the queue directly. */
export const FILE_QUEUE_CHANGED_EVENT = 'workflow:file-queue-changed';
/** Emitted once a queued file finishes uploading and attaching to its pin —
 *  may fire long after the page that queued it (re)mounted, e.g. after an
 *  app restart, so listeners must not assume they're still on the same
 *  component instance that called enqueueFileUpload. */
export const FILE_UPLOAD_SUCCEEDED_EVENT = 'workflow:file-upload-succeeded';
/** Same toast channel writeQueue.ts uses, so both surfaces share one UI. */
export const SYNC_ERROR_EVENT = 'workflow:sync-error';

export type FileUploadStatus = 'queued' | 'uploading' | 'processing' | 'failed';
/** Why a queue entry is stuck in 'failed' — drives Retry vs Capture Again vs Studio JPEG. */
export type FileUploadFailKind = 'corrupt' | 'upload' | 'stitch';

export interface PendingFileUpload {
  id: string;              // `fq${Date.now()}_${seq++}`
  pinId: string;
  /** Path under Directory.Data/pending-uploads. Set as soon as the durable
   *  write starts (before chunks finish) so a mid-write kill does not drop
   *  the queue row on cold start. Prefer `bytesReady` before reading. */
  fileUri: string;
  /**
   * false while chunked disk write is in progress; true once the full file is
   * on disk. Undefined = legacy entry written before this flag existed (treat
   * as ready when fileUri is set).
   */
  bytesReady?: boolean;
  fileName: string;          // original captured filename, for the multipart part
  mimeType: string;
  attempts: number;
  createdAt: number;
  status: FileUploadStatus;
  /**
   * Set once the server has the bytes but is still stitching (HTTP 202). The
   * entry deliberately STAYS in the queue with the on-device file intact until
   * the job completes, so a mid-stitch app kill or server restart can still be
   * recovered by re-uploading.
   */
  stitchJobId?: string;
  /**
   * Successful `/uploads/captures` response kept on the entry so a later
   * attachCaptureToPin failure (missing room / hydrate race) can retry the
   * attach WITHOUT re-POSTing the same multi-MB file (observed as endless
   * dedup-HIT spam while the pin stayed "Queued").
   */
  uploadedFiles?: UploadedFileResponse[];
  uploadedFileCount?: number;
  /** Set when status === 'failed'. */
  failKind?: FileUploadFailKind;
  /** User-facing reason shown on the pin panel. */
  errorMessage?: string;
}

// ── Persistence (Preferences instead of localStorage: idiomatic Capacitor
// native storage, and this queue guards content the app must never silently
// lose, unlike writeQueue.ts's smaller JSON descriptors) ────────────────────

let queue: PendingFileUpload[] = [];
let loaded = false;
/** Single-flight Preferences load — concurrent load() must not race and wipe enqueues. */
let loadPromise: Promise<PendingFileUpload[]> | null = null;
let seq = 0;
const inFlightPins = new Set<string>();
/**
 * Freshly-enqueued Files kept in RAM so flush can POST without a Filesystem
 * read + base64 decode. Disk is written in the background for crash recovery.
 */
const memoryFiles = new Map<string, File>();
/** AbortControllers for in-flight multipart uploads, keyed by pin id. */
const uploadAbortControllers = new Map<string, AbortController>();
/** Entry ids whose background disk write should be skipped (upload finished). */
const diskPersistCancelled = new Set<string>();
/** Serialise durable writes so we never base64-encode two 12MB files at once. */
let diskPersistChain: Promise<void> = Promise.resolve();

async function load(): Promise<PendingFileUpload[]> {
  if (loaded) return queue;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const { value } = await Preferences.get({ key: QUEUE_KEY });
      const parsed = value ? (JSON.parse(value) as PendingFileUpload[]) : [];
      queue = Array.isArray(parsed) ? parsed : [];
    } catch {
      queue = [];
    }
    // Persisted 'uploading' can never be in-flight after a cold start —
    // inFlightPins is memory-only. Without this reset, flush() skips the entry
    // forever and the capture sits on "Uploading…" with no POST ever sent again.
    let dirty = false;
    const kept: PendingFileUpload[] = [];
    const dropFiles: PendingFileUpload[] = [];
    for (const entry of queue) {
      if (entry.status === 'uploading') {
        entry.status = 'queued';
        dirty = true;
      }
      // Pin was intentionally deleted — never re-POST these bytes (the smoking
      // gun for "deleted captures stitch themselves again on next login").
      if (isTombstoned(entry.pinId)) {
        dirty = true;
        dropFiles.push(entry);
        diskPersistCancelled.add(entry.id);
        memoryFiles.delete(entry.id);
        continue;
      }
      const hasBytes =
        memoryFiles.has(entry.id) ||
        (!!entry.fileUri && entry.bytesReady !== false) ||
        !!entry.stitchJobId;
      // Incomplete disk write (path reserved, chunks never finished) and no RAM —
      // bytes are gone. Keep as 'failed' so the pin stays busy (not pruned) and
      // the user can re-capture; do not silently drop (that deleted the pin).
      if (!hasBytes) {
        if (entry.status !== 'failed') {
          entry.status = 'failed';
          entry.failKind = 'corrupt';
          entry.errorMessage = 'Capture file was lost on this device — please capture again.';
          dirty = true;
        } else if (!entry.errorMessage) {
          entry.failKind = entry.failKind ?? 'corrupt';
          entry.errorMessage = 'Capture file was lost on this device — please capture again.';
          dirty = true;
        }
        kept.push(entry);
        continue;
      }
      kept.push(entry);
    }
    queue = kept;
    loaded = true;
    syncPendingRegistry();
    if (dirty) {
      try {
        await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(queue) });
      } catch {
        /* best-effort */
      }
    }
    for (const entry of dropFiles) {
      void deleteLocalFile(entry);
    }
    return queue;
  })();
  return loadPromise;
}

/** True when this pin must never receive another upload (deleted). */
function pinUploadForbidden(pinId: string): boolean {
  return isTombstoned(pinId);
}

/** True when this queue entry's uploaded asset is already linked on the pin. */
function captureHasUsablePanorama(cap: {
  public_id?: string;
  processedPanoramaUrl?: string | null;
  processed_panorama_url?: string | null;
  original_url?: string | null;
  originalFileUrl?: string | null;
  mediaAssets?: {
    public_id?: string;
    processed_panorama_url?: string | null;
    processedPanoramaUrl?: string | null;
    original_url?: string | null;
  }[];
}): boolean {
  const first = cap.mediaAssets?.[0];
  const publicId = cap.public_id || first?.public_id;
  if (!publicId) return false;
  const url =
    first?.processed_panorama_url
    || first?.processedPanoramaUrl
    || cap.processedPanoramaUrl
    || cap.processed_panorama_url
    || first?.original_url
    || cap.original_url
    || cap.originalFileUrl;
  return !!url;
}

function entryAlreadyAttachedToPin(entry: PendingFileUpload): boolean {
  // Still stitching — never drop local bytes based on a placeholder match.
  if (entry.stitchJobId && (entry.status === 'processing' || entry.status === 'queued')) {
    const pinEarly = useWorkflowStore.getState().capturePins.find(p => p.id === entry.pinId);
    if (pinEarly?.captureIds?.length) {
      const captures = useWorkflowStore.getState().captures;
      const matched = pinEarly.captureIds.some(cid => {
        const cap = captures.find(c => c.id === cid) as
          | { stitchJobId?: string; mediaAssets?: { stitchJobId?: string }[] }
          | undefined;
        if (!cap) return false;
        const job =
          cap.stitchJobId
          || cap.mediaAssets?.[0]?.stitchJobId;
        return job === entry.stitchJobId && captureHasUsablePanorama(cap as Parameters<typeof captureHasUsablePanorama>[0]);
      });
      if (matched) return true;
    }
    return false;
  }

  const pin = useWorkflowStore.getState().capturePins.find(p => p.id === entry.pinId);
  if (!pin?.captureIds?.length) return false;
  const captures = useWorkflowStore.getState().captures;

  const publicIds = new Set(
    (entry.uploadedFiles ?? [])
      .map(f => f.public_id)
      .filter((id): id is string => !!id),
  );
  const fileName = (entry.fileName || '').trim().toLowerCase();

  for (const cid of pin.captureIds) {
    const cap = captures.find(c => c.id === cid) as
      | {
          mediaAssets?: {
            public_id?: string;
            original_filename?: string;
            originalFilename?: string;
            processed_panorama_url?: string | null;
            processedPanoramaUrl?: string | null;
            original_url?: string | null;
            stitchJobId?: string;
          }[];
          public_id?: string;
          stitchJobId?: string;
          processedPanoramaUrl?: string | null;
          processed_panorama_url?: string | null;
          original_url?: string | null;
          originalFileUrl?: string | null;
        }
      | undefined;
    if (!cap) continue;
    if (!captureHasUsablePanorama(cap)) continue;

    if (cap.public_id && publicIds.has(cap.public_id)) return true;
    for (const asset of cap.mediaAssets ?? []) {
      if (asset.public_id && publicIds.has(asset.public_id)) return true;
    }

    // Filename match only after a real panorama exists — cameras often reuse
    // names across visits; matching placeholders used to discard the queue mid-stitch.
    if (fileName) {
      for (const asset of cap.mediaAssets ?? []) {
        const assetName = (asset.original_filename || asset.originalFilename || '')
          .trim()
          .toLowerCase();
        if (assetName && assetName === fileName) return true;
      }
    }
  }
  return false;
}

/** Drop other unfinished queue rows for the same pin + filename (duplicate retries). */
async function discardSiblingDuplicates(entry: PendingFileUpload): Promise<void> {
  const siblings = queue.filter(
    e =>
      e.id !== entry.id
      && e.pinId === entry.pinId
      && e.fileName === entry.fileName
      && e.status !== 'processing',
  );
  if (!siblings.length) return;
  for (const s of siblings) {
    releaseEntryBytes(s);
    void deleteLocalFile(s);
  }
  queue = queue.filter(e => !siblings.some(s => s.id === e.id));
}

async function discardEntry(entry: PendingFileUpload): Promise<void> {
  releaseEntryBytes(entry);
  queue = queue.filter(e => e.id !== entry.id);
  if (!queue.some(e => e.pinId === entry.pinId)) {
    removePendingUploadPin(entry.pinId);
  }
  await persist();
  await deleteLocalFile(entry);
}

/** Reset orphaned 'uploading' rows that no live flush chain owns. */
function healOrphanedUploading(): boolean {
  let healed = false;
  for (const entry of queue) {
    if (entry.status === 'uploading' && !inFlightPins.has(entry.pinId)) {
      entry.status = 'queued';
      healed = true;
    }
  }
  return healed;
}

/**
 * Mirror the queue's pin ids into the shared registry the workflow store reads
 * during its snapshot merge, so a pin with unfinished bytes is never mistaken
 * for one whose capture was deleted elsewhere.
 */
function syncPendingRegistry(): void {
  setPendingUploadPins(queue.map(e => e.pinId));
}

async function persist(): Promise<void> {
  syncPendingRegistry();
  try {
    await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(queue) });
  } catch {
    /* best-effort, same contract as writeQueue.ts */
  }
  emitChanged();
}

function emitChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FILE_QUEUE_CHANGED_EVENT));
}

function emitUploadSucceeded(pinId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FILE_UPLOAD_SUCCEEDED_EVENT, { detail: { pinId } }));
}

function emitError(message: string, context?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SYNC_ERROR_EVENT, { detail: { message, status: 0, context } }),
  );
}

// ── File <-> base64 conversion ───────────────────────────────────────────────
// Native Filesystem.writeFile requires base64 for binary. We NEVER encode a
// whole ~12MB capture in one shot — that allocated ~16MB strings and OOM-killed
// the WebView. Chunked encode + appendFile keeps peak heap bounded.

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Write `file` to Directory.Data in small base64 chunks, yielding between
 * chunks so the UI / upload flush can run. Safe to call while an upload of the
 * same File is in flight (reads are independent). Returns false if cancelled
 * mid-write (caller must delete any partial file).
 */
async function writeFileChunked(entryId: string, file: File, fileUri: string): Promise<boolean> {
  let offset = 0;
  let first = true;
  while (offset < file.size) {
    if (diskPersistCancelled.has(entryId)) return false;
    const end = Math.min(offset + DISK_CHUNK_BYTES, file.size);
    const base64 = await blobToBase64(file.slice(offset, end));
    if (first) {
      await Filesystem.writeFile({
        path: fileUri,
        data: base64,
        directory: Directory.Data,
        recursive: true,
      });
      first = false;
    } else {
      await Filesystem.appendFile({
        path: fileUri,
        data: base64,
        directory: Directory.Data,
      });
    }
    offset = end;
    // Yield so upload XHR / React can breathe between ~256KB chunks.
    await new Promise<void>(r => setTimeout(r, 0));
  }
  return !diskPersistCancelled.has(entryId);
}

/**
 * atob() + a manual charCodeAt() copy loop over a large (~16MB+) base64
 * string runs entirely synchronously on the WebView's single JS thread —
 * confirmed on-device via logcat: after a ~12MB raw Insta360 capture's
 * Filesystem.readFile resolved, the app produced ZERO further JS activity
 * (no console output, no Capacitor plugin calls) for 44+ seconds before the
 * next event, with no crash and no exception — it was just this loop running
 * far slower than expected, silently starving the upload call that should
 * have followed it. The data: URL + fetch() decode below hands the same
 * base64->binary conversion to the browser's native (non-JS-loop, often
 * off-main-thread) decoder instead, avoiding that multi-second main-thread
 * stall for the exact same input.
 */
async function base64ToFile(base64: string, fileName: string, mimeType: string): Promise<File> {
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], fileName, { type: mimeType });
}

/** Spill one idle in-memory file to disk and drop the RAM handle. */
async function spillOldestMemoryFile(): Promise<void> {
  for (const [id, file] of memoryFiles) {
    const entry = queue.find(e => e.id === id);
    if (!entry || entry.status === 'uploading') continue;
    await persistEntryToDisk(id, file);
    // After durable write, drop RAM — uploadEntry will read from disk if needed.
    // Do NOT drop while bytesReady === false (path reserved, chunks still writing).
    if (entry.fileUri && entry.bytesReady !== false) memoryFiles.delete(id);
    return;
  }
  // Everything in memory is mid-upload — wait briefly for a slot to free.
  await new Promise<void>(r => setTimeout(r, 250));
}

async function persistEntryToDisk(entryId: string, file: File): Promise<void> {
  if (diskPersistCancelled.has(entryId)) return;
  const entry = queue.find(e => e.id === entryId);
  // Already durable (bytesReady true, or legacy entry with fileUri and no flag).
  if (!entry || (entry.fileUri && entry.bytesReady !== false)) return;

  const fileUri = entry.fileUri || `${FILE_DIR}/${Date.now()}_${seq++}_${entry.fileName}`;
  // Reserve the path in Preferences BEFORE chunked write so a kill mid-write
  // still leaves a queue row (marked incomplete via bytesReady=false) instead
  // of a silent drop on cold start.
  if (!entry.fileUri) {
    entry.fileUri = fileUri;
    entry.bytesReady = false;
    await persist();
  }

  let completed = false;
  try {
    completed = await writeFileChunked(entryId, file, fileUri);
  } catch {
    // Disk full / permission — upload can still proceed from memory this session.
    entry.fileUri = '';
    delete entry.bytesReady;
    await persist();
    await Filesystem.deleteFile({ path: fileUri, directory: Directory.Data }).catch(() => {});
    return;
  }
  if (!completed || diskPersistCancelled.has(entryId) || !queue.some(e => e.id === entryId)) {
    entry.fileUri = '';
    delete entry.bytesReady;
    await persist();
    await Filesystem.deleteFile({ path: fileUri, directory: Directory.Data }).catch(() => {});
    return;
  }
  entry.fileUri = fileUri;
  entry.bytesReady = true;
  await persist();
}

function scheduleDiskPersist(entryId: string, file: File): void {
  diskPersistChain = diskPersistChain
    .then(async () => {
      if (diskPersistCancelled.has(entryId)) return;
      await persistEntryToDisk(entryId, file);
    })
    .catch(() => {
      /* individual write failures are non-fatal */
    });
}

// ── Backoff (identical formula to writeQueue.ts) ─────────────────────────────

function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

function statusOf(error: unknown): number {
  return (error as { status?: number; response?: { status?: number } })?.status
    ?? (error as { response?: { status?: number } })?.response?.status
    ?? 0;
}

function isPermanent(status: number): boolean {
  return status === 400 || status === 403 || status === 404 || status === 409 || status === 422;
}

/**
 * status === 0 means the request never reached any server at all (no
 * network, DNS failure, request timeout — apiClient's response interceptor
 * normalises every such case to status 0). A capture taken in a genuine dead
 * zone must survive however long it takes to get signal back — a field
 * engineer offline for hours must never lose the photo because a fixed
 * attempt counter ran out while there was nothing to even try against. Once
 * the request DOES reach a server (any other status, success or failure),
 * normal MAX_ATTEMPTS accounting resumes — that's a real, reachable backend
 * that just isn't accepting this upload right now.
 */
function isUnreachable(status: number): boolean {
  return status === 0;
}

function messageFor(status: number): string {
  if (status === 403) return 'You do not have permission to upload that capture.';
  if (status === 401) return 'Your session expired — the capture will upload once you sign in again.';
  if (status === 422) {
    return 'This capture is corrupted or unsupported — please capture again.';
  }
  return 'A capture could not be uploaded. It will retry automatically.';
}

const CORRUPT_CAPTURE_MESSAGE =
  'This capture is corrupted or unsupported — please capture again.';

const STITCH_FAILED_MESSAGE =
  'Stitching produced an unusable panorama. Retry stitch, or upload an equirectangular JPEG from Insta360 Studio.';

/**
 * Background stitch failures that will never succeed with the same bytes
 * (corrupt .insp, unsupported layout). Transient cases (timeout / lost spool)
 * should re-upload; blank/unusable stitch can retry server-side if raw is kept.
 */
function isTransientStitchFailure(error: string | null | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e.includes('timed out') ||
    e.includes('spooled upload missing') ||
    e.includes('no spooled file') ||
    e.includes('orphaned') ||
    e.includes('no longer available') ||
    e.includes('no longer on the server')
  );
}

function isStitchQualityFailure(error: string | null | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e.includes('blank') ||
    e.includes('unusable panorama') ||
    e.includes('insta360 studio') ||
    e.includes('low_sphere_coverage') ||
    e.includes('could not stitch')
  );
}

function isPermanentCorruptFailure(error: string | null | undefined): boolean {
  if (!error) return true;
  if (isTransientStitchFailure(error) || isStitchQualityFailure(error)) return false;
  const e = error.toLowerCase();
  return (
    e.includes('corrupt') ||
    e.includes('unsupported') ||
    e.includes('could not decode') ||
    e.includes('imdecode') ||
    e.includes('422') ||
    e.includes('validation')
  );
}

async function markEntryCorruptFailed(
  entry: PendingFileUpload,
  message: string = CORRUPT_CAPTURE_MESSAGE,
): Promise<void> {
  const jobId = entry.stitchJobId;
  if (jobId) {
    useWorkflowStore.getState().discardStitchFailedCapture(entry.pinId, jobId);
  }
  releaseEntryBytes(entry);
  void deleteLocalFile(entry);
  entry.status = 'failed';
  entry.failKind = 'corrupt';
  entry.errorMessage = message;
  delete entry.stitchJobId;
  await persist();
  emitError(message, entry.pinId);
}

/** Keep the capture + stitchJobId so Retry Stitch / Studio JPEG can recover. */
async function markEntryStitchFailed(
  entry: PendingFileUpload,
  message: string = STITCH_FAILED_MESSAGE,
): Promise<void> {
  entry.status = 'failed';
  entry.failKind = 'stitch';
  entry.errorMessage = message;
  // Keep stitchJobId — server may still have the raw spool for retry.
  await persist();
  emitError(message, entry.pinId);
}

/** Drop failed queue rows for a pin and unlink any stitch-dead capture they left behind. */
async function clearFailedUploadStateForPin(pinId: string): Promise<void> {
  const priorFailed = queue.filter(e => e.pinId === pinId && e.status === 'failed');
  if (!priorFailed.length) return;

  for (const e of priorFailed) {
    if (e.stitchJobId) {
      useWorkflowStore.getState().discardStitchFailedCapture(pinId, e.stitchJobId);
    }
    releaseEntryBytes(e);
    void deleteLocalFile(e);
  }
  const abort = uploadAbortControllers.get(pinId);
  if (abort) {
    abort.abort();
    uploadAbortControllers.delete(pinId);
  }
  queue = queue.filter(e => !(e.pinId === pinId && e.status === 'failed'));
  await persist();
}

/** The stitchJobId of a still-processing upload response, if there is one. */
function pendingJobIdOf(result: { files: { stitchJobId?: string; processing_status?: string }[] }): string | undefined {
  const pendingFile = result.files.find(f => f.stitchJobId && f.processing_status === 'processing');
  return pendingFile?.stitchJobId;
}

async function deleteLocalFile(entry: PendingFileUpload): Promise<void> {
  if (!entry.fileUri) return;
  await Filesystem.deleteFile({ path: entry.fileUri, directory: Directory.Data }).catch(() => {
    /* stray file on disk is harmless; never fail the upload over cleanup */
  });
}

function releaseEntryBytes(entry: PendingFileUpload): void {
  diskPersistCancelled.add(entry.id);
  memoryFiles.delete(entry.id);
}

/**
 * Returns true when the upload finished outright, false when the server accepted
 * the bytes but is still stitching (entry stays queued as 'processing').
 */
async function uploadEntry(entry: PendingFileUpload): Promise<boolean> {
  // Prefer a prior successful POST (attach-only retry). Re-uploading the same
  // bytes after attachCaptureToPin failed only produces dedup noise and keeps
  // the pin stuck on "Queued" while the file is already under /uploads.
  let resultFiles = entry.uploadedFiles;
  let fileCount = entry.uploadedFileCount ?? resultFiles?.length ?? 1;

  if (!resultFiles?.length) {
    // Prefer the in-memory File from enqueue (same-session fast path). Fall back
    // to the on-device base64 copy after an app restart / process death.
    let file = memoryFiles.get(entry.id);
    if (!file) {
      if (!entry.fileUri || entry.bytesReady === false) {
        const err = new Error('Capture bytes not yet durable and not in memory') as Error & { status: number };
        err.status = 0;
        throw err;
      }
      const { data } = await Filesystem.readFile({
        path: entry.fileUri,
        directory: Directory.Data,
      });
      file = await base64ToFile(data as string, entry.fileName, entry.mimeType);
    }

    const controller = new AbortController();
    uploadAbortControllers.set(entry.pinId, controller);
    let result: Awaited<ReturnType<typeof uploadCaptureFiles>>;
    try {
      result = await uploadCaptureFiles([file], undefined, undefined, controller.signal);
    } finally {
      if (uploadAbortControllers.get(entry.pinId) === controller) {
        uploadAbortControllers.delete(entry.pinId);
      }
    }
    resultFiles = result.files ?? [];
    fileCount = result.count || resultFiles.length || 1;
    // Persist immediately so a crash mid-attach still skips the next POST.
    entry.uploadedFiles = resultFiles;
    entry.uploadedFileCount = fileCount;
    await persist();
  }

  // Attach immediately either way, so the pin registers the capture the moment
  // the bytes are safe rather than ~25s later when stitching ends. For a pending
  // asset the panorama URL is null and processingStatus is 'processing'; the
  // real asset replaces it once the job completes.
  const captureId = useWorkflowStore.getState().attachCaptureToPin(
    entry.pinId,
    fileCount,
    resultFiles,
  );
  if (!captureId) {
    // Tombstoned pin → permanent discard. Missing pin/room (hydrate race) →
    // retry as unreachable without burning attempts — never treat that as
    // "deleted" or we lose legitimate offline captures.
    if (pinUploadForbidden(entry.pinId)) {
      const err = new Error('Capture pin was deleted') as Error & { status: number };
      err.status = PIN_DELETED_STATUS;
      throw err;
    }
    const err = new Error('Capture pin not in local store yet') as Error & { status: number };
    err.status = 0;
    throw err;
  }

  const jobId = pendingJobIdOf({ files: resultFiles });
  if (jobId) {
    entry.stitchJobId = jobId;
    entry.status = 'processing';
    // Keep RAM until disk has a full copy — clearing early left a stitch-fail
    // → re-upload path with no bytes after a process kill.
    if (entry.fileUri && entry.bytesReady !== false) {
      memoryFiles.delete(entry.id);
    }
    await persist();
    return false;
  }

  releaseEntryBytes(entry);
  await deleteLocalFile(entry);
  return true;
}

/**
 * Poll a stitch job once. Returns:
 *  - 'done' — asset attached, entry finishable
 *  - 'pending' — still stitching
 *  - 'retry' — transient server loss; re-upload same bytes
 *  - 'stitch_failed' — blank/unusable; keep job for Retry Stitch / Studio JPEG
 *  - 'permanent' — corrupt/unsupported; do not re-upload
 */
async function pollStitchEntry(
  entry: PendingFileUpload,
): Promise<'done' | 'pending' | 'retry' | 'stitch_failed' | 'permanent'> {
  const jobId = entry.stitchJobId as string;
  const job = await getCaptureStitchJob(jobId);
  if (job.status === 'completed' && job.asset) {
    // Force the job id onto the finished asset. attachCaptureToPin matches on it
    // to UPDATE the capture created when the upload was accepted; if it were
    // missing the same photo would be stored twice. We know the id locally, so
    // never rely solely on the server echoing it back.
    const asset = { ...job.asset, stitchJobId: job.asset.stitchJobId ?? jobId };
    const captureId = useWorkflowStore.getState().attachCaptureToPin(entry.pinId, 1, [asset]);
    if (!captureId) return 'pending';
    releaseEntryBytes(entry);
    await deleteLocalFile(entry);
    return 'done';
  }
  if (job.status === 'failed') {
    if (isTransientStitchFailure(job.error)) return 'retry';
    if (job.canRetry || isStitchQualityFailure(job.error)) {
      entry.errorMessage = job.error || STITCH_FAILED_MESSAGE;
      return 'stitch_failed';
    }
    if (isPermanentCorruptFailure(job.error)) return 'permanent';
    entry.errorMessage = job.error || STITCH_FAILED_MESSAGE;
    return 'stitch_failed';
  }
  return 'pending';
}

// ── Per-pin SERIAL flush (one multipart at a time) ───────────────────────────
// Cross-pin concurrency was removed on purpose: N simultaneous ~12MB POSTs
// plus any in-flight disk encode OOMs mid-range Android WebViews. One pin's
// stitch poll is cheap; one pin's upload holds the slot until it finishes.

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activePollMs: number | null = null;
let hadBacklog = false;
let flushRunning = false;
let flushAgain = false;

function nextRetryDelay(): number | null {
  // Entries with attempts > 0 reached a server and are on real exponential
  // backoff. Entries stuck at attempts: 0 (offline / unreachable) are NOT
  // on a countdown to anything — retrying them every couple of seconds while
  // there's provably no network is pure battery/CPU churn, so they fall back
  // to the same POLL_MS cadence as the "nothing to retry yet" background
  // poll; the online/networkStatusChange listeners are what actually catch
  // the moment connectivity returns, this is just a safety net.
  const waits = queue.filter(e => e.attempts > 0).map(e => backoffFor(e.attempts));
  return waits.length ? Math.min(...waits) : POLL_MS;
}

async function flush(): Promise<void> {
  // Coalesce overlapping flush() calls (reconnect + focus + poll) into one
  // follow-up pass instead of starting parallel pin chains.
  if (flushRunning) {
    flushAgain = true;
    return;
  }
  flushRunning = true;
  try {
    do {
      flushAgain = false;
      await flushOnce();
    } while (flushAgain);
  } finally {
    flushRunning = false;
  }
}

async function flushOnce(): Promise<void> {
  await load();
  if (healOrphanedUploading()) await persist();
  if (!queue.length) return;
  if (!useAuthStore.getState().isAuthenticated) {
    // Not signed in YET (e.g. this flush ran mid-token-refresh, or before
    // WorkflowApiBootstrap's post-login flush had a chance to fire). Unlike
    // the rest of this function, this early return must still arm the poll
    // timer — otherwise a queued photo that hits this exact branch on its
    // very first flush attempt has no mechanism left to ever retry itself.
    startPolling();
    return;
  }

  const byPin = new Map<string, PendingFileUpload[]>();
  for (const entry of queue) {
    // 'uploading' — already being driven by another flush() call.
    // 'failed' — genuinely exhausted MAX_ATTEMPTS; kept in the queue only so
    // Retry Upload / pin-delete can still find and act on it, but it must
    // NOT auto-retry on every poll/reconnect (that would immediately
    // re-exhaust and re-toast the same error in a loop). retryFileUpload
    // explicitly resets it back to 'queued' to re-arm it.
    if (entry.status === 'uploading' || entry.status === 'failed') continue;
    if (!byPin.has(entry.pinId)) byPin.set(entry.pinId, []);
    byPin.get(entry.pinId)!.push(entry);
  }

  // Serial across pins — see module header. Oldest pin first so floor capture
  // order roughly matches upload order.
  const pinOrder = [...byPin.entries()].sort(
    (a, b) => (a[1][0]?.createdAt ?? 0) - (b[1][0]?.createdAt ?? 0),
  );

  for (const [pinId, entries] of pinOrder) {
    if (inFlightPins.has(pinId)) continue;
    inFlightPins.add(pinId);
    try {
      // Oldest first — preserves re-capture ordering for this pin.
      for (const entry of entries.sort((a, b) => a.createdAt - b.createdAt)) {
        // Deleted pin — never POST / poll. Drop local bytes so login cannot
        // resurrect stitches for pins the user already removed.
        if (pinUploadForbidden(entry.pinId)) {
          await discardEntry(entry);
          continue;
        }

        // Capture already linked (prior attach succeeded; leftover retry rows
        // kept the pin UI stuck on "Queued" / "Saved — uploading…").
        if (entryAlreadyAttachedToPin(entry)) {
          await discardSiblingDuplicates(entry);
          queue = queue.filter(e => e.id !== entry.id);
          releaseEntryBytes(entry);
          void deleteLocalFile(entry);
          await persist();
          emitUploadSucceeded(entry.pinId);
          continue;
        }

        // Already on the server and stitching: poll the job instead of
        // re-uploading. Re-sending the bytes would be wasteful (the backend
        // dedups it anyway) and would restart this pin's chain needlessly.
        if (entry.stitchJobId) {
          try {
            const outcome = await pollStitchEntry(entry);
            if (outcome === 'done') {
              await discardSiblingDuplicates(entry);
              queue = queue.filter(e => e.id !== entry.id);
              if (!queue.some(e => e.pinId === entry.pinId)) {
                removePendingUploadPin(entry.pinId);
              }
              await persist();
              emitUploadSucceeded(entry.pinId);
              continue;
            }
            if (outcome === 'permanent') {
              // Corrupt / unsupported file — keep the pin as failed and ask
              // for a fresh capture. Re-sending the same bytes cannot succeed.
              await markEntryCorruptFailed(entry);
              break;
            }
            if (outcome === 'stitch_failed') {
              await markEntryStitchFailed(
                entry,
                entry.errorMessage || STITCH_FAILED_MESSAGE,
              );
              break;
            }
            if (outcome === 'retry') {
              // Server could not finish the stitch (e.g. restart lost the
              // spooled bytes). Drop the jobId and let normal upload retry
              // re-send from the on-device copy we deliberately kept.
              delete entry.stitchJobId;
              entry.status = 'queued';
              await persist();
              break;
            }
            hadBacklog = true;
            entry.status = 'processing';
            await persist();
            break; // still stitching — check again on the next poll tick
          } catch (error) {
            const pollStatus = statusOf(error);
            if (pollStatus === 404) {
              // Job record is gone (e.g. wiped DB) — fall back to re-uploading.
              delete entry.stitchJobId;
              entry.status = 'queued';
            } else {
              entry.status = 'processing';
            }
            hadBacklog = true;
            await persist();
            break;
          }
        }

        // Need bytes in memory, a finished disk copy, OR a prior successful POST
        // (attach-only retry) before continuing.
        const canAttachOnly = !!(entry.uploadedFiles && entry.uploadedFiles.length);
        const diskReady = !!entry.fileUri && entry.bytesReady !== false;
        if (!canAttachOnly && !memoryFiles.has(entry.id) && !diskReady) {
          hadBacklog = true;
          break;
        }

        entry.status = 'uploading';
        await persist();
        try {
          const finished = await uploadEntry(entry);
          if (!finished) {
            // Accepted for background stitching; entry stays queued as
            // 'processing' and the poll branch above takes over next tick.
            hadBacklog = true;
            break;
          }
          await discardSiblingDuplicates(entry);
          queue = queue.filter(e => e.id !== entry.id);
          if (!queue.some(e => e.pinId === entry.pinId)) {
            removePendingUploadPin(entry.pinId);
          }
          await persist();
          emitUploadSucceeded(entry.pinId);
        } catch (error) {
          const status = statusOf(error);
          if (status === PIN_DELETED_STATUS) {
            await discardEntry(entry);
            continue;
          }
          if (status === 401) {
            hadBacklog = true;
            // Same status as a fresh capture: this is an ordinary "not sent
            // yet" state, not a failure — a 401 resolves itself once the
            // auth layer refreshes the token, with no user action needed
            // (see writeQueue.ts's identical treatment of 401).
            entry.status = 'queued';
            await persist();
            break; // wait for the auth layer to refresh; don't burn an attempt
          }
          if (isPermanent(status)) {
            // Keep the entry as 'failed' so the pin stays red and the user can
            // capture again. Dropping it here used to clear the marker and leave
            // no way to know which pin needed a fresh photo (esp. 422 corrupt).
            releaseEntryBytes(entry);
            void deleteLocalFile(entry);
            entry.status = 'failed';
            entry.failKind = status === 422 ? 'corrupt' : 'upload';
            entry.errorMessage =
              status === 422 ? CORRUPT_CAPTURE_MESSAGE : messageFor(status);
            delete entry.stitchJobId;
            await persist();
            emitError(entry.errorMessage, entry.pinId);
            continue;
          }
          hadBacklog = true;
          if (isUnreachable(status)) {
            // No server was ever reached — this is what "offline" looks
            // like. Never counts toward MAX_ATTEMPTS: a field capture must
            // survive however many hours it takes to get signal back, not
            // get silently dropped by a fixed retry counter.
            //
            // When bytes are already POSTed (attach-only), a status-0 failure
            // is usually a hydrate race (pin/room not in local store yet).
            // Keep retrying indefinitely — never burn MAX_ATTEMPTS here.
            entry.status = 'queued';
            await persist();
            break;
          }
          entry.attempts += 1;
          if (entry.attempts >= MAX_ATTEMPTS) {
            // A server WAS reached repeatedly and kept rejecting/erroring —
            // genuinely gave up. This is the only case that should read as
            // 'failed' to the user; being offline is expected and silent.
            // KEPT in the queue (not removed): retryFileUpload/discardFileUpload
            // need it to still exist to re-arm or clean up the on-device
            // file — deleting it here would silently orphan that file AND
            // make the UI's "Retry Upload" button a dead click with nothing
            // left to retry.
            entry.status = 'failed';
            entry.failKind = 'upload';
            entry.errorMessage = 'Upload failed — retry or capture again.';
            await persist();
            emitError(messageFor(status), entry.pinId);
            continue;
          }
          // Still retrying — stays 'queued' so it reads as "saved, will
          // send later" instead of a false alarm on every retry cycle.
          entry.status = 'queued';
          await persist();
          break; // stop this pin's chain; scheduleNextAttempt() will retry
        }
      }
    } finally {
      inFlightPins.delete(pinId);
    }
  }

  if (!queue.length) {
    stopPolling();
    hadBacklog = false;
  } else {
    scheduleNextAttempt();
    startPolling();
  }
}

function scheduleNextAttempt(): void {
  if (retryTimer) return;
  const delay = nextRetryDelay() ?? BASE_BACKOFF_MS;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, delay);
}

function startPolling(): void {
  if (typeof window === 'undefined') return;
  // A stitching entry needs a much tighter cadence than an offline-waiting one,
  // so the interval is re-armed whenever the queue's mix changes.
  const desired = queue.some(e => e.stitchJobId) ? STITCH_POLL_MS : POLL_MS;
  if (pollTimer) {
    if (desired === activePollMs) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }
  activePollMs = desired;
  pollTimer = setInterval(() => void flush(), desired);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  activePollMs = null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Register a captured file for upload and return quickly.
 *
 * 1. Pending-upload registry is updated synchronously so hydrate cannot drop
 *    the pin during the await that follows.
 * 2. Queue descriptor is persisted immediately.
 * 3. The live `File` is kept in RAM and `flush()` starts the POST right away.
 * 4. A background, chunked disk write makes the bytes survive an app kill —
 *    without blocking the UI on a full-file base64 encode (the OOM/ANR cause).
 */
export async function enqueueFileUpload(
  pinId: string,
  file: File,
  opts?: { stitchJobId?: string },
): Promise<void> {
  // Never queue bytes for a pin the user already deleted — that is how
  // "deleted" captures reappeared as Cloudinary stitches on the next login.
  if (isTombstoned(pinId)) return;

  // Sync BEFORE await load() — closes the hydrate race that dropped pins
  // while Preferences was still being read.
  addPendingUploadPin(pinId);

  await load();
  if (isTombstoned(pinId)) {
    removePendingUploadPin(pinId);
    return;
  }

  // Backpressure: never hold more than MAX_MEMORY_FILES large captures in RAM.
  let spillGuards = 0;
  while (memoryFiles.size >= MAX_MEMORY_FILES && spillGuards++ < 80) {
    await spillOldestMemoryFile();
  }
  // If every in-memory file is mid-upload, wait for a slot rather than
  // ballooning heap (OOM → kill → lost capture before disk persist).
  while (memoryFiles.size >= MAX_MEMORY_FILES && spillGuards++ < 200) {
    await new Promise<void>(r => setTimeout(r, 400));
    await spillOldestMemoryFile();
  }

  // A fresh photo on this pin replaces any prior failed attempt (corrupt
  // stitch / exhausted retries). Do not leave the old bytes queued beside
  // the new ones — that would re-send the bad file or block flush.
  await clearFailedUploadStateForPin(pinId);

  // Do not stack another row for the exact same file still waiting/uploading —
  // that is how Flat 02 stayed "Queued" after View History already worked.
  const duplicateQueued = queue.find(
    e =>
      e.pinId === pinId
      && e.fileName === file.name
      && (e.status === 'queued' || e.status === 'uploading'),
  );
  if (duplicateQueued && !opts?.stitchJobId) {
    if (!memoryFiles.has(duplicateQueued.id)) {
      memoryFiles.set(duplicateQueued.id, file);
    }
    await persist();
    void flush();
    return;
  }

  const id = `fq${Date.now()}_${seq++}`;
  queue.push({
    id,
    pinId,
    fileUri: '',
    fileName: file.name,
    mimeType: file.type || 'image/jpeg',
    attempts: 0,
    createdAt: Date.now(),
    // With a stitchJobId the bytes are ALREADY on the server (a direct upload
    // returned 202); this entry exists purely so polling is durable across an
    // app restart. Without one it's an ordinary pending upload.
    status: opts?.stitchJobId ? 'processing' : 'queued',
    ...(opts?.stitchJobId ? { stitchJobId: opts.stitchJobId } : {}),
  });
  if (!opts?.stitchJobId) {
    memoryFiles.set(id, file);
    scheduleDiskPersist(id, file);
  }
  await persist();
  void flush();
}

/** Force a flush attempt — call after login, on reconnect, or on app resume. */
export function flushFileUploadQueue(): void {
  void flush();
}

/**
 * After a snapshot hydrate (or when Capture History looks stuck on
 * "Processing 360°"), pull finished stitch assets onto captures that still
 * have no panorama. Covers: tab closed mid-stitch, poll timer stopped, or
 * server patched Mongo while the local store kept a placeholder.
 */
export async function reconcileStitchedCaptureMedia(): Promise<number> {
  if (!useAuthStore.getState().isAuthenticated) return 0;
  const state = useWorkflowStore.getState();
  let fixed = 0;
  for (const cap of state.captures) {
    const rec = cap as Parameters<typeof captureAwaitingPanorama>[0];
    if (!captureAwaitingPanorama(rec)) continue;
    const jobId = captureStitchJobId(rec);
    if (!jobId) continue;
    try {
      const job = await getCaptureStitchJob(jobId);
      if (job.status === 'failed') {
        const pin = state.capturePins.find(p => p.captureIds.includes(cap.id));
        if (!pin) continue;
        // Recoverable stitch failure: leave the capture linked so Retry Stitch /
        // Studio JPEG can replace it. Only discard truly dead jobs.
        if (job.canRetry || isStitchQualityFailure(job.error)) {
          const existing = queue.find(e => e.pinId === pin.id && e.stitchJobId === jobId);
          if (!existing) {
            queue.push({
              id: `fq${Date.now()}_${seq++}`,
              pinId: pin.id,
              fileUri: '',
              fileName: 'stitch-retry',
              mimeType: 'application/octet-stream',
              attempts: 0,
              createdAt: Date.now(),
              status: 'failed',
              failKind: 'stitch',
              errorMessage: job.error || STITCH_FAILED_MESSAGE,
              stitchJobId: jobId,
            });
            await persist();
            fixed += 1;
          }
          continue;
        }
        useWorkflowStore.getState().discardStitchFailedCapture(pin.id, jobId);
        fixed += 1;
        continue;
      }
      if (job.status !== 'completed' || !job.asset) continue;
      const asset = { ...job.asset, stitchJobId: job.asset.stitchJobId ?? jobId };
      useWorkflowStore.getState().finalizeCaptureMedia(cap.id, 1, [asset]);
      fixed += 1;
    } catch {
      // 404 / network — leave placeholder; next hydrate or poll may recover.
    }
  }
  return fixed;
}

/** Current status of a pin's queued upload, if any (drives the pin marker UI). */
export function fileUploadStatusForPin(pinId: string): FileUploadStatus | undefined {
  return queue.find(e => e.pinId === pinId)?.status;
}

/** True when bytes already reached the server and only attach/link is pending. */
export function fileUploadAwaitingAttach(pinId: string): boolean {
  const entry = queue.find(e => e.pinId === pinId);
  return !!(entry && entry.uploadedFiles && entry.uploadedFiles.length && entry.status === 'queued');
}

/**
 * Synchronous snapshot of every pin id with a queue entry right now, keyed to
 * its status.
 *
 * The async `allQueuedPinStatuses` below exists to SEED a freshly-mounted page
 * (it awaits the initial Preferences read). This one is for the change-event
 * handler, which runs long after that read has resolved and needs the whole map
 * synchronously — reading pin-by-pin with `fileUploadStatusForPin` can only tell
 * a caller about pins it already knows, so it cannot notice a pin that has just
 * GAINED an entry.
 */
export function queuedPinStatuses(): Record<string, FileUploadStatus> {
  const out: Record<string, FileUploadStatus> = {};
  for (const entry of queue) out[entry.pinId] = entry.status;
  return out;
}

/** Earliest enqueue time for a pin's pending file(s) — used for upload-order numbering. */
export function fileUploadCreatedAtForPin(pinId: string): number | undefined {
  let earliest: number | undefined;
  for (const entry of queue) {
    if (entry.pinId !== pinId) continue;
    if (earliest === undefined || entry.createdAt < earliest) earliest = entry.createdAt;
  }
  return earliest;
}

/**
 * Every pin id with a pending upload right now, keyed to its status. Used to
 * SEED a freshly-mounted page's local status state — without this, a pin
 * queued in a PREVIOUS app session (before a kill/restart) has no way to ever
 * appear as 'queued'/'uploading' in the UI again: the page's own React state
 * starts empty on every mount and (by design, to avoid polling the whole
 * queue every tick) only tracks pins it already knows about going forward.
 * Awaits `load()` first so a call made immediately on mount — before the
 * module's own async Preferences read has resolved — doesn't race and see
 * an empty queue.
 */
export async function allQueuedPinStatuses(): Promise<Record<string, FileUploadStatus>> {
  await load();
  const out: Record<string, FileUploadStatus> = {};
  for (const entry of queue) out[entry.pinId] = entry.status;
  return out;
}

/**
 * Re-arm a pin's exhausted upload and retry immediately, bypassing backoff.
 * Resets attempts to 0 — otherwise it would come back around to
 * MAX_ATTEMPTS on the very first retry and immediately re-fail permanently
 * again with no real second chance.
 *
 * Corrupt captures cannot be fixed by re-sending: no-op so the UI must
 * offer Capture Again instead. Stitch quality failures call the server
 * retry endpoint when a job id is still on the entry.
 */
export function retryFileUpload(pinId: string): void {
  const entry = queue.find(e => e.pinId === pinId && e.status === 'failed');
  if (!entry || entry.failKind === 'corrupt') return;

  if (entry.failKind === 'stitch' && entry.stitchJobId) {
    const jobId = entry.stitchJobId;
    entry.attempts = 0;
    entry.status = 'processing';
    delete entry.failKind;
    delete entry.errorMessage;
    void persist()
      .then(() => retryCaptureStitchJob(jobId))
      .then(() => void flush())
      .catch(async (err) => {
        entry.status = 'failed';
        entry.failKind = 'stitch';
        entry.errorMessage =
          (err as { response?: { data?: { message?: string } } })?.response?.data?.message
          || STITCH_FAILED_MESSAGE;
        await persist();
        emitError(entry.errorMessage, pinId);
      });
    return;
  }

  entry.attempts = 0;
  entry.status = 'queued';
  delete entry.failKind;
  delete entry.errorMessage;
  void persist().then(() => void flush());
}

/** User-facing failure copy for a pin stuck in 'failed', if any. */
export function fileUploadErrorForPin(pinId: string): string | undefined {
  const entry = queue.find(e => e.pinId === pinId && e.status === 'failed');
  return entry?.errorMessage;
}

/** 'corrupt' → Capture Again; 'upload' → Retry Upload; 'stitch' → Retry Stitch. */
export function fileUploadFailKindForPin(pinId: string): FileUploadFailKind | undefined {
  return queue.find(e => e.pinId === pinId && e.status === 'failed')?.failKind;
}

/** Stitch job id still attached to a failed pin (for Studio-JPEG replace flows). */
export function fileUploadStitchJobIdForPin(pinId: string): string | undefined {
  return queue.find(e => e.pinId === pinId)?.stitchJobId;
}

/** Drop a pin's queued upload and its on-device file (e.g. the pin itself was deleted). */
export async function discardFileUpload(pinId: string): Promise<void> {
  // Sync first: hydrate/prune must not see this pin as "still uploading"
  // while we await Preferences load/persist.
  removePendingUploadPin(pinId);
  await load();
  const entries = queue.filter(e => e.pinId === pinId);
  queue = queue.filter(e => e.pinId !== pinId);
  for (const e of entries) {
    diskPersistCancelled.add(e.id);
    memoryFiles.delete(e.id);
  }
  const abort = uploadAbortControllers.get(pinId);
  if (abort) {
    abort.abort();
    uploadAbortControllers.delete(pinId);
  }
  await persist();
  await Promise.all(
    entries.map(e =>
      e.fileUri
        ? Filesystem.deleteFile({ path: e.fileUri, directory: Directory.Data }).catch(() => {})
        : Promise.resolve(),
    ),
  );
}

export function pendingFileUploadCount(): number {
  return queue.length;
}

export async function clearFileUploadQueue(): Promise<void> {
  await load();
  const entries = [...queue];
  queue = [];
  for (const entry of entries) {
    diskPersistCancelled.add(entry.id);
    memoryFiles.delete(entry.id);
    const abort = uploadAbortControllers.get(entry.pinId);
    if (abort) {
      abort.abort();
      uploadAbortControllers.delete(entry.pinId);
    }
    if (entry.pinId) removePendingUploadPin(entry.pinId);
  }
  await persist();
  await Promise.all(
    entries.map(entry =>
      entry.fileUri
        ? Filesystem.deleteFile({ path: entry.fileUri, directory: Directory.Data }).catch(() => {})
        : Promise.resolve(),
    ),
  );
}

// ── Triggers ─────────────────────────────────────────────────────────────────

const PIN_DELETED_EVENT = 'workflow:capture-pin-deleted';

/**
 * On reconnect: heal orphaned 'uploading' rows and flush. Do NOT abort healthy
 * in-flight multipart bodies — aborting after OPTIONS but mid-body was leaving
 * captures stuck and forcing full re-uploads of 12MB files (and more OOM risk).
 * Dead sockets still fail via apiClient's 180s timeout / network error, then
 * retry as status 0.
 */
async function onConnectivityRestored(): Promise<void> {
  await load();
  if (healOrphanedUploading()) await persist();
  void flush();
}

if (typeof window !== 'undefined') {
  void load().then(() => void flush());
  window.addEventListener('online', () => void onConnectivityRestored());
  window.addEventListener('focus', () => void flush());
  window.addEventListener(PIN_DELETED_EVENT, (e: Event) => {
    const pinId = (e as CustomEvent<{ pinId?: string }>).detail?.pinId;
    if (pinId) void discardFileUpload(pinId);
  });
  // Dynamic import avoids a cycle: this module → uploadService → apiClient →
  // sessionRefresh (which emits the event we listen for).
  void import('@/services/sessionRefresh').then(({ AUTH_SESSION_RESTORED_EVENT }) => {
    window.addEventListener(AUTH_SESSION_RESTORED_EVENT, () => void flush());
  });
  Network.addListener('networkStatusChange', status => {
    if (status.connected) void onConnectivityRestored();
  });
}
