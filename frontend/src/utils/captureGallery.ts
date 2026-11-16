import type { MockCapture } from '@/data/mockData';

/** Latest capture id per pin (gallery shows one card per pin). */
export function getLatestPinCaptureIds(
  pins: ReadonlyArray<{ captureIds: readonly string[] }>,
): Set<string> {
  const ids = new Set<string>();
  for (const pin of pins) {
    if (pin.captureIds.length > 0) {
      ids.add(pin.captureIds[pin.captureIds.length - 1]);
    }
  }
  return ids;
}

/**
 * Every capture to remove when a whole floor is deleted from Capture History: the cards shown for that floor plus the
 * earlier visits of the same capture points. Without the earlier visits the next-latest visit of each point would
 * simply appear as a new card, so the floor would never look empty. `ownIds` limits the earlier visits to the signed-in
 * engineer's own captures (a pin timeline can also hold other people's visits, which they cannot delete).
 */
export function collectFloorCaptureIds(
  cards: ReadonlyArray<{ id: string }>,
  pins: ReadonlyArray<{ captureIds: readonly string[] }>,
  ownIds?: ReadonlySet<string> | null,
): { ids: string[]; shown: number; earlier: number } {
  const ids = new Set<string>(cards.map(c => c.id));
  for (const card of cards) {
    const pin = pins.find(p => p.captureIds.includes(card.id));
    if (!pin) continue;
    for (const id of pin.captureIds) {
      if (!ownIds || ownIds.has(id)) ids.add(id);
    }
  }
  return { ids: [...ids], shown: cards.length, earlier: ids.size - cards.length };
}

/** Every capture id attached to any pin (including older visits). */
export function getAllPinCaptureIds(
  pins: ReadonlyArray<{ captureIds: readonly string[] }>,
): Set<string> {
  const ids = new Set<string>();
  for (const pin of pins) {
    for (const id of pin.captureIds) ids.add(id);
  }
  return ids;
}

/**
 * Gallery / Capture History visibility: one card per pin (latest visit only).
 * Older visits stay on the pin timeline, not as separate history cards.
 */
export function isGalleryVisibleCapture(
  c: MockCapture,
  allPinCaptureIds: Set<string>,
  latestPinCaptureIds: Set<string>,
): boolean {
  if (allPinCaptureIds.has(c.id) && !latestPinCaptureIds.has(c.id)) return false;
  return true;
}

/** Same list Capture History uses for cards and project badges. */
export function filterGalleryCaptures(
  captures: readonly MockCapture[],
  pins: ReadonlyArray<{ captureIds: readonly string[] }>,
  projectIds?: Set<string> | null,
): MockCapture[] {
  const latestPinCaptureIds = getLatestPinCaptureIds(pins);
  const allPinCaptureIds = getAllPinCaptureIds(pins);
  return captures.filter(c => {
    if (projectIds && !projectIds.has(c.projectId)) return false;
    return isGalleryVisibleCapture(c, allPinCaptureIds, latestPinCaptureIds);
  });
}
