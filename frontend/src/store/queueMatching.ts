/**
 * Pure helpers for deciding whether two upload-queue photos are "the same photo".
 * Kept free of Capacitor / store imports so they can be unit tested.
 *
 * Cameras reuse file names across visits, so a name alone must never be treated as proof that a photo was
 * already sent or already queued; doing so silently discarded a second visit to the same capture point.
 */

/** True when a capture's recorded taken-time is this queue entry's own taken-time (within 2 s). */
export function capturedAtMatchesEntry(capturedAt: string | undefined, entryCreatedAt: number): boolean {
  if (!capturedAt) return false;
  const ms = Date.parse(capturedAt);
  if (!Number.isFinite(ms)) return false;
  return Math.abs(ms - entryCreatedAt) <= 2_000;
}

/** Same photo = same name AND same size. Entries saved before sizes were recorded (expectedBytes undefined) fall
 *  back to the old name-only rule. */
export function isSameQueuedFile(
  entry: { fileName: string; expectedBytes?: number },
  fileName: string,
  size: number | undefined,
): boolean {
  if (entry.fileName !== fileName) return false;
  if (entry.expectedBytes === undefined || size === undefined) return true;
  return entry.expectedBytes === size;
}
