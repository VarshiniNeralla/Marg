import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { RoomActivityAssessment } from '@/services/constructionProgressService';

vi.mock('@mui/icons-material', () => {
  const Icon = () => null;
  return { PhotoLibraryRounded: Icon };
});

import RoomActivityRow from './RoomActivityRow';

function act(over: Partial<RoomActivityAssessment> = {}): RoomActivityAssessment {
  return {
    activityId: 'tiling', activityName: 'Floor tiling', completionPct: 60, confidencePct: 80,
    evidenceCaptureIds: [], assessmentStatus: 'in_progress', detectionType: 'direct',
    evidenceDetails: [], ...over,
  };
}
const render = (a: RoomActivityAssessment, extra: Record<string, unknown> = {}) =>
  renderToString(<RoomActivityRow activity={a} siblings={[a]} {...extra} />).replace(/<!-- -->/g, '');

describe('RoomActivityRow', () => {
  it('unable_to_determine shows the words, no bar and no percentage', () => {
    const html = render(act({ assessmentStatus: 'unable_to_determine', completionPct: 0, confidencePct: 0 }));
    expect(html).toContain('Unable to determine');
    expect(html).not.toContain('0%');
    expect(html).not.toContain('role="progressbar"');
  });

  it('shows status, bar and percentage when determined', () => {
    const html = render(act());
    expect(html).toContain('In progress');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('60%');
    expect(html).toContain('Detected');
  });

  it('shows an inferred chip', () => {
    const html = render(act({ detectionType: 'inferred', inferredFrom: 'paint' }));
    expect(html).toContain('Inferred');
  });

  it('manual override shows the AI value, reason and manager', () => {
    const html = render(act({
      detectionType: 'manual', completionPct: 100, assessmentStatus: 'completed', aiCompletionPct: 35,
      override: { pct: 100, verdict: 'wrong', reason: 'Site visit', by: 'Meera', at: '2026-11-10T08:30:00Z', aiPct: 35 },
    }));
    expect(html).toContain('Verified by manager');
    expect(html).toContain('AI estimated 35%');
    expect(html).toContain('Site visit');
    expect(html).toContain('Meera');
  });

  it('has no evidence button without evidence details', () => {
    const html = render(act(), { onOpenEvidence: () => {} });
    expect(html).not.toContain('Evidence (');
  });

  it('shows the evidence button with a count when details exist', () => {
    const d = { captureId: 'c1', role: 'direct' as const, flatName: 'A', roomName: 'B', views: [], capturedAt: null, confidencePct: 90 };
    const html = render(act({ evidenceDetails: [d, { ...d, captureId: 'c2' }] }), { onOpenEvidence: () => {} });
    expect(html).toContain('Evidence (2)');
  });

  it('shows a Needs review chip with the reason', () => {
    const html = render(act({ reviewRequired: true, reviewReason: 'Low confidence photo' }));
    expect(html).toContain('Needs review');
    expect(html).toContain('Low confidence photo');
  });

  it('lists seen and missing indicators and the explanation', () => {
    const html = render(act({ explanation: 'Tiles laid, grout pending', visualIndicatorsFound: ['Tiles'], visualIndicatorsMissing: ['Grout'] }));
    expect(html).toContain('Tiles laid, grout pending');
    expect(html).toContain('Seen / Missing');
    expect(html).toContain('Grout');
  });

  it('offers Review only to reviewers', () => {
    expect(render(act(), { canReview: true, onReview: () => {} })).toContain('>Review<');
    expect(render(act(), { canReview: false, onReview: () => {} })).not.toContain('>Review<');
  });
});
