import type { ProgressReviewCreate } from '@/services/constructionProgressService';

export type ReviewMode = 'accept' | 'completed' | 'in_progress' | 'correct';

export interface ReviewTarget {
  snapshotId: string;
  floorId: string;
  flatName: string;
  roomName: string;
  activityId: string;
}

/** What went wrong, when the reviewer changes the AI's value. Optional; stored so mistakes can be grouped by kind. */
export const REASON_CODES: { value: string; label: string }[] = [
  { value: 'ai_misread', label: 'AI misread the work' },
  { value: 'not_enough_photos', label: 'Not enough photos' },
  { value: 'not_visible', label: 'Work not visible' },
  { value: 'wrong_room', label: 'Wrong room' },
  { value: 'other', label: 'Other' },
];

export interface ReviewInput {
  mode: ReviewMode;
  /** Percentage text/number for in_progress (1-99) and correct (0-100); ignored otherwise. */
  pct?: number | string | null;
  reason: string;
  note?: string;
  /** One of REASON_CODES (ignored for "accept", where nothing was wrong). */
  reasonCode?: string;
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
        {
          activityId: target.activityId, verdict: 'wrong', correctPercentage: pct, note: reason,
          ...(input.reasonCode && REASON_CODES.some(r => r.value === input.reasonCode) ? { reasonCode: input.reasonCode } : {}),
        },
      ],
    },
  };
}
