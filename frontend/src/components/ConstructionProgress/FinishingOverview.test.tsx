import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import FinishingOverview from './FinishingOverview';

const summary = { progressPct: 41, estimatePct: 66, coveragePct: 62, total: 8, completed: 2, inProgress: 3, awaitingEvidence: 1, notStarted: 2 };

describe('FinishingOverview', () => {
  it('renders server numbers and counts', () => {
    const html = renderToString(<FinishingOverview summary={summary} />);
    expect(html).toContain('Verified progress');
    expect(html).toContain('41%');
    expect(html).toContain('Estimate on observed work');
    expect(html).toContain('66%');
    expect(html).toContain('Coverage');
    expect(html).toContain('62%');
    expect(html).toContain('Completed flats');
    expect(html).toContain('Awaiting sufficient evidence');
    expect(html).toContain('Not started');
    expect(html).toContain('>3<');
  });

  it('uses region wording on the common page', () => {
    expect(renderToString(<FinishingOverview summary={summary} isCommon />)).toContain('Completed regions');
  });

  it('is hidden without a summary or with an empty one', () => {
    expect(renderToString(<FinishingOverview summary={undefined} />)).toBe('');
    expect(renderToString(<FinishingOverview summary={{}} />)).toBe('');
  });
});
