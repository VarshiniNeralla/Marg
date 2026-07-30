/**
 * Which pins currently have photo bytes still in flight on THIS device.
 *
 * Exists purely to break a module cycle: `fileUploadQueue` imports
 * `workflowStore` (to attach finished captures), so `workflowStore` cannot
 * import the queue back. Both import this leaf module instead.
 *
 * The workflow store's snapshot merge needs this to tell two situations apart
 * that otherwise look identical — a capture missing from the server snapshot
 * because it was deleted on another device, versus missing because its upload or
 * background stitch simply hasn't finished yet. Without the distinction a
 * just-taken capture (and its pin) was discarded on refresh.
 *
 * Kept as a plain synchronous Set because the merge runs synchronously during
 * hydration, before any async queue read could resolve. `fileUploadQueue` is
 * responsible for seeding it as soon as it loads its persisted queue, and for
 * keeping it current as entries come and go.
 */
// Mirrored to localStorage so the set is readable SYNCHRONOUSLY on a cold start.
// The durable queue itself lives in Capacitor Preferences, which is async-only —
// but the workflow store's snapshot merge is synchronous and runs during
// hydration, potentially before that read resolves. Seeing an empty set there
// would make the merge treat a still-uploading capture as deleted.
//
// Guessing in the other direction is equally dangerous: assuming "work may be
// pending" for every unknown pin caused deleted pins to be re-created by the
// back-fill (reproduced: 6 pins reappeared within 5 seconds of each other). So
// this must be an accurate answer available immediately, not a fallback guess.
const MIRROR_KEY = 'sitesurelabs-pending-upload-pins-v1';

function readMirror(): string[] {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMirror(ids: string[]): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(ids));
  } catch {
    /* quota/unavailable — the in-memory set still works for this session */
  }
}

// Seeded synchronously at module load from the mirror, so the very first
// snapshot merge already has the real answer.
const pinsWithPendingUploads = new Set<string>(readMirror());

/** Replace the whole set — used when the durable queue (re)loads from disk. */
export function setPendingUploadPins(pinIds: Iterable<string>): void {
  pinsWithPendingUploads.clear();
  for (const id of pinIds) pinsWithPendingUploads.add(id);
  writeMirror([...pinsWithPendingUploads]);
}

/**
 * Pins with unfinished upload/stitch work on this device.
 *
 * Only `setPendingUploadPins` mutates this — the durable queue calls it on every
 * persist, so the set is always a whole-queue snapshot rather than something
 * maintained by incremental add/remove calls that could drift out of sync.
 */
export function pendingUploadPins(): ReadonlySet<string> {
  return pinsWithPendingUploads;
}
