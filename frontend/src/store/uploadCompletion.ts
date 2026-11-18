/**
 * "Your trip is done" tracking.
 *
 * Sending the photos finishes first; the server then stitches them (seconds each with MediaSDK, minutes with the
 * built-in stitcher). The person should not have to watch that. When the last photo has been SENT we remember the
 * batch here; when nothing is left processing on the server we raise one event so the app can say "done".
 * The marker is kept in localStorage so an app restart in between still ends with the message.
 */

const KEY = 'sv_upload_completion_pending';

export const UPLOAD_COMPLETION_CHANGED_EVENT = 'sv:upload-completion-changed';
export const UPLOAD_TRIP_COMPLETE_EVENT = 'sv:upload-trip-complete';

export interface PendingCompletion {
  /** Photos in the batch that was sent. */
  total: number;
  /** Photos that failed while sending (kept safe on the phone for a retry). */
  failed: number;
  at: number;
}

export interface TripCompleteDetail {
  total: number;
  /** Photos that still need attention (failed or stitch failed), at the moment everything else finished. */
  needAttention: number;
}

function load(): PendingCompletion | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingCompletion>;
    return typeof v.total === 'number' && v.total > 0 ? { total: v.total, failed: Number(v.failed) || 0, at: Number(v.at) || Date.now() } : null;
  } catch {
    return null;
  }
}

let pending: PendingCompletion | null = load();

function commit(next: PendingCompletion | null): void {
  pending = next;
  try {
    if (typeof localStorage !== 'undefined') {
      if (next) localStorage.setItem(KEY, JSON.stringify(next));
      else localStorage.removeItem(KEY);
    }
  } catch {
    /* storage unavailable: the in-memory marker still works until the app closes */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(UPLOAD_COMPLETION_CHANGED_EVENT));
}

export function getPendingCompletion(): PendingCompletion | null {
  return pending;
}

export function subscribePendingCompletion(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(UPLOAD_COMPLETION_CHANGED_EVENT, fn);
  return () => window.removeEventListener(UPLOAD_COMPLETION_CHANGED_EVENT, fn);
}

/** Called when the last photo of a batch has been sent. Nothing to track for an empty batch. */
export function armTripCompletion(total: number, failed: number, now = Date.now()): void {
  if (total > 0) commit({ total, failed, at: now });
}

/** A new upload run starts: any older marker is stale. */
export function clearTripCompletion(): void {
  if (pending) commit(null);
}

/** Everything the server was working on is finished and nothing is waiting to be written. */
export function isTripProcessed(stitching: number, writesPending: number): boolean {
  return stitching <= 0 && writesPending <= 0;
}

/**
 * Called on every status read. Raises the completion event once, then forgets the batch.
 * Returns true when it fired.
 */
export function completeTripIfDone(status: { stitching: number; writesPending: number; failed: unknown[] }): boolean {
  const marker = pending;
  if (!marker || !isTripProcessed(status.stitching, status.writesPending)) return false;
  commit(null);
  const detail: TripCompleteDetail = { total: marker.total, needAttention: status.failed.length };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<TripCompleteDetail>(UPLOAD_TRIP_COMPLETE_EVENT, { detail }));
  return true;
}

/** "35 photos uploaded and processed." / "33 of 35 photos processed. 2 need attention." */
export function describeTripResult(d: TripCompleteDetail): { title: string; body: string; ok: boolean } {
  const ok = d.needAttention === 0;
  const n = (x: number) => `${x} photo${x === 1 ? '' : 's'}`;
  if (ok) return { ok, title: 'Trip uploaded', body: `${n(d.total)} uploaded and processed. Everything is ready.` };
  const good = Math.max(0, d.total - d.needAttention);
  return {
    ok,
    title: 'Trip uploaded, some need attention',
    body: `${good} of ${n(d.total)} processed. ${d.needAttention} need${d.needAttention === 1 ? 's' : ''} attention: open Uploads to retry.`,
  };
}
