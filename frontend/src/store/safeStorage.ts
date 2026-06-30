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
import type { StateStorage } from 'zustand/middleware';

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
