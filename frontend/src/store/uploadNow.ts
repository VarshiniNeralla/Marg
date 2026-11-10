/**
 * Upload now: runs the whole "send everything I captured on this trip" flow.
 *
 *   1. pre-checks (server reachable, signed in, Wi-Fi vs mobile data, battery)        -> gatherPreChecks
 *   2. release the hold, send pins and rooms first, then photos one at a time          -> startUploadNow
 *   3. progress that survives an app restart, with pause and resume                    -> monitor
 *   4. final reconciliation: the phone copy is deleted only once the server confirms   -> finish
 *
 * The rules live in uploadPlan.ts / reconcilePlan.ts (unit tested). This file only wires them to the queues.
 */
import { Network } from '@capacitor/network';
import { API_BASE_URL } from '@/config/env';
import { useAuthStore } from './authStore';
import { flushWriteQueue, heldWriteCount, pendingWriteCount } from './writeQueue';
import {
  flushFileUploadQueue, releaseVerifiedPhotos, unconfirmedPhotoCount, waitingPhotoInfos, FILE_UPLOAD_SUCCEEDED_EVENT,
  type ReleaseResult,
} from './fileUploadQueue';
import {
  beginRelease, endRelease, getUploadSession, isPinInScope, recordBatchProgress, setPhotosWaitForWrites, UPLOAD_SESSION_CHANGED_EVENT,
} from './uploadHold';
import {
  computeProgress, evaluatePreChecks, isDrained, isUnsent, type ConnectionKind, type PreCheckResult, type Progress,
} from './uploadPlan';

const MONITOR_MS = 1500;
const HEALTH_TIMEOUT_MS = 6000;

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let finishing = false;
let wakeLock: { release: () => Promise<void> } | null = null;
let lastResult: { release: ReleaseResult; failed: number; at: number } | null = null;

function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(UPLOAD_SESSION_CHANGED_EVENT));
}

// ── pre-checks ───────────────────────────────────────────────────────────────

async function serverReachable(): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), HEALTH_TIMEOUT_MS);
  try {
    // Any answer at all (even an error page) proves the server can be reached.
    await fetch(`${API_BASE_URL}/health`, { signal: ctl.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function readBattery(): Promise<{ level: number | null; charging: boolean | null }> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
    const b = await nav.getBattery?.();
    if (b) return { level: b.level, charging: b.charging };
  } catch {
    /* not reported on this phone */
  }
  return { level: null, charging: null };
}

async function readConnection(): Promise<ConnectionKind> {
  try {
    const s = await Network.getStatus();
    if (!s.connected) return 'none';
    if (s.connectionType === 'wifi') return 'wifi';
    if (s.connectionType === 'cellular') return 'cellular';
    return 'unknown';
  } catch {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? 'none' : 'unknown';
  }
}

export async function gatherPreChecks(bytesToSend: number): Promise<PreCheckResult> {
  const connection = await readConnection();
  const [reachable, battery] = await Promise.all([
    connection === 'none' ? Promise.resolve(false) : serverReachable(),
    readBattery(),
  ]);
  const auth = useAuthStore.getState();
  return evaluatePreChecks({
    serverReachable: reachable,
    signedIn: auth.isAuthenticated && !!auth.accessToken,
    connection,
    batteryLevel: battery.level,
    charging: battery.charging,
    bytesToSend,
  });
}

// ── keep the screen awake while uploading ────────────────────────────────────

async function acquireWakeLock(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (!wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch {
    /* not available: the person is asked to stay in the app */
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

/** While an upload runs, only the points that were ticked count. Outside a run, everything waiting counts. */
async function scopedInfos() {
  const infos = await waitingPhotoInfos();
  return getUploadSession().phase === 'uploading' ? infos.filter(p => isPinInScope(p.pinId)) : infos;
}

// ── progress ─────────────────────────────────────────────────────────────────

export interface UploadNowStatus {
  phase: 'open' | 'uploading';
  progress: Progress;
  writesPending: number;
  stitching: number;
  /** Photos sent but whose phone copy is still kept, waiting for the server to confirm it. */
  unconfirmed: number;
  failed: { pinId: string; message: string; failKind?: string }[];
}

export async function readUploadNowStatus(): Promise<UploadNowStatus> {
  const session = getUploadSession();
  const infos = await scopedInfos();
  const unsent = infos.filter(isUnsent).length;
  const failedInfos = infos.filter(p => p.status === 'failed');
  return {
    phase: session.phase,
    progress: computeProgress(session.batchTotal, unsent, failedInfos.length),
    writesPending: heldWriteCount(),
    stitching: infos.filter(p => p.status === 'processing' || !!p.stitchJobId).length,
    unconfirmed: await unconfirmedPhotoCount(),
    failed: failedInfos.map(p => ({ pinId: p.pinId, message: p.errorMessage || 'Upload failed. Retry or capture again.', failKind: p.failKind })),
  };
}

export function getLastUploadNowResult() {
  return lastResult;
}

// ── run ──────────────────────────────────────────────────────────────────────

function startMonitor(): void {
  if (monitorTimer || typeof window === 'undefined') return;
  monitorTimer = setInterval(() => void tick(), MONITOR_MS);
  void tick();
}

function stopMonitor(): void {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null;
}

let ticking = false;

async function tick(): Promise<void> {
  if (ticking || finishing || getUploadSession().phase !== 'uploading') return;
  ticking = true;
  try {
    await tickOnce();
  } finally {
    ticking = false;
  }
}

async function tickOnce(): Promise<void> {
  const infos = await scopedInfos();
  const unsent = infos.filter(isUnsent).length;
  const failed = infos.filter(p => p.status === 'failed').length;
  const writes = pendingWriteCount();
  const total = computeProgress(getUploadSession().batchTotal, unsent, failed);
  recordBatchProgress(total.done);

  // No connection: the upload simply waits here (progress is kept) and carries on when it returns.
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  // Pins and rooms first. Only when none are waiting do photos start.
  if (writes > 0) {
    if (!offline) flushWriteQueue();
    return;
  }
  setPhotosWaitForWrites(false);
  if (!offline) flushFileUploadQueue();

  if (isDrained(unsent, writes)) await finish(failed);
}

async function finish(failed: number): Promise<void> {
  if (finishing) return;
  finishing = true;
  try {
    stopMonitor();
    // Final reconciliation: ask the server which of our fingerprints it holds, and only then free the phone copies.
    const release = await releaseVerifiedPhotos();
    lastResult = { release, failed, at: Date.now() };
    const completed = failed === 0 && !release.skipped && release.missing === 0;
    endRelease(completed);
    await releaseWakeLock();
  } finally {
    finishing = false;
    announce();
  }
}

/** Tap on "Upload now". The caller has already shown the review and the pre-checks. */
export async function startUploadNow(pinIds: string[] | null = null): Promise<void> {
  const infos = (await waitingPhotoInfos()).filter(p => !pinIds || pinIds.includes(p.pinId));
  const unsent = infos.filter(isUnsent).length;
  lastResult = null;
  setPhotosWaitForWrites(true);
  beginRelease(unsent, pinIds);
  await acquireWakeLock();
  startMonitor();
  flushWriteQueue();
}

/** Pause: nothing new starts. The photo being sent right now finishes; everything else stays on the phone. */
export async function pauseUploadNow(): Promise<void> {
  stopMonitor();
  setPhotosWaitForWrites(false);
  endRelease(false);
  await releaseWakeLock();
  announce();
}

/** Resume after a pause or an app restart. */
export async function resumeUploadNow(): Promise<void> {
  const prev = getUploadSession();
  const infos = (await waitingPhotoInfos()).filter(p => !prev.scopePinIds || prev.scopePinIds.includes(p.pinId));
  const unsent = infos.filter(isUnsent).length;
  setPhotosWaitForWrites(true);
  beginRelease(Math.max(prev.batchTotal, unsent), prev.scopePinIds);
  await acquireWakeLock();
  startMonitor();
  flushWriteQueue();
}

/**
 * Called once when the app starts. If an upload was running when the app was closed or killed, carry on where it
 * stopped. Photos already confirmed are not re-sent (they left the queue); the server also ignores repeats.
 */
export function initUploadNow(): void {
  if (typeof window === 'undefined') return;
  if (getUploadSession().phase === 'uploading') {
    setPhotosWaitForWrites(true);
    startMonitor();
    void acquireWakeLock();
  }
  // Wake lock is dropped when the screen turns off; take it again when the app comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getUploadSession().phase === 'uploading') void acquireWakeLock();
  });
  // Any time a photo finishes later (e.g. a stitch completes), try to free confirmed phone copies. Read-only check.
  let timer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener(FILE_UPLOAD_SUCCEEDED_EVENT, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (getUploadSession().phase === 'uploading' || finishing) return;
      void releaseVerifiedPhotos().then(announce).catch(() => {});
    }, 5000);
  });
}
