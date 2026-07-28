/**
 * Durable offline file-upload queue (Phase 1 of the mobile-app effort).
 *
 * `writeQueue.ts` already makes PIN/CAPTURE METADATA durable — a pin placed
 * offline survives a reload and replays once the backend is reachable. But
 * the actual photo BYTES never went through it: `runPinUpload` in
 * CaptureWorkflowPage.tsx called `uploadCaptureFiles(files)` directly, and on
 * failure only kept the original `File` objects in an in-memory `Map`
 * (`failedFilesRef`). A `File` object is a live, in-memory handle — closing
 * the app (not just backgrounding it) throws it away, and with it the
 * captured photo, even though the pin itself survives.
 *
 * This queue closes that gap using the same durable-descriptor pattern as
 * writeQueue.ts, adapted for binary payloads:
 *   • Each captured file is written to the app's private on-device storage
 *     (`@capacitor/filesystem`, Directory.Data) as base64 — this is REAL
 *     disk, survives a full app kill, unlike an in-memory File/Blob.
 *   • A small descriptor ({ pinId, fileUri, fileName, attempts, status }) is
 *     persisted via `@capacitor/preferences` (Capacitor's native key-value
 *     store) and replayed on load, on reconnect, and on a periodic timer —
 *     mirroring writeQueue.ts's persist/backoff/replay design exactly.
 *   • Uploads for DIFFERENT pins run concurrently (one slow/retrying upload
 *     must not block unrelated pins), but uploads for the SAME pin are
 *     strictly serial (re-captures must attach in the order they were taken).
 *   • On success, the on-device file is deleted and the pin is attached via
 *     the existing `attachCaptureToPin` store action (unchanged) — from
 *     that point on, this queue's job is done and writeQueue.ts's existing
 *     durability takes over for the resulting metadata mutation.
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
import { uploadCaptureFiles } from '@/services/uploadService';

const QUEUE_KEY = 'sitesurelabs-file-upload-queue-v1';
const FILE_DIR = 'pending-uploads';
const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const POLL_MS = 20_000;

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

export type FileUploadStatus = 'queued' | 'uploading' | 'failed';

export interface PendingFileUpload {
  id: string;              // `fq${Date.now()}_${seq++}`
  pinId: string;
  fileUri: string;          // path under Directory.Data/pending-uploads
  fileName: string;          // original captured filename, for the multipart part
  mimeType: string;
  attempts: number;
  createdAt: number;
  status: FileUploadStatus;
}

// ── Persistence (Preferences instead of localStorage: idiomatic Capacitor
// native storage, and this queue guards content the app must never silently
// lose, unlike writeQueue.ts's smaller JSON descriptors) ────────────────────

let queue: PendingFileUpload[] = [];
let loaded = false;
let seq = 0;
const inFlightPins = new Set<string>();

async function load(): Promise<PendingFileUpload[]> {
  if (loaded) return queue;
  try {
    const { value } = await Preferences.get({ key: QUEUE_KEY });
    const parsed = value ? (JSON.parse(value) as PendingFileUpload[]) : [];
    queue = Array.isArray(parsed) ? parsed : [];
  } catch {
    queue = [];
  }
  loaded = true;
  return queue;
}

async function persist(): Promise<void> {
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
// Filesystem.writeFile requires base64 for binary data (no `encoding` option);
// FileReader.readAsDataURL is the standard way to get there from a File/Blob.

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      // "data:<mime>;base64,<data>" — Filesystem wants only the payload.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
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
  return 'A capture could not be uploaded. It will retry automatically.';
}

// ── Upload one entry ──────────────────────────────────────────────────────────

async function uploadEntry(entry: PendingFileUpload): Promise<void> {
  const { data } = await Filesystem.readFile({
    path: entry.fileUri,
    directory: Directory.Data,
  });
  const file = await base64ToFile(data as string, entry.fileName, entry.mimeType);
  const result = await uploadCaptureFiles([file]);
  const fileCount = result.count || 1;
  useWorkflowStore.getState().attachCaptureToPin(entry.pinId, fileCount, result.files);
  await Filesystem.deleteFile({ path: entry.fileUri, directory: Directory.Data }).catch(() => {
    /* stray file on disk is harmless; never fail the upload over cleanup */
  });
}

/**
 * Upload a freshly-captured file straight from memory — no Filesystem
 * write/read round-trip at all — for the common case where the device is
 * online right now. This is strictly an optimization over the durable queue
 * below (which remains the source of truth for offline/interrupted
 * uploads): skipping the base64 write+read+decode entirely avoids the
 * multi-second-plus main-thread stall confirmed on-device for large (~12MB)
 * captures, and lets a normal, immediate capture upload at the speed a plain
 * `File` object allows.
 *
 * Returns true if the direct upload succeeded (caller does nothing further —
 * `attachCaptureToPin` has already run). Returns false for ANY failure
 * (including "we're offline") so the caller can fall back to
 * `enqueueFileUpload`'s durable, retryable queue — this function never
 * throws.
 */
export async function tryDirectUpload(pinId: string, file: File): Promise<boolean> {
  try {
    const status = await Network.getStatus();
    if (!status.connected) return false;
    const result = await uploadCaptureFiles([file]);
    const fileCount = result.count || 1;
    useWorkflowStore.getState().attachCaptureToPin(pinId, fileCount, result.files);
    return true;
  } catch {
    // Any failure (network, timeout, server error, auth) — the durable queue
    // is the fallback path and already knows how to retry/classify errors.
    return false;
  }
}

// ── Per-pin serial, cross-pin concurrent flush ───────────────────────────────
// A pin's uploads must attach in the order they were captured (re-capture
// after re-capture), but one pin's retry backoff must never stall a
// different pin's otherwise-ready upload.

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let hadBacklog = false;

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
  await load();
  if (!queue.length) return;
  if (!useAuthStore.getState().isAuthenticated) {
    // Not signed in YET (e.g. this flush ran mid-token-refresh, or before
    // WorkflowApiBootstrap's post-login flush had a chance to fire). Unlike
    // the rest of this function, this early return must still arm the poll
    // timer — otherwise a queued photo that hits this exact branch on its
    // very first flush attempt has no mechanism left to ever retry itself:
    // startPolling() below only runs once flush() gets PAST this check, so a
    // queue that never gets past it never polls, and sits at 'queued'
    // forever until an unrelated online/focus/network event happens to fire
    // (reproduced: a capture taken right as the access token expired had its
    // pin/room/audit-log writes all land normally, but its own
    // /uploads/captures request was never even sent).
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

  await Promise.all(
    [...byPin.entries()].map(async ([pinId, entries]) => {
      if (inFlightPins.has(pinId)) return; // this pin's chain is already running
      inFlightPins.add(pinId);
      try {
        // Oldest first — preserves re-capture ordering for this pin.
        for (const entry of entries.sort((a, b) => a.createdAt - b.createdAt)) {
          entry.status = 'uploading';
          await persist();
          try {
            await uploadEntry(entry);
            queue = queue.filter(e => e.id !== entry.id);
            await persist();
            emitUploadSucceeded(entry.pinId);
          } catch (error) {
            const status = statusOf(error);
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
              queue = queue.filter(e => e.id !== entry.id);
              await persist();
              emitError(messageFor(status), entry.pinId);
              continue;
            }
            hadBacklog = true;
            if (isUnreachable(status)) {
              // No server was ever reached — this is what "offline" looks
              // like. Never counts toward MAX_ATTEMPTS: a field capture must
              // survive however many hours it takes to get signal back, not
              // get silently dropped by a fixed retry counter.
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
    }),
  );

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
  if (pollTimer || typeof window === 'undefined') return;
  pollTimer = setInterval(() => void flush(), POLL_MS);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Persist a captured file to on-device storage and enqueue it for upload.
 * Returns immediately (the write to disk is the only awaited step) — the
 * actual network upload happens in the background via `flush()`.
 */
export async function enqueueFileUpload(pinId: string, file: File): Promise<void> {
  await load();
  const base64 = await fileToBase64(file);
  const fileUri = `${FILE_DIR}/${Date.now()}_${seq++}_${file.name}`;
  await Filesystem.writeFile({
    path: fileUri,
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });
  queue.push({
    id: `fq${Date.now()}_${seq++}`,
    pinId,
    fileUri,
    fileName: file.name,
    mimeType: file.type || 'image/jpeg',
    attempts: 0,
    createdAt: Date.now(),
    status: 'queued',
  });
  await persist();
  void flush();
}

/** Force a flush attempt — call after login, on reconnect, or on app resume. */
export function flushFileUploadQueue(): void {
  void flush();
}

/** Current status of a pin's queued upload, if any (drives the pin marker UI). */
export function fileUploadStatusForPin(pinId: string): FileUploadStatus | undefined {
  return queue.find(e => e.pinId === pinId)?.status;
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
 */
export function retryFileUpload(pinId: string): void {
  const entry = queue.find(e => e.pinId === pinId && e.status === 'failed');
  if (!entry) return;
  entry.attempts = 0;
  entry.status = 'queued';
  void persist().then(() => void flush());
}

/** Drop a pin's queued upload and its on-device file (e.g. the pin itself was deleted). */
export async function discardFileUpload(pinId: string): Promise<void> {
  await load();
  const entries = queue.filter(e => e.pinId === pinId);
  queue = queue.filter(e => e.pinId !== pinId);
  await persist();
  await Promise.all(
    entries.map(e =>
      Filesystem.deleteFile({ path: e.fileUri, directory: Directory.Data }).catch(() => {}),
    ),
  );
}

export function pendingFileUploadCount(): number {
  return queue.length;
}

// ── Triggers ─────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  void load().then(() => void flush());
  window.addEventListener('online', () => void flush());
  window.addEventListener('focus', () => void flush());
  Network.addListener('networkStatusChange', status => {
    if (status.connected) void flush();
  });
}
