import { describe, expect, it } from 'vitest';
import {
  UNABLE_TO_DETERMINE, aiEstimate, assessmentLabel, countNeedingReview, coverageText, detectionLabel,
  formatPct, inferredTooltip, notObservedCount, observedText, resolveAssessmentStatus, resolveScopeStatus,
  reviewBannerText, roomCoverageText, safePct, scopeLabel, showsPercent,
} from './progressDisplay';

describe('assessment status', () => {
  it('uses the exact wording', () => {
    expect(assessmentLabel('not_started')).toBe('Not started');
    expect(assessmentLabel('in_progress')).toBe('In progress');
    expect(assessmentLabel('mostly_complete')).toBe('Mostly complete');
    expect(assessmentLabel('completed')).toBe('Completed');
    expect(assessmentLabel('unable_to_determine')).toBe(UNABLE_TO_DETERMINE);
  });

  it('never shows a percentage for unable_to_determine, even though the payload carries 0', () => {
    expect(showsPercent('unable_to_determine')).toBe(false);
    for (const s of ['not_started', 'in_progress', 'mostly_complete', 'completed'] as const) {
      expect(showsPercent(s)).toBe(true);
    }
  });

  it('prefers the server status and maps legacy statuses when it is missing', () => {
    expect(resolveAssessmentStatus({ assessmentStatus: 'mostly_complete', status: 'in_progress' })).toBe('mostly_complete');
    expect(resolveAssessmentStatus({ status: 'completed' })).toBe('completed');
    expect(resolveAssessmentStatus({ status: 'in_progress' })).toBe('in_progress');
    expect(resolveAssessmentStatus({ status: 'no_evidence' })).toBe('not_started');
    expect(resolveAssessmentStatus({ status: 'not_assessed' })).toBe('unable_to_determine');
    expect(resolveAssessmentStatus({ status: 'not_observable' })).toBe('unable_to_determine');
    expect(resolveAssessmentStatus({ completionPct: 40 })).toBe('in_progress');
    expect(resolveAssessmentStatus({ completionPct: 0 })).toBe('unable_to_determine');
  });
});

describe('percentages', () => {
  it('never prints 100% unless completed', () => {
    expect(safePct(100, false)).toBe(99);
    expect(safePct(99.6, false)).toBe(99);
    expect(safePct(100, true)).toBe(100);
    expect(safePct(42.4, false)).toBe(42);
  });

  it('formats missing values as a dash, not 0%', () => {
    expect(formatPct(undefined)).toBe('—');
    expect(formatPct(null)).toBe('—');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(33.6)).toBe('34%');
  });
});

describe('scope status', () => {
  it('uses the new wording', () => {
    expect(scopeLabel('completed')).toBe('Completed');
    expect(scopeLabel('in_progress')).toBe('Work in progress');
    expect(scopeLabel('not_started')).toBe('Not started');
    expect(scopeLabel('awaiting_evidence')).toBe('Awaiting evidence');
    expect(scopeLabel('no_photos')).toBe('No photos');
  });

  it('falls back to the old fields only when scopeStatus is missing', () => {
    expect(resolveScopeStatus({ scopeStatus: 'not_started', isComplete: true })).toBe('not_started');
    expect(resolveScopeStatus({ isComplete: true })).toBe('completed');
    expect(resolveScopeStatus({ activities: [{}] })).toBe('in_progress');
    expect(resolveScopeStatus({ capturesCount: 2, activities: [] })).toBe('awaiting_evidence');
    expect(resolveScopeStatus({ activities: [] })).toBe('no_photos');
  });
});

describe('detection', () => {
  it('labels each type', () => {
    expect(detectionLabel('direct')).toBe('Detected');
    expect(detectionLabel('inferred')).toBe('Inferred');
    expect(detectionLabel('manual')).toBe('Verified by manager');
    expect(detectionLabel(undefined)).toBeNull();
  });

  it('names the later activity an inference came from, else a generic phrase', () => {
    const sibs = [{ activityId: 'paint', activityName: 'Wall painting' }];
    expect(inferredTooltip('paint', sibs)).toBe('Inferred from Wall painting');
    expect(inferredTooltip('zzz', sibs)).toMatch(/^Inferred from/);
    expect(inferredTooltip('zzz', sibs)).not.toContain('Wall painting');
    expect(inferredTooltip(undefined)).toMatch(/^Inferred from/);
  });
});

describe('coverage and review helpers', () => {
  it('formats coverage', () => {
    expect(coverageText(61.4)).toBe('61% coverage');
    expect(coverageText(undefined)).toBeNull();
    expect(observedText(12, 14)).toBe('12 of 14 activities observed');
    expect(observedText(undefined, 14)).toBeNull();
    expect(notObservedCount(12, 14)).toBe(2);
    expect(notObservedCount(14, 12)).toBe(0);
    expect(roomCoverageText(50)).toBe('Observed in 50% of applicable rooms');
  });

  it('counts and words the review banner', () => {
    expect(countNeedingReview([{ reviewRequired: true }, {}, { reviewRequired: true }])).toBe(2);
    expect(reviewBannerText(1)).toBe('1 activity needs review');
    expect(reviewBannerText(3)).toBe('3 activities need review');
  });

  it('reads the AI estimate from either field', () => {
    expect(aiEstimate({ aiCompletionPct: 30 })).toBe(30);
    expect(aiEstimate({ override: { pct: 90, verdict: 'wrong', reason: '', by: '', at: '', aiPct: 20 } })).toBe(20);
    expect(aiEstimate({})).toBeNull();
  });
});
