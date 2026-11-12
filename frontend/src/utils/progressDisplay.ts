import { colors } from '@theme/tokens';
import type {
  ActivityAssessment,
  AssessmentStatus,
  DetectionType,
  RoomActivityAssessment,
  ScopeStatus,
} from '@/services/constructionProgressService';

/**
 * Pure display helpers for server-owned progress numbers. Nothing here computes progress: it only chooses
 * wording, colours and formatting. Unknown is never shown as zero, and 100% is shown only when the server
 * says the scope is completed.
 */

export const UNABLE_TO_DETERMINE = 'Unable to determine';

// ---------------------------------------------------------------------------------------------------------
// Assessment status (per activity)
// ---------------------------------------------------------------------------------------------------------

export const ASSESSMENT_LABELS: Record<AssessmentStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  mostly_complete: 'Mostly complete',
  completed: 'Completed',
  unable_to_determine: UNABLE_TO_DETERMINE,
};

export function assessmentLabel(status: AssessmentStatus): string {
  return ASSESSMENT_LABELS[status] ?? UNABLE_TO_DETERMINE;
}

export function assessmentColor(status: AssessmentStatus): { fg: string; bg: string } {
  switch (status) {
    case 'completed': return { fg: colors.success, bg: colors.successBg };
    case 'mostly_complete': return { fg: colors.success, bg: colors.successBg };
    case 'in_progress': return { fg: colors.warning, bg: colors.warningBg };
    case 'not_started': return { fg: colors.textMuted, bg: colors.bgDeep };
    default: return { fg: colors.textSubdued, bg: colors.bgDeep };
  }
}

/** Only a determined status may show a bar and a percentage: unknown is not 0%. */
export function showsPercent(status: AssessmentStatus): boolean {
  return status !== 'unable_to_determine';
}

interface LegacyShape {
  assessmentStatus?: AssessmentStatus;
  status?: string;
  completionPct?: number;
}

/** Older snapshots lack assessmentStatus: map the legacy status. Unknown/unobserved stays unknown. */
export function resolveAssessmentStatus(a: LegacyShape): AssessmentStatus {
  if (a.assessmentStatus) return a.assessmentStatus;
  switch (a.status) {
    case 'completed': return 'completed';
    case 'in_progress': return 'in_progress';
    case 'no_evidence': return 'not_started';
    case 'not_assessed':
    case 'not_observable':
      return 'unable_to_determine';
    default:
      return (a.completionPct ?? 0) > 0 ? 'in_progress' : 'unable_to_determine';
  }
}

/** Never print 100% for anything the server has not marked completed. */
export function safePct(pct: number, completed: boolean): number {
  const r = Math.round(pct);
  if (!completed && r >= 100) return 99;
  return Math.max(0, r);
}

export function formatPct(pct: number | null | undefined): string {
  return typeof pct === 'number' && Number.isFinite(pct) ? `${Math.round(pct)}%` : '—';
}

// ---------------------------------------------------------------------------------------------------------
// Scope status (room / flat)
// ---------------------------------------------------------------------------------------------------------

export const SCOPE_LABELS: Record<ScopeStatus, string> = {
  completed: 'Completed',
  in_progress: 'Work in progress',
  not_started: 'Not started',
  awaiting_evidence: 'Awaiting evidence',
  no_photos: 'No photos',
};

export function scopeLabel(status: ScopeStatus | undefined): string {
  return status ? SCOPE_LABELS[status] ?? 'No photos' : 'No photos';
}

export function scopeColor(status: ScopeStatus | undefined): { fg: string; bg: string } {
  switch (status) {
    case 'completed': return { fg: colors.success, bg: colors.successBg };
    case 'in_progress': return { fg: colors.warning, bg: colors.warningBg };
    case 'awaiting_evidence': return { fg: colors.info, bg: colors.infoBg };
    default: return { fg: colors.textSubdued, bg: colors.bgDeep };
  }
}

/** Fallback for snapshots without scopeStatus: only what the old fields literally say. */
export function resolveScopeStatus(r: {
  scopeStatus?: ScopeStatus;
  isComplete?: boolean;
  isFullyComplete?: boolean;
  capturesCount?: number;
  pinNumbers?: number[];
  activities?: unknown[];
}): ScopeStatus {
  if (r.scopeStatus) return r.scopeStatus;
  if (r.isComplete || r.isFullyComplete) return 'completed';
  const hasCaptures = (r.capturesCount ?? 0) > 0 || (r.pinNumbers?.length ?? 0) > 0;
  if ((r.activities?.length ?? 0) > 0) return 'in_progress';
  return hasCaptures ? 'awaiting_evidence' : 'no_photos';
}

// ---------------------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------------------

export function detectionLabel(type: DetectionType | undefined): string | null {
  switch (type) {
    case 'direct': return 'Detected';
    case 'inferred': return 'Inferred';
    case 'manual': return 'Verified by manager';
    case 'mixed': return 'Detected and inferred';
    default: return null;
  }
}

/** "Inferred from <later activity>" using the activities in the same room, else a generic phrase. */
export function inferredTooltip(
  inferredFrom: string | undefined,
  siblings: ReadonlyArray<{ activityId: string; activityName: string }> = [],
): string {
  const src = inferredFrom ? siblings.find(s => s.activityId === inferredFrom) : undefined;
  return src
    ? `Inferred from ${src.activityName}`
    : 'Inferred from a later activity that could be seen';
}

// ---------------------------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------------------------

export function coverageText(pct: number | undefined | null): string | null {
  return typeof pct === 'number' && Number.isFinite(pct) ? `${Math.round(pct)}% coverage` : null;
}

export function observedText(observed: number | undefined, applicable: number | undefined): string | null {
  if (typeof observed !== 'number' || typeof applicable !== 'number' || applicable <= 0) return null;
  return `${observed} of ${applicable} activities observed`;
}

export function notObservedCount(observed: number | undefined, applicable: number | undefined): number {
  if (typeof observed !== 'number' || typeof applicable !== 'number') return 0;
  return Math.max(0, applicable - observed);
}

/** Floor-level activity: "observed in N% of applicable rooms". */
export function roomCoverageText(pct: number | undefined | null): string | null {
  return typeof pct === 'number' && Number.isFinite(pct)
    ? `Observed in ${Math.round(pct)}% of applicable rooms`
    : null;
}

// ---------------------------------------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------------------------------------

export function countNeedingReview(activities: ReadonlyArray<{ reviewRequired?: boolean }>): number {
  return activities.reduce((n, a) => n + (a.reviewRequired ? 1 : 0), 0);
}

export function reviewBannerText(count: number): string {
  return `${count} ${count === 1 ? 'activity needs' : 'activities need'} review`;
}

/** The AI's own estimate behind a manager override, when known. */
export function aiEstimate(a: Pick<RoomActivityAssessment, 'aiCompletionPct' | 'override'>): number | null {
  const v = a.aiCompletionPct ?? a.override?.aiPct;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function hasEvidenceDetails(a: Pick<ActivityAssessment, 'evidenceDetails'>): boolean {
  return (a.evidenceDetails?.length ?? 0) > 0;
}
