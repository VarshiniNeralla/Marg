import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { FlatProgress } from '@/services/constructionProgressService';
import FlatSelector from './FlatSelector';

const flat = (over: Partial<FlatProgress>): FlatProgress => ({
  flatName: 'A-101', completionPct: 40, roomsComplete: 1, roomsTotal: 5, rooms: [], coveragePct: 55,
  scopeStatus: 'in_progress', ...over,
});

// React's server renderer splits text with invisible markers; compare what a person would actually read.
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!-- -->/g, '');

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

  it('is clearly a picker: heading, instruction, flat count and the chosen flat marked as viewed', () => {
    const html = renderToString(
      <FlatSelector flats={[flat({ flatName: 'Flat 01' }), flat({ flatName: 'Flat 02' }), flat({ flatName: 'Flat 03' })]} selected="Flat 02" onSelect={() => {}} />,
    );
    expect(html).toContain('Choose a flat');
    expect(visible(html)).toContain('3 flats on this floor');
    expect(visible(html)).toContain('tap one to see its progress');
    expect(html.split('Viewing').length - 1).toBe(1);               // only the chosen flat says "Viewing"
    expect(html.split('aria-selected="true"').length - 1).toBe(1);
    expect(html.split('role="option"').length - 1).toBe(3);         // every configured flat is selectable
  });

  it('lists every flat it is given, even ones with no photos yet', () => {
    const html = renderToString(
      <FlatSelector flats={[flat({ flatName: 'Flat 07', completionPct: 0, scopeStatus: 'no_photos' })]} selected="" onSelect={() => {}} />,
    );
    expect(html).toContain('Flat 07');
    expect(visible(html)).toContain('1 flat on this floor');
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
