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
  it('is one compact pill per flat: name and its own percentage, nothing else', () => {
    const html = renderToString(
      <FlatSelector flats={[flat({ flatName: 'Flat 01' }), flat({ flatName: 'Flat 02', completionPct: 31 })]} selected="Flat 01" onSelect={() => {}} />,
    );
    const text = visible(html);
    expect(text).toContain('Choose a flat');
    expect(text).toContain('Flat 01');
    expect(text).toContain('40%');
    expect(text).toContain('Flat 02');
    expect(text).toContain('31%');
    // the per-flat clutter that used to be printed on every flat is gone
    expect(text).not.toContain('coverage');
    expect(text).not.toContain('Verified progress');
    expect(text).not.toContain('Awaiting evidence');
    expect(text).not.toContain('Work in progress');
  });

  it('marks exactly the chosen flat as selected and keeps every flat selectable', () => {
    const html = renderToString(
      <FlatSelector flats={[flat({ flatName: 'Flat 01' }), flat({ flatName: 'Flat 02' }), flat({ flatName: 'Flat 03' })]} selected="Flat 02" onSelect={() => {}} />,
    );
    expect(html.split('aria-selected="true"').length - 1).toBe(1);
    expect(html.split('role="option"').length - 1).toBe(3);
  });

  it('shows a small review marker only for flats that need review', () => {
    const html = renderToString(
      <FlatSelector flats={[flat({ flatName: 'Flat 01' }), flat({ flatName: 'Flat 02', rooms: [{ roomName: 'Hall', activities: [{ activityId: 'a', reviewRequired: true, reviewReason: 'Photo too dark' }] }] as never })]} selected="" onSelect={() => {}} />,
    );
    expect(html.split('aria-label="Needs review"').length - 1).toBe(1);
  });

  it('never shows 100% unless completed', () => {
    const html = renderToString(<FlatSelector flats={[flat({ completionPct: 100 })]} selected="" onSelect={() => {}} />);
    expect(visible(html)).not.toContain('100%');
    const done = renderToString(
      <FlatSelector flats={[flat({ completionPct: 100, scopeStatus: 'completed' })]} selected="" onSelect={() => {}} />,
    );
    expect(visible(done)).toContain('100%');
  });
});
