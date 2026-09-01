/**
 * Durable backend-write queue.
 *
 * The workflow store is local-first: every mutation updates the persisted
 * Zustand state immediately and then mirrors the change to the backend. That
 * mirror used to be fire-and-forget — a single `promise.catch(console.error)`.
 * If the request failed for ANY reason (a token-refresh race right after login,
 * a transient network blip, a 4xx/5xx, the tab being closed mid-flight) the
 * change lived only in THIS device's localStorage and never reached the server.
 * The originating device kept showing it (it reads its own store); a second
 * device (e.g. the same user on mobile) hydrates purely from the backend
 * snapshot and therefore saw nothing — the classic "I placed a pin on desktop
 * but my phone shows an empty floor plan" sync bug.
 *
 * This queue makes writes durable:
 *   • Each mutation enqueues a *serialisable* descriptor ({ op, args }) — not a
 *     live promise — so it survives a reload.
 *   • The queue is persisted to its own localStorage key and replayed on the
 *     next load, on reconnect (`online`), and on a periodic timer.
 *   • Failures are retried with exponential backoff. Order is preserved so a
 *     create is never overtaken by a later update of the same entity.
 *   • Permanent client errors (validation/permission) are dropped instead of
 *     blocking the queue forever, and surfaced to the user via a toast event.
 */
import { Network } from '@capacitor/network';
import { workflowApiService } from '@/services/workflowApiService';
import { useAuthStore, isFieldEngineer } from './authStore';
import { isTombstoned } from './tombstones';

const QUEUE_KEY = 'sitesurelabs-write-queue-v1';
const MAX_QUEUE = 1000;
// A single transient op is retried up to this many times before we give up and
// drop it (so a poison entry can never wedge the whole queue indefinitely).
const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
// While the queue is non-empty, re-attempt at least this often even without an
// `online` event (covers flaky connections that never fire one).
const POLL_MS = 20_000;

/** Event name for backend-sync failures; a global listener surfaces a toast. */
export const SYNC_ERROR_EVENT = 'workflow:sync-error';
/** Emitted once the queue fully drains after having had a pending backlog. */
export const SYNC_RECOVERED_EVENT = 'workflow:sync-recovered';

export interface PendingWrite {
  id: string;            // unique queue-entry id
  op: string;            // workflowApiService method name
  args: unknown[];       // serialisable arguments
  context?: string;      // human label for diagnostics
  attempts: number;
  createdAt: number;
  /** When set to 'failed', the entry is kept for manual retry instead of dropped. */
  status?: 'pending' | 'failed';
  lastError?: string;
}

type WriteOps = typeof workflowApiService;
export type WriteOpName = keyof WriteOps;

// ── Persistence ────────────────────────────────────────────────────────────

function load(): PendingWrite[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingWrite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(queue: PendingWrite[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* quota / disabled storage — the queue is best-effort, never throw */
  }
}

// In-memory mirror of the persisted queue. The module owns the single source of
// truth so concurrent enqueues during a flush stay consistent.
let queue: PendingWrite[] = load();
let flushing = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let seq = 0;

function save(): void {
  persist(queue);
}

// ── Error classification ─────────────────────────────────────────────────────

function statusOf(error: unknown): number {
  return (error as { status?: number })?.status ?? 0;
}

/**
 * Permanent client errors will never succeed on retry, so we drop them rather
 * than block the queue. 401 is treated as transient — the axios layer refreshes
 * the token (or redirects to login) and the write can replay afterwards.
 */
function isPermanent(status: number): boolean {
  return status === 400 || status === 403 || status === 404 || status === 409 || status === 422;
}

/** status 0 = never reached a server (offline / DNS / timeout). Must not burn attempts. */
function isUnreachable(status: number): boolean {
  return status === 0;
}

function emitError(message: string, status: number, context?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SYNC_ERROR_EVENT, { detail: { message, status, context } }),
  );
}

function emitRecovered(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SYNC_RECOVERED_EVENT));
}

function messageForStatus(status: number): string {
  if (status === 403) return 'You do not have permission to save that change.';
  if (status === 401) return 'Your session expired — please sign in again to save changes.';
  return 'A change could not be saved to the server. It will stay queued until you retry sync.';
}

/**
 * A 404 on a delete op means the record is already gone from the server —
 * exactly the outcome the user wanted, just arrived at from a different
 * path (e.g. this device's queue still had a stale delete queued for
 * something already removed elsewhere). That's a no-op success, not a
 * failure, and should never surface an error toast.
 */
function isNoopDelete(op: string, status: number): boolean {
  if (status === 404 && op.startsWith('delete')) return true;
  // Leftover pin DELETEs from "delete last capture" for Site Engineers always
  // 403 (floorPlans:delete). Drop silently — do not toast permission spam.
  if (status === 403 && op === 'deleteCapturePin') return true;
  return false;
}

/** Drop queued pin DELETEs that Site Engineers are not allowed to perform. */
function dropForbiddenPinDeletes(): void {
  if (!isFieldEngineer(useAuthStore.getState().user)) return;
  const before = queue.length;
  queue = queue.filter(e => e.op !== 'deleteCapturePin');
  if (queue.length !== before) save();
}

/** True if this write would recreate or patch an intentionally deleted id. */
function writeTargetsTombstone(entry: PendingWrite): boolean {
  if (
    entry.op === 'deleteCapturePin' ||
    entry.op === 'deleteRoom' ||
    entry.op === 'deleteCapture' ||
    entry.op === 'deleteTour' ||
    entry.op === 'deleteFloorPlan'
  ) {
    return false;
  }
  if (
    entry.op === 'createCapturePin' ||
    entry.op === 'createRoom' ||
    entry.op === 'createCapture' ||
    entry.op === 'createTour' ||
    entry.op === 'createFloorPlan'
  ) {
    const id = (entry.args[0] as { id?: string } | undefined)?.id;
    return !!id && isTombstoned(id);
  }
  if (
    entry.op === 'updateCapturePin' ||
    entry.op === 'updateRoom' ||
    entry.op === 'updateCapture' ||
    entry.op === 'updateTour'
  ) {
    const id = entry.args[0] as string | undefined;
    return !!id && isTombstoned(id);
  }
  return false;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function dispatch(entry: PendingWrite): Promise<unknown> {
  const fn = (workflowApiService as Record<string, unknown>)[entry.op];
  if (typeof fn !== 'function') {
    return Promise.reject({ status: 400, message: `Unknown write op "${entry.op}"` });
  }
  return (fn as (...a: unknown[]) => Promise<unknown>).apply(workflowApiService, entry.args);
}

// ── Flush loop ────────────────────────────────────────────────────────────────

function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

let hadBacklog = false;

async function flush(): Promise<void> {
  if (flushing) return;
  if (typeof window === 'undefined') return;
  dropForbiddenPinDeletes();
  if (!queue.length) return;
  // Don't hammer the API (and trigger login redirects) while signed out.
  // Still arm the poll so a backlog taken offline / mid-refresh retries once
  // auth returns — matching fileUploadQueue's auth-blocked behaviour.
  if (!useAuthStore.getState().isAuthenticated) {
    startPolling();
    return;
  }

  flushing = true;
  try {
    // FIFO. Stop at the first transient failure so ordering is preserved
    // (a create is never overtaken by a later update of the same entity).
    let skippedFailed = 0;
    while (queue.length) {
      const entry = queue[0];

      // Failed entries sit at the back until retried — never block fresh work.
      if (entry.status === 'failed') {
        skippedFailed += 1;
        if (skippedFailed >= queue.length) break;
        queue.push(queue.shift() as PendingWrite);
        save();
        continue;
      }
      skippedFailed = 0;

      // Never recreate/update an entity the client already deleted. Leftover
      // createCapturePin / updateCapturePin entries after a pin delete were
      // resurrecting deleted pins on the next login (then file uploads attached).
      if (writeTargetsTombstone(entry)) {
        queue.shift();
        save();
        continue;
      }

      try {
        await dispatch(entry);
        queue.shift();
        save();
      } catch (error) {
        const status = statusOf(error);

        if (status === 401) {
          // Auth layer will refresh / redirect; retry the same entry later.
          hadBacklog = true;
          break;
        }

        if (isPermanent(status)) {
          // Won't ever succeed — drop it so the queue can make progress.
          queue.shift();
          save();
          if (!isNoopDelete(entry.op, status)) {
            // Tell the user their change wasn't saved — unless this was a
            // delete for something already gone, which is a no-op success.
            emitError(messageForStatus(status), status, entry.context);
          }
          continue;
        }

        hadBacklog = true;
        // Offline / unreachable: never burn attempts. A pin create taken on
        // camera WiFi must survive hours offline — dropping it after ~5 min
        // left the photo queued with nowhere to attach after login hydrate.
        if (isUnreachable(status)) {
          save();
          scheduleRetry(backoffFor(Math.max(1, entry.attempts || 1)));
          break;
        }
        // Reachable transient (429 / 5xx). Count it; mark failed after
        // MAX_ATTEMPTS but keep the entry for manual retry — never drop metadata.
        entry.attempts += 1;
        if (entry.attempts >= MAX_ATTEMPTS) {
          entry.status = 'failed';
          entry.lastError = messageForStatus(status);
          queue.push(queue.shift() as PendingWrite);
          save();
          emitError(entry.lastError, status, entry.context);
          continue;
        }
        save();
        scheduleRetry(backoffFor(entry.attempts));
        break;
      }
    }
  } finally {
    flushing = false;
  }

  const activeCount = queue.filter(e => e.status !== 'failed').length;
  if (!activeCount) {
    stopPolling();
    if (hadBacklog) {
      hadBacklog = false;
      emitRecovered();
    }
  } else {
    startPolling();
  }
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRetry(delay: number): void {
  if (retryTimer) return;
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
 * Enqueue a backend write. `op` is a method name on `workflowApiService` and
 * `args` are its (serialisable) arguments. Replaces the old fire-and-forget
 * `mirrorApi(workflowApiService.foo(...))` pattern with a durable, replayable
 * descriptor. Returns immediately; the flush runs in the background.
 */
export function enqueueWrite<K extends WriteOpName>(
  op: K,
  args: Parameters<WriteOps[K] extends (...a: never[]) => unknown ? WriteOps[K] : never>,
  context?: string,
): void {
  // Site Engineers must never DELETE pins (403). Drop any leftover queue spam.
  if (op === 'deleteCapturePin' && isFieldEngineer(useAuthStore.getState().user)) {
    return;
  }

  // Collapse exact duplicates that haven't been sent yet (double-tap / double
  // fire). Different field-patches on the same entity are kept distinct.
  const serialisedArgs = JSON.stringify(args);
  const isDuplicate = queue.some(
    e => e.op === op && JSON.stringify(e.args) === serialisedArgs,
  );
  if (isDuplicate) {
    void flush();
    return;
  }

  // updateCapturePin({ captureIds }) must not FIFO-replay a shorter list after a
  // longer one — that wiped pin timelines (second visit / Compare vanished).
  // Keep only the newest captureIds patch per pin.
  if (op === 'updateCapturePin') {
    const pinId = args[0] as string | undefined;
    const patch = args[1] as { captureIds?: string[] } | undefined;
    if (pinId && Array.isArray(patch?.captureIds)) {
      queue = queue.filter(e => {
        if (e.op !== 'updateCapturePin') return true;
        if (e.args[0] !== pinId) return true;
        const prev = e.args[1] as { captureIds?: string[] } | undefined;
        return !Array.isArray(prev?.captureIds);
      });
    }
  }

  // Deleting the same pin/floor-plan/capture twice (replace + copy-from races)
  // only produces 404 spam. Keep a single pending delete per id.
  if (
    op === 'deleteCapturePin'
    || op === 'deleteFloorPlan'
    || op === 'deleteCapture'
    || op === 'deleteRoom'
    || op === 'deleteTour'
  ) {
    const id = args[0] as string | undefined;
    if (id) {
      queue = queue.filter(e => !(e.op === op && e.args[0] === id));
    }
  }

  if (queue.length >= MAX_QUEUE) {
    // Prefer dropping non-create updates over creates (creates are dependency
    // roots — dropping them leaves orphan updates). If only creates remain,
    // refuse the new enqueue rather than shifting the oldest create.
    const dropIdx = queue.findIndex(e =>
      e.op !== 'createCapture'
      && e.op !== 'createCapturePin'
      && e.op !== 'createRoom'
      && e.op !== 'createTour'
      && e.op !== 'createFloorPlan'
      && e.op !== 'createProject'
      && e.op !== 'createTower'
      && e.op !== 'createFloor',
    );
    if (dropIdx >= 0) {
      queue.splice(dropIdx, 1);
      // eslint-disable-next-line no-console
      console.warn('[write-queue] queue full; dropped a non-create pending write');
    } else {
      // eslint-disable-next-line no-console
      console.error('[write-queue] queue full of creates; refusing new enqueue');
      return;
    }
  }

  queue.push({
    id: `wq${Date.now()}_${seq++}`,
    op,
    args: args as unknown[],
    context,
    attempts: 0,
    createdAt: Date.now(),
  });
  save();
  void flush();
}

/** Force a flush attempt — call after login / a successful snapshot hydrate. */
export function flushWriteQueue(): void {
  void flush();
}

/** Number of writes still waiting to reach the backend (excludes failed-but-retained). */
export function pendingWriteCount(): number {
  return queue.filter(e => e.status !== 'failed').length;
}

/** Writes that exhausted retries but are kept for manual replay. */
export function failedWriteCount(): number {
  return queue.filter(e => e.status === 'failed').length;
}

/** Reset failed entries and replay the queue — call from a "Retry sync" action. */
export function retryFailedWrites(): void {
  let changed = false;
  for (const entry of queue) {
    if (entry.status === 'failed') {
      entry.status = undefined;
      entry.attempts = 0;
      entry.lastError = undefined;
      changed = true;
    }
  }
  if (changed) {
    save();
    void flush();
  }
}

/**
 * True if a write creating this record is still queued/unsent. Callers that
 * reconcile local state against a (possibly stale) API snapshot — e.g.
 * hydrateFromApi's back-fill of "local record missing from the API" — MUST
 * check this before re-enqueueing a create for the same id: the API snapshot
 * can be stale simply because THIS queue's own pending write hasn't reached
 * the backend yet, not because the write was ever lost. Without this check,
 * an offline-created record (pin/room/capture) whose original create is still
 * queued at the moment of a reconnect races the backfill's OWN independent
 * createX call for the identical id — each generates a fresh nested id for
 * anything the action allocates inline (e.g. createCapturePin's backing
 * room), producing two distinct backend records for what was meant to be one.
 */
export function isCreatePending(op: WriteOpName, id: string): boolean {
  return queue.some(e => e.op === op && (e.args[0] as { id?: string } | undefined)?.id === id);
}

/**
 * Drop pending create/update writes for the given entity ids so a delete cannot
 * be undone by a later FIFO replay of an earlier create, or by an attach/update
 * that was enqueued before the pin was tombstoned (logs: PUT pin → 404 after
 * DELETE, and resurrected pins from leftover createCapturePin entries).
 *
 * Delete ops for those ids are kept — they are what make the server converge.
 */
export function cancelWritesForEntityIds(...ids: string[]): void {
  const idSet = new Set(ids.filter(Boolean));
  if (!idSet.size) return;

  const before = queue.length;
  queue = queue.filter(e => {
    if (
      e.op === 'deleteCapturePin' ||
      e.op === 'deleteRoom' ||
      e.op === 'deleteCapture' ||
      e.op === 'deleteTour' ||
      e.op === 'deleteFloorPlan'
    ) {
      return true;
    }
    if (
      e.op === 'createCapturePin' ||
      e.op === 'createRoom' ||
      e.op === 'createCapture' ||
      e.op === 'createTour' ||
      e.op === 'createFloorPlan'
    ) {
      const id = (e.args[0] as { id?: string } | undefined)?.id;
      return !id || !idSet.has(id);
    }
    if (
      e.op === 'updateCapturePin' ||
      e.op === 'updateRoom' ||
      e.op === 'updateCapture' ||
      e.op === 'updateTour' ||
      e.op === 'updateDefect'
    ) {
      const id = e.args[0] as string | undefined;
      return !id || !idSet.has(id);
    }
    return true;
  });
  if (queue.length !== before) save();
}

/**
 * Drop pending DELETE writes for ids the server already removed (e.g. copy-from
 * cleared empty target pins). Prevents DELETE → 404 spam in the API log.
 */
export function cancelPendingDeletesForEntityIds(...ids: string[]): void {
  const idSet = new Set(ids.filter(Boolean));
  if (!idSet.size) return;
  const before = queue.length;
  queue = queue.filter(e => {
    if (
      e.op !== 'deleteCapturePin'
      && e.op !== 'deleteRoom'
      && e.op !== 'deleteCapture'
      && e.op !== 'deleteTour'
      && e.op !== 'deleteFloorPlan'
    ) {
      return true;
    }
    const id = e.args[0] as string | undefined;
    return !id || !idSet.has(id);
  });
  if (queue.length !== before) save();
}

export function clearWriteQueue(): void {
  if (!queue.length) return;
  queue = [];
  save();
}

// ── Triggers ─────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  // Replay anything left over from a previous session as soon as we load.
  window.addEventListener('online', () => void flush());
  window.addEventListener('focus', () => void flush());
  // Capacitor reports camera-WiFi → site-WiFi as networkStatusChange; the
  // browser `online` event often does not fire for that switch.
  Network.addListener('networkStatusChange', status => {
    if (status.connected) void flush();
  });
  // Defer the initial replay a tick so the auth store can rehydrate first.
  setTimeout(() => void flush(), 0);
  // Dynamic import avoids pulling sessionRefresh (and thus apiClient) into this
  // module's static graph. Token refresh does not flip isAuthenticated, so this
  // is what wakes queued pin/room writes that hit 401 mid-flight.
  void import('@/services/sessionRefresh').then(({ AUTH_SESSION_RESTORED_EVENT }) => {
    window.addEventListener(AUTH_SESSION_RESTORED_EVENT, () => void flush());
  });
}
