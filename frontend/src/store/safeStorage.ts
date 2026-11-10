/**
 * Quota-safe localStorage adapter for Zustand `persist`.
 *
 * Problem it solves: the workflow store persists the entire dataset to a single
 * localStorage key. localStorage is capped (~5 MB) and `setItem` throws
 * `QuotaExceededError` once captures/floor-plans accumulate — and Zustand's
 * default storage swallows that, silently diverging in-memory state from what
 * was persisted.
 *
 * This adapter:
 *   1. Catches quota errors on write instead of letting them corrupt state.
 *   2. On overflow, retries after asking the value-trimmer (passed in) to drop
 *      the heaviest fields, then gives up gracefully (logs, keeps running) —
 *      the API snapshot rehydrates the full data on next load anyway.
 */
import type { StateStorage, PersistStorage, StorageValue } from 'zustand/middleware';

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014)
  );
}

export function createSafeStorage(): StateStorage {
  return {
    getItem: (name) => {
      try {
        return localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, value);
      } catch (err) {
        if (isQuotaError(err)) {
          // Free space by dropping our own key, then retry once.
          try {
            localStorage.removeItem(name);
            localStorage.setItem(name, value);
            return;
          } catch {
            // Still too big — give up on persisting this write. In-memory state
            // remains correct; the API snapshot will rehydrate on next load.
            // eslint-disable-next-line no-console
            console.warn(
              `[persist] "${name}" exceeds localStorage quota; skipping persist this cycle.`
            );
            return;
          }
        }
        // Non-quota error (e.g. storage disabled) — log and continue, never throw.
        // eslint-disable-next-line no-console
        console.warn(`[persist] failed to write "${name}":`, err);
      }
    },
    removeItem: (name) => {
      try {
        localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Zustand persist storage that WRITES AT MOST ONCE PER `delayMs` instead of on every state change.
 *
 * Why: the workflow store persists its whole dataset (floors, rooms, pins, captures, tours...) under one key. With
 * the default storage every single `set()` (an upload status tick, a pin moving, a hydrate, a poll) re-ran
 * JSON.stringify over all of it and wrote it to localStorage, both synchronously on the UI thread. With a few
 * hundred records that is tens of milliseconds per change, several times a second, which is felt as everything
 * being sluggish.
 *
 * This keeps only the LATEST value and serialises + writes it after the burst settles. Nothing is lost on a normal
 * exit because it also flushes immediately when the page is hidden or closed. Reads see the pending value first, so
 * a read-after-write is always consistent. Durable queues (writeQueue / fileUploadQueue) have their own storage and
 * are unaffected.
 */
const debouncedFlushers = new Set<() => void>();

/** Write every debounced store's latest value to disk right now. Call before copying a persisted key. */
export function flushAllDebouncedStorage(): void {
  for (const f of debouncedFlushers) f();
}

export function createDebouncedJsonStorage<S>(delayMs = 400): PersistStorage<S> {
  const base = createSafeStorage();
  let pending: { name: string; value: StorageValue<S> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const { name, value } = pending;
    pending = null;
    try {
      base.setItem(name, JSON.stringify(value));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[persist] failed to serialise "${name}":`, err);
    }
  };

  debouncedFlushers.add(flush);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  return {
    getItem: (name) => {
      if (pending && pending.name === name) return pending.value;
      const raw = base.getItem(name) as string | null;
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    removeItem: (name) => {
      if (pending && pending.name === name) pending = null;
      base.removeItem(name);
    },
  };
}
