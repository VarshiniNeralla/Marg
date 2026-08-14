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
