/**
 * Who owns the photos and unsent changes waiting on this device, and what a login / logout / expired session may do
 * about them.
 *
 * The rule (Milestone 1 of the offline multi-floor feature): NOTHING waiting is ever deleted by a session change.
 *   - same person logs in again      -> everything is kept and carries on
 *   - a different person logs in     -> the first person's waiting work is parked, locked to them, and handed back
 *                                       when they log in again
 *   - logout / session expiry        -> everything is kept
 * The only time the old "wipe" still runs is when nothing is waiting at all.
 *
 * Pure functions only (storage is passed in) so the rules are unit tested without a browser.
 */

export const LAST_USER_KEY = 'sitesurelabs-last-user-v1';
const PARKED_PREFIX = 'sitesurelabs-parked-v1:';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SessionEvent = 'login' | 'logout' | 'expired';

export interface TransitionInput {
  event: SessionEvent;
  /** Person who owns the work waiting on this device (the last person who was signed in), if any. */
  ownerId: string | null;
  /** Person signing in now (login only). */
  newUserId?: string | null;
  /** Anything unsent at all: photos or queued changes. */
  hasWaitingWork: boolean;
}

export interface TransitionPlan {
  /** Run the full wipe (store reset, queue clear). Only ever true when nothing is waiting. */
  wipe: boolean;
  /** Keep the live store as it is (same person, or logged out with work waiting). */
  keepLive: boolean;
  /** Move the previous owner's unsent work aside, then give the new person a clean store. */
  parkPrevious: boolean;
  /** Give this person back work that was parked for them. */
  restoreForNewUser: boolean;
  /** A different person's photos are waiting: the UI must tell the user before going on. */
  needsOwnerWarning: boolean;
}

export function planSessionTransition(input: TransitionInput): TransitionPlan {
  const { event, ownerId, newUserId, hasWaitingWork } = input;
  const none: TransitionPlan = {
    wipe: false, keepLive: false, parkPrevious: false, restoreForNewUser: false, needsOwnerWarning: false,
  };

  if (event === 'logout' || event === 'expired') {
    // Nothing waiting -> the usual clean-up. Something waiting -> leave every byte alone.
    return hasWaitingWork ? { ...none, keepLive: true } : { ...none, wipe: true };
  }

  // login
  const differentPerson = !!ownerId && !!newUserId && ownerId !== newUserId;
  if (!hasWaitingWork) return { ...none, wipe: true, restoreForNewUser: true };
  if (!differentPerson) return { ...none, keepLive: true };
  return { ...none, parkPrevious: true, restoreForNewUser: true, needsOwnerWarning: true };
}

// ── last signed-in person ────────────────────────────────────────────────────

export function readLastUserId(store: KeyValueStore): string | null {
  try {
    return store.getItem(LAST_USER_KEY) || null;
  } catch {
    return null;
  }
}

export function writeLastUserId(store: KeyValueStore, userId: string): void {
  try {
    store.setItem(LAST_USER_KEY, userId);
  } catch {
    /* best effort */
  }
}

// ── parked work ──────────────────────────────────────────────────────────────

export interface ParkedWork {
  /** Raw persisted workflow store (floors, rooms, pins, captures). */
  workflow: string | null;
  /** Raw persisted write queue (pin/capture changes not yet sent). */
  writes: string | null;
  parkedAt: number;
}

export function parkedKey(ownerId: string): string {
  return `${PARKED_PREFIX}${ownerId}`;
}

/** True once a copy is safely written. Never removes anything it could not first copy. */
export function parkWork(store: KeyValueStore, ownerId: string, work: Omit<ParkedWork, 'parkedAt'>, now = Date.now()): boolean {
  try {
    const payload: ParkedWork = { ...work, parkedAt: now };
    store.setItem(parkedKey(ownerId), JSON.stringify(payload));
    // Read it back: a storage that silently refused the write must not look like success.
    return store.getItem(parkedKey(ownerId)) === JSON.stringify(payload);
  } catch {
    return false;
  }
}

export function readParkedWork(store: KeyValueStore, ownerId: string): ParkedWork | null {
  try {
    const raw = store.getItem(parkedKey(ownerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ParkedWork;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Only call after the parked work has been handed back and is safely in place. */
export function dropParkedWork(store: KeyValueStore, ownerId: string): void {
  try {
    store.removeItem(parkedKey(ownerId));
  } catch {
    /* ignore */
  }
}

/** True when this entry is allowed to be uploaded by the person signed in now. */
export function entryBelongsTo(entryOwnerId: string | undefined, currentUserId: string | null | undefined, legacyOwnerId: string | null): boolean {
  if (!currentUserId) return false;
  const owner = entryOwnerId ?? legacyOwnerId;
  // Entries written before ownership existed belong to whoever was last signed in; if even that is unknown, allow.
  return !owner || owner === currentUserId;
}
