import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { SummaryCards } from '@/services/constructionProgressService';
import FloorOverviewHero, { ratioFact } from './FloorOverviewHero';

const cards: SummaryCards = {
  roomsCompleted: 5, roomsInProgress: 95, roomsNotStarted: 64,
  activitiesCompleted: 0, activitiesInProgress: 17, activitiesNotStarted: 3,
  imagesAnalyzed: 153, lastInspection: '2026-11-19T11:26:00Z', avgConfidencePct: 80, coveragePct: 48,
};

// React's server renderer splits text with invisible markers; compare what a person would actually read.
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!-- -->/g, '');
const count = (html: string, needle: string) => visible(html).split(needle).length - 1;

describe('FloorOverviewHero', () => {
  it('shows the floor percentage exactly once', () => {
    const html = renderToString(<FloorOverviewHero overallProgressPct={21} overallStatus="in_progress" cards={cards} analysedAt="2026-11-19T11:26:00Z" />);
    expect(count(html, '21%')).toBe(1);
  });

  it('shows the plain facts without repeating progress', () => {
    const html = renderToString(<FloorOverviewHero overallProgressPct={21} overallStatus="in_progress" cards={cards} />);
    const v = visible(html);
    expect(v).toContain('Rooms assessed');
    expect(v).toContain('100 of 164');
    expect(v).toContain('Activities assessed');
    expect(v).toContain('17 of 20');
    expect(v).toContain('Photo coverage');
    expect(v).toContain('48%');
    expect(v).toContain('153 photos analysed');
    expect(html).toContain('Work in progress');
  });

  it('says Completed when the floor is complete and copes with missing coverage', () => {
    const html = renderToString(<FloorOverviewHero overallProgressPct={100} overallStatus="completed" cards={{ ...cards, coveragePct: undefined }} />);
    expect(html).toContain('Completed');
    expect(html).toContain('—');
  });

  it('counts assessed as done plus in progress, out of everything', () => {
    expect(ratioFact(5, 95, 64)).toEqual({ assessed: 100, total: 164, text: '100 of 164' });
    expect(ratioFact(0, 0, 0).text).toBe('0 of 0');
  });
});
