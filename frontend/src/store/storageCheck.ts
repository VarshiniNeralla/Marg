/**
 * How much room is left for photos on this phone, in words a field engineer can act on.
 *
 * The number is an ESTIMATE (the browser's storage quota minus usage), so it only ever drives warnings. It never
 * blocks a capture by itself: the real stop is a photo that could not be written and verified on disk, and that is
 * reported at the moment it happens (see fileUploadQueue).
 */

/** An Insta360 capture is about 12 MB. */
export const AVG_PHOTO_BYTES = 12 * 1024 * 1024;
/** Warn when fewer than this many more photos fit. */
export const LOW_PHOTOS_LEFT = 25;
/** "Stop and free space" when fewer than this many fit. */
export const CRITICAL_PHOTOS_LEFT = 5;

export type StorageLevel = 'ok' | 'low' | 'critical' | 'unknown';

export interface StorageRoom {
  level: StorageLevel;
  /** About how many more photos fit, or null when it cannot be known. */
  photosLeft: number | null;
  freeBytes: number | null;
}

export function assessStorage(quotaBytes: number | null | undefined, usageBytes: number | null | undefined, avgPhoto = AVG_PHOTO_BYTES): StorageRoom {
  if (!quotaBytes || quotaBytes <= 0 || usageBytes == null || usageBytes < 0) {
    return { level: 'unknown', photosLeft: null, freeBytes: null };
  }
  const freeBytes = Math.max(0, quotaBytes - usageBytes);
  const photosLeft = Math.floor(freeBytes / avgPhoto);
  const level: StorageLevel = photosLeft < CRITICAL_PHOTOS_LEFT ? 'critical' : photosLeft < LOW_PHOTOS_LEFT ? 'low' : 'ok';
  return { level, photosLeft, freeBytes };
}

export async function checkStorageRoom(): Promise<StorageRoom> {
  try {
    const est = await navigator.storage?.estimate?.();
    return assessStorage(est?.quota, est?.usage);
  } catch {
    return { level: 'unknown', photosLeft: null, freeBytes: null };
  }
}

export function describeStorage(room: StorageRoom): string {
  if (room.photosLeft == null) return '';
  const n = room.photosLeft;
  if (room.level === 'critical') return `Almost out of space: room for only about ${n} more photo${n === 1 ? '' : 's'}. Free up space before capturing more.`;
  if (room.level === 'low') return `Space is getting low: room for about ${n} more photos.`;
  return `Room for about ${n} more photos.`;
}

/** Floors x points x photo size, e.g. "10 floors with 20 points is about 2.3 GB". For the pre-trip estimate. */
export function estimateTripBytes(photos: number, avgPhoto = AVG_PHOTO_BYTES): number {
  return Math.max(0, photos) * avgPhoto;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}
