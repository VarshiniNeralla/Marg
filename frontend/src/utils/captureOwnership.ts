import type { MockCapture, MockTour } from '@/data/mockData';

export type CaptureOwner = {
  id: string;
  name?: string | null;
  email?: string | null;
};

function displayName(user: CaptureOwner | null | undefined): string {
  return (user?.name?.trim() || user?.email?.trim() || '').trim();
}

/** True when this capture belongs to the signed-in user. */
export function isOwnCapture(
  capture: { uploadedByUserId?: string; uploaded_by_user_id?: string; uploadedBy?: string; uploaded_by?: string },
  user: CaptureOwner | null | undefined,
): boolean {
  if (!user?.id) return false;
  const uid = String(capture.uploadedByUserId || capture.uploaded_by_user_id || '').trim();
  if (uid) return uid === user.id;
  const name = displayName(user);
  if (!name) return false;
  const by = String(capture.uploadedBy || capture.uploaded_by || '').trim();
  return by === name;
}

export function filterOwnCaptures<T extends MockCapture>(
  captures: readonly T[],
  user: CaptureOwner | null | undefined,
): T[] {
  if (!user?.id) return [];
  return captures.filter(c => isOwnCapture(c, user));
}

export function ownCaptureIdSet(
  captures: readonly MockCapture[],
  user: CaptureOwner | null | undefined,
): Set<string> {
  return new Set(filterOwnCaptures(captures, user).map(c => c.id));
}

/** Pin timeline as this user should see it (shared layout, own photos only). */
export function pinCaptureIdsForUser(
  captureIds: readonly string[],
  ownIds: Set<string> | null,
): string[] {
  if (!ownIds) return [...captureIds];
  return captureIds.filter(id => ownIds.has(id));
}

export function pinHasOwnCapture(
  captureIds: readonly string[],
  ownIds: Set<string> | null,
): boolean {
  if (!ownIds) return captureIds.length > 0;
  return captureIds.some(id => ownIds.has(id));
}

type UploaderRecord = {
  uploadedByUserId?: string;
  uploaded_by_user_id?: string;
  uploadedBy?: string;
  uploaded_by?: string;
};

function isOwnUploaderRecord(
  record: UploaderRecord,
  user: CaptureOwner | null | undefined,
): boolean {
  if (!user?.id) return false;
  const uid = String(record.uploadedByUserId || record.uploaded_by_user_id || '').trim();
  if (uid) return uid === user.id;
  const name = displayName(user);
  if (!name) return false;
  const by = String(record.uploadedBy || record.uploaded_by || '').trim();
  return by === name;
}

/** True when this tour belongs to the signed-in user. */
export function isOwnTour(
  tour: UploaderRecord,
  user: CaptureOwner | null | undefined,
): boolean {
  return isOwnUploaderRecord(tour, user);
}

export function filterOwnTours<T extends MockTour>(
  tours: readonly T[],
  user: CaptureOwner | null | undefined,
): T[] {
  if (!user?.id) return [];
  return tours.filter(t => isOwnTour(t, user));
}

/** Find this user's published walkthrough for a floor plan, if any. */
export function findOwnFloorPlanTour(
  tours: readonly MockTour[],
  floorPlanId: string,
  user: CaptureOwner | null | undefined,
): MockTour | undefined {
  return tours.find(t => t.floorPlanId === floorPlanId && isOwnTour(t, user));
}
