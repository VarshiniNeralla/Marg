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
import { workflowApiService } from '@/services/workflowApiService';
import { useAuthStore } from './authStore';

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
}

type WriteOps = typeof workflowApiService;
type WriteOpName = keyof WriteOps;

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
  return 'A change could not be saved to the server. It will retry automatically.';
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
  if (!queue.length) return;
  // Don't hammer the API (and trigger login redirects) while signed out.
  if (!useAuthStore.getState().isAuthenticated) return;

  flushing = true;
  try {
    // FIFO. Stop at the first transient failure so ordering is preserved
    // (a create is never overtaken by a later update of the same entity).
    while (queue.length) {
      const entry = queue[0];
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
          // Won't ever succeed — drop it so the queue can make progress, but
          // tell the user their change wasn't saved.
          queue.shift();
          save();
          emitError(messageForStatus(status), status, entry.context);
          continue;
        }

        // Transient (network / 0 / 429 / 5xx). Count it; give up only after
        // MAX_ATTEMPTS so a poison entry can't wedge the queue forever.
        hadBacklog = true;
        entry.attempts += 1;
        if (entry.attempts >= MAX_ATTEMPTS) {
          queue.shift();
          save();
          emitError(messageForStatus(status), status, entry.context);
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

  if (!queue.length) {
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

  if (queue.length >= MAX_QUEUE) {
    // Safety valve: never let the queue grow unbounded. Drop the oldest and
    // warn — the API snapshot rehydrates the full dataset on next load anyway.
    queue.shift();
    // eslint-disable-next-line no-console
    console.warn('[write-queue] queue full; dropping oldest pending write');
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

/** Number of writes still waiting to reach the backend. */
export function pendingWriteCount(): number {
  return queue.length;
}

// ── Triggers ─────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  // Replay anything left over from a previous session as soon as we load.
  window.addEventListener('online', () => void flush());
  window.addEventListener('focus', () => void flush());
  // Defer the initial replay a tick so the auth store can rehydrate first.
  setTimeout(() => void flush(), 0);
}
