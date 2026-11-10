/**
 * Upload now: the rules, with no storage and no network so they can be tested directly.
 * (review screen numbers, pre-checks, progress, and "has everything gone up")
 */
import { formatBytes } from './storageCheck';

export interface QueuedPhotoInfo {
  pinId: string;
  bytes: number;
  status: 'queued' | 'uploading' | 'processing' | 'failed';
  failKind?: 'corrupt' | 'upload' | 'stitch';
  errorMessage?: string;
  /** Already on the server and stitching: finishing work, not waiting to be sent. */
  stitchJobId?: string;
}

/** A photo that still has to be sent. */
export function isUnsent(p: QueuedPhotoInfo): boolean {
  return p.status !== 'failed' && p.status !== 'processing' && !p.stitchJobId;
}

export interface FloorReview {
  floorId: string;
  floorName: string;
  towerId?: string;
  towerName?: string;
  photos: number;
  bytes: number;
  /** Photos that need attention (damaged, or failed): kept safe, but they will not upload by themselves. */
  needsAttention: number;
  /** The points on this floor with photos waiting (what ticking the floor releases). */
  pinIds: string[];
}

export interface ReviewSummary {
  floors: FloorReview[];
  totalPhotos: number;
  totalBytes: number;
  needsAttention: number;
}

export interface PinFloor {
  floorId: string;
  floorName: string;
  towerId?: string;
  towerName?: string;
}

/** Group the waiting photos by floor for the review screen. Floors keep the order they are first seen in. */
export function buildReview(photos: QueuedPhotoInfo[], floorOfPin: (pinId: string) => PinFloor | undefined): ReviewSummary {
  const byFloor = new Map<string, FloorReview>();
  let totalPhotos = 0;
  let totalBytes = 0;
  let needsAttention = 0;
  for (const p of photos) {
    if (p.status === 'processing' || p.stitchJobId) continue; // already on the server
    const f = floorOfPin(p.pinId) ?? { floorId: 'unknown', floorName: 'Other points' };
    let row = byFloor.get(f.floorId);
    if (!row) {
      row = { floorId: f.floorId, floorName: f.floorName, towerId: f.towerId, towerName: f.towerName, photos: 0, bytes: 0, needsAttention: 0, pinIds: [] };
      byFloor.set(f.floorId, row);
    }
    if (!row.pinIds.includes(p.pinId)) row.pinIds.push(p.pinId);
    row.photos += 1;
    row.bytes += p.bytes || 0;
    totalPhotos += 1;
    totalBytes += p.bytes || 0;
    if (p.status === 'failed') {
      row.needsAttention += 1;
      needsAttention += 1;
    }
  }
  return { floors: [...byFloor.values()], totalPhotos, totalBytes, needsAttention };
}

// ── pre-checks ───────────────────────────────────────────────────────────────

export type ConnectionKind = 'wifi' | 'cellular' | 'none' | 'unknown';

export interface PreCheckInput {
  serverReachable: boolean;
  signedIn: boolean;
  connection: ConnectionKind;
  /** 0..1, or null when the phone does not report it. */
  batteryLevel: number | null;
  charging: boolean | null;
  /** What is about to be sent. */
  bytesToSend: number;
}

export interface PreCheckResult {
  /** Reasons Upload now cannot start. */
  blockers: string[];
  /** Things to confirm, but the person may still go ahead. */
  warnings: string[];
  canStart: boolean;
}

/** More than this over mobile data deserves a warning. */
export const MOBILE_DATA_WARN_BYTES = 50 * 1024 * 1024;
export const LOW_BATTERY = 0.2;
export const CRITICAL_BATTERY = 0.08;

export function evaluatePreChecks(i: PreCheckInput): PreCheckResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (i.connection === 'none') blockers.push('No internet connection. Connect to Wi-Fi or mobile data first.');
  else if (!i.serverReachable) blockers.push('The server cannot be reached right now. Check your connection and try again.');
  if (!i.signedIn) blockers.push('You are signed out. Sign in again. Your photos stay safely on this phone.');

  if (i.connection === 'cellular' && i.bytesToSend > MOBILE_DATA_WARN_BYTES) {
    warnings.push(`You are on mobile data and about ${formatBytes(i.bytesToSend)} will be sent. Wi-Fi is better for this much.`);
  }
  if (i.batteryLevel != null && !i.charging) {
    if (i.batteryLevel < CRITICAL_BATTERY) {
      blockers.push(`Battery is very low (${Math.round(i.batteryLevel * 100)}%). Plug in the charger before uploading.`);
    } else if (i.batteryLevel < LOW_BATTERY) {
      warnings.push(`Battery is low (${Math.round(i.batteryLevel * 100)}%). Plug in the charger so the upload is not cut off.`);
    }
  }
  return { blockers, warnings, canStart: blockers.length === 0 };
}

// ── progress ─────────────────────────────────────────────────────────────────

export interface Progress {
  total: number;
  done: number;
  remaining: number;
  failed: number;
  percent: number;
}

/**
 * `total` is what was waiting when Upload now was tapped. Photos that were added later count too (total grows), so
 * the bar never goes backwards or past 100%.
 */
export function computeProgress(batchTotal: number, unsent: number, failed: number): Progress {
  const total = Math.max(batchTotal, unsent + failed);
  const done = Math.max(0, total - unsent - failed);
  const percent = total === 0 ? 100 : Math.min(100, Math.round((done / total) * 100));
  return { total, done, remaining: unsent, failed, percent };
}

/** Has everything that could be sent been sent? Failed photos are kept for a retry and do not count as pending. */
export function isDrained(unsent: number, writesPending: number): boolean {
  return unsent === 0 && writesPending === 0;
}

/** "Floor 3: 12 of 20 · overall 54 of 200" */
export function describeProgress(p: Progress, floor?: { name: string; done: number; total: number }): string {
  const overall = `overall ${p.done} of ${p.total}`;
  return floor ? `${floor.name}: ${floor.done} of ${floor.total} · ${overall}` : overall;
}
