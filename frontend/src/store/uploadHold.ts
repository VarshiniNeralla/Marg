/**
 * Upload hold: the switch behind "Upload when I tap".
 *
 * In MANUAL mode nothing is sent on its own. Photos and the pin / capture changes that go with them stay on the
 * phone until the person taps Upload now, which moves the session to 'uploading'. When everything has gone up (or the
 * person pauses) it goes back to 'open' and the hold is on again.
 * In AUTO mode there is no hold at all: the app behaves exactly as it always did.
 *
 * A leaf module: both upload queues import it, so it must not import either of them.
 */
import { useAuthStore } from './authStore';

export type UploadMode = 'manual' | 'auto';
export type SessionPhase = 'open' | 'uploading';

export interface UploadSession {
  /** Explicit choice made on this phone, or null to follow the role default. */
  mode: UploadMode | null;
  phase: SessionPhase;
  /** Photos that were waiting when Upload now was tapped (the progress denominator). */
  batchTotal: number;
  /** Photos already confirmed on the server in this batch. */
  batchDone: number;
  /** When this trip's first waiting photo was saved. Drives the "Resume session" prompt. */
  startedAt: number | null;
  releasedAt: number | null;
  completedAt: number | null;
  /** Points whose photos Upload now is allowed to send. null = everything. */
  scopePinIds: string[] | null;
}

export const UPLOAD_SESSION_KEY = 'sitesurelabs-upload-session-v1';
export const UPLOAD_SESSION_CHANGED_EVENT = 'workflow:upload-session-changed';

const EMPTY: UploadSession = {
  mode: null, phase: 'open', batchTotal: 0, batchDone: 0, startedAt: null, releasedAt: null, completedAt: null, scopePinIds: null,
};

// ── pure rules ───────────────────────────────────────────────────────────────

/** Field engineers default to "Upload when I tap" (the plan's recommendation); everyone else keeps today's behaviour. */
export function defaultModeForRole(role: string | null | undefined): UploadMode {
  return role === 'field_engineer' ? 'manual' : 'auto';
}

export function effectiveMode(mode: UploadMode | null, role: string | null | undefined): UploadMode {
  return mode ?? defaultModeForRole(role);
}

/** The one rule every automatic trigger obeys. */
export function computeHeld(mode: UploadMode, phase: SessionPhase): boolean {
  return mode === 'manual' && phase !== 'uploading';
}

export function parseSession(raw: string | null): UploadSession {
  if (!raw) return { ...EMPTY };
  try {
    const p = JSON.parse(raw) as Partial<UploadSession>;
    return {
      mode: p.mode === 'manual' || p.mode === 'auto' ? p.mode : null,
      // An interrupted upload resumes as 'uploading' so a killed app carries on (no hold) instead of silently stalling.
      phase: p.phase === 'uploading' ? 'uploading' : 'open',
      batchTotal: Number(p.batchTotal) || 0,
      batchDone: Number(p.batchDone) || 0,
      startedAt: typeof p.startedAt === 'number' ? p.startedAt : null,
      releasedAt: typeof p.releasedAt === 'number' ? p.releasedAt : null,
      completedAt: typeof p.completedAt === 'number' ? p.completedAt : null,
      scopePinIds: Array.isArray(p.scopePinIds) ? p.scopePinIds.filter((x): x is string => typeof x === 'string') : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

// ── state ────────────────────────────────────────────────────────────────────

let session: UploadSession = (() => {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    return parseSession(localStorage.getItem(UPLOAD_SESSION_KEY));
  } catch {
    return { ...EMPTY };
  }
})();

function commit(next: UploadSession): void {
  session = next;
  try {
    localStorage.setItem(UPLOAD_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* best effort */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(UPLOAD_SESSION_CHANGED_EVENT));
}

export function getUploadSession(): UploadSession {
  return session;
}

export function getUploadMode(): UploadMode {
  return effectiveMode(session.mode, useAuthStore.getState().user?.role);
}

const MODE_MIGRATION_KEY = 'sitesurelabs-upload-mode-default-v2';

/**
 * One-time repair: a field engineer whose phone holds an explicit "Automatically" choice (left by earlier testing or an
 * older build) never saw the Upload now banner and had no way back to "When I tap". Clear that stored choice once so the
 * role default (When I tap) applies again; they can still pick Automatically from the Upload dialog at any time.
 */
export function applyFieldEngineerModeDefaultOnce(role: string | null | undefined): boolean {
  if (role !== 'field_engineer') return false;
  try {
    if (localStorage.getItem(MODE_MIGRATION_KEY)) return false;
    localStorage.setItem(MODE_MIGRATION_KEY, '1');
  } catch {
    return false;
  }
  if (session.mode !== 'auto') return false;
  commit({ ...session, mode: null, phase: 'open' });
  return true;
}

export function setUploadMode(mode: UploadMode): void {
  // Switching to auto while a session is open lets everything waiting go up on its own; make that explicit.
  commit({ ...session, mode, phase: mode === 'auto' ? 'open' : session.phase });
}

/**
 * The ONLY queued changes "Upload when I tap" holds back: the pin, room and capture details that belong with the
 * photos (so a manager never sees a half-finished pin). Everything else (tours, publishing, projects, notifications...)
 * is a normal action that must reach the server straight away; holding it made new tours vanish on reload.
 */
export const HELD_WRITE_OPS: ReadonlySet<string> = new Set([
  'createCapturePin', 'updateCapturePin', 'createRoom', 'updateRoom', 'createFlat', 'updateFlat', 'createCapture',
]);

export function isHeldWriteOp(op: string): boolean {
  return HELD_WRITE_OPS.has(op);
}

/**
 * The point a held change belongs to, when it belongs to one. Rooms and flats describe the building, not one point,
 * so they return null. `pinOfCapture` finds the point a capture is attached to.
 */
export function pinOfHeldWrite(op: string, args: unknown[], pinOfCapture: (captureId: string) => string | undefined): string | null {
  const first = args[0];
  const idOf = (v: unknown): string | null =>
    v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;
  if (op === 'createCapturePin') return idOf(first);
  if (op === 'updateCapturePin') return typeof first === 'string' ? first : null;
  if (op === 'createCapture') {
    const captureId = idOf(first);
    return captureId ? pinOfCapture(captureId) ?? null : null;
  }
  return null;
}

/**
 * During a PARTIAL Upload now (some floors ticked), the pin and capture details of points that were not ticked stay
 * on the phone with their photos. Otherwise the server would get capture records with no image for those floors.
 * A change whose point cannot be worked out is sent (never held back forever).
 */
export function isWriteOutOfScope(
  op: string, args: unknown[], scope: string[] | null, phase: SessionPhase,
  pinOfCapture: (captureId: string) => string | undefined,
): boolean {
  if (scope == null || phase !== 'uploading' || !isHeldWriteOp(op)) return false;
  const pin = pinOfHeldWrite(op, args, pinOfCapture);
  return pin != null && !scope.includes(pin);
}

/** True while automatic triggers must not start any upload. */
export function isUploadHeld(): boolean {
  return computeHeld(getUploadMode(), session.phase);
}

/**
 * Upload now sends pins and rooms FIRST, then photos. While this is true the photo queue waits, even though the hold is
 * released, until the change queue has emptied. Memory only: after a restart the queues' own retry rules cover it.
 */
let photosWaitForWrites = false;

export function setPhotosWaitForWrites(wait: boolean): void {
  photosWaitForWrites = wait;
}

export function arePhotosWaitingForWrites(): boolean {
  return photosWaitForWrites;
}

/** Pure: may this point's photos be sent right now? Used by the upload queue for every photo. */
export function computePhotoHeld(
  held: boolean, waitingForWrites: boolean, mode: UploadMode, scope: string[] | null, pinId: string,
): boolean {
  if (held || waitingForWrites) return true;
  // A partial Upload now: points the person did not tick stay put.
  return mode === 'manual' && scope != null && !scope.includes(pinId);
}

export function isPhotoHeld(pinId: string): boolean {
  return computePhotoHeld(isUploadHeld(), photosWaitForWrites, getUploadMode(), session.scopePinIds, pinId);
}

/** Is this point part of the running Upload now? (everything when no selection was made) */
export function isPinInScope(pinId: string): boolean {
  return session.scopePinIds == null || session.scopePinIds.includes(pinId);
}

/** Remember when the trip began (first photo saved), once. */
export function markSessionStarted(now = Date.now()): void {
  if (session.startedAt == null) commit({ ...session, startedAt: now });
}

export function beginRelease(total: number, scopePinIds: string[] | null = null, now = Date.now()): void {
  commit({ ...session, phase: 'uploading', batchTotal: total, batchDone: 0, releasedAt: now, completedAt: null, scopePinIds });
}

export function recordBatchProgress(done: number): void {
  if (done !== session.batchDone) commit({ ...session, batchDone: done });
}

/** Back to holding. `completed` = everything went up and was verified. */
export function endRelease(completed: boolean, now = Date.now()): void {
  commit({
    ...session,
    phase: 'open',
    scopePinIds: null,
    ...(completed ? { startedAt: null, completedAt: now, batchTotal: 0, batchDone: 0 } : {}),
  });
}

export function subscribeUploadSession(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(UPLOAD_SESSION_CHANGED_EVENT, fn);
  return () => window.removeEventListener(UPLOAD_SESSION_CHANGED_EVENT, fn);
}
