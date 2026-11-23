import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ActivityAssessment } from '@/services/constructionProgressService';

vi.mock('@mui/icons-material', () => {
  const Icon = () => null;
  return { PhotoLibraryRounded: Icon };
});

import ActivityCard from './ActivityCard';

function activity(over: Partial<ActivityAssessment> = {}): ActivityAssessment {
  return {
    activityId: 'flat.core_punning', name: 'Punning Works', section: 'flat', sequenceIndex: 1, status: 'in_progress',
    completionPct: 60, confidencePct: 80, evidenceCaptureIds: ['c1', 'c2', 'c3'], assessmentStatus: 'in_progress',
    detectionType: 'direct', ...over,
  };
}

const render = (a: ActivityAssessment) =>
  renderToString(
    <MemoryRouter initialEntries={['/construction-progress/fl9']}>
      <Routes>
        <Route path="/construction-progress/:floorId" element={<ActivityCard activity={a} />} />
      </Routes>
    </MemoryRouter>,
  ).replace(/<!-- -->/g, '');

describe('ActivityCard evidence link', () => {
  it('links to the Evidence images page for this activity instead of opening a small popup', () => {
    const html = render(activity());
    expect(html).toContain('View evidence images');
    expect(html).toContain('href="/construction-progress/fl9/evidence?activity=flat.core_punning"');
  });

  it('has no evidence link when the activity has no evidence', () => {
    const html = render(activity({ evidenceCaptureIds: [], evidenceDetails: [] }));
    expect(html).not.toContain('View evidence images');
    expect(html).not.toContain('/evidence?');
  });
});
