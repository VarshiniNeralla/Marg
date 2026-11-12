import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { FlatProgress } from '@/services/constructionProgressService';
import FlatSelector from './FlatSelector';

const flat = (over: Partial<FlatProgress>): FlatProgress => ({
  flatName: 'A-101', completionPct: 40, roomsComplete: 1, roomsTotal: 5, rooms: [], coveragePct: 55,
  scopeStatus: 'in_progress', ...over,
});

describe('FlatSelector', () => {
  it('shows name, verified %, coverage and status wording', () => {
    const html = renderToString(
      <FlatSelector
        flats={[flat({}), flat({ flatName: 'A-102', completionPct: 0, scopeStatus: 'awaiting_evidence', reviewRequired: true })]}
        selected="A-101"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('A-101');
    expect(html).toContain('40%');
    expect(html).toContain('55% coverage');
    expect(html).toContain('Work in progress');
    expect(html).toContain('Awaiting evidence');
    expect(html).toContain('Review needed');
    expect(html).toContain('aria-selected="true"');
  });

  it('never shows 100% unless completed', () => {
    const html = renderToString(<FlatSelector flats={[flat({ completionPct: 100 })]} selected="" onSelect={() => {}} />);
    expect(html).not.toContain('100%');
    const done = renderToString(
      <FlatSelector flats={[flat({ completionPct: 100, scopeStatus: 'completed' })]} selected="" onSelect={() => {}} />,
    );
    expect(done).toContain('100%');
  });
});
