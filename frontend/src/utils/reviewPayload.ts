import type { ProgressReviewCreate } from '@/services/constructionProgressService';

export type ReviewMode = 'accept' | 'completed' | 'in_progress' | 'correct';

export interface ReviewTarget {
  snapshotId: string;
  floorId: string;
  flatName: string;
  roomName: string;
  activityId: string;
}

export interface ReviewInput {
  mode: ReviewMode;
  /** Percentage text/number for in_progress (1-99) and correct (0-100); ignored otherwise. */
  pct?: number | string | null;
  reason: string;
  note?: string;
}

export type ReviewPayloadResult =
  | { ok: true; payload: ProgressReviewCreate }
  | { ok: false; error: string };

function parsePct(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/**
 * Builds the review request. "Accept" never carries a percentage (the AI value stands); every other mode is a
 * correction ("wrong") with an explicit percentage. The backend keeps the AI value separately.
 */
export function buildReviewPayload(target: ReviewTarget, input: ReviewInput): ReviewPayloadResult {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: 'A reason is required.' };
  const note = input.note?.trim() || undefined;

  const base = {
    snapshotId: target.snapshotId,
    floorId: target.floorId,
    flatName: target.flatName,
    roomName: target.roomName,
    roomCorrect: 'yes' as const,
    ...(note ? { note } : {}),
  };

  if (input.mode === 'accept') {
    return {
      ok: true,
      payload: {
        ...base,
        progressVerdict: 'correct',
        activityCorrections: [{ activityId: target.activityId, verdict: 'correct', note: reason }],
      },
    };
  }

  let pct: number | null;
  if (input.mode === 'completed') {
    pct = 100;
  } else if (input.mode === 'in_progress') {
    pct = parsePct(input.pct);
    if (pct === null || pct < 1 || pct > 99) return { ok: false, error: 'Enter a whole percentage from 1 to 99.' };
  } else {
    pct = parsePct(input.pct);
    if (pct === null || pct < 0 || pct > 100) return { ok: false, error: 'Enter a whole percentage from 0 to 100.' };
  }

  return {
    ok: true,
    payload: {
      ...base,
      progressVerdict: 'wrong',
      activityCorrections: [
        { activityId: target.activityId, verdict: 'wrong', correctPercentage: pct, note: reason },
      ],
    },
  };
}
