import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { RoomProgress } from '@/services/constructionProgressService';

vi.mock('@mui/icons-material', () => ({ ExpandMoreRounded: () => null, PhotoLibraryRounded: () => null }));

import RoomRow, { roomFacts } from './RoomRow';

const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!-- -->/g, '');

const activity = { activityId: 'a1', activityName: 'Screed Works', status: 'in_progress' } as unknown as RoomProgress['activities'][number];

const room: RoomProgress = {
  roomName: 'Kitchen', isComplete: false, activities: [activity], pinNumbers: [3, 4], capturesCount: 2,
  progressPct: 64, coveragePct: 85, observedActivities: 7, applicableActivities: 11, estimatePct: 100,
  scopeStatus: 'in_progress', lastInspection: '2026-11-19T08:30:00Z',
};

describe('RoomRow', () => {
  it('is one quiet line: name, pins and the percentage, with none of the small print', () => {
    const text = visible(renderToString(<RoomRow room={room} onOpenEvidence={() => {}} />));
    expect(text).toContain('Kitchen');
    expect(text).toContain('Pins 3, 4');
    expect(text).toContain('64%');
    // the details are behind a tap, not printed on every room
    expect(text).not.toContain('Estimate on observed work');
    expect(text).not.toContain('Last inspection');
    expect(text).not.toContain('activities observed');
    expect(text).not.toContain('Show details');
  });

  it('can be opened when it has activities, and shows the percentage only once', () => {
    const html = renderToString(<RoomRow room={room} onOpenEvidence={() => {}} />);
    expect(html).toContain('aria-expanded="false"');
    expect(visible(html).split('64%').length - 1).toBe(1);
  });

  it('opens straight to the details when asked, with the facts that used to be on the card', () => {
    const text = visible(renderToString(<RoomRow room={room} defaultExpanded onOpenEvidence={() => {}} />));
    expect(text).toContain('Work in progress');
    expect(text).toContain('7 of 11 activities observed');
    expect(text).toContain('Estimate on observed work 100%');
    expect(text).toContain('4 not observed');
    expect(text).toContain('Last inspection');
  });

  it('a room with no photos shows a dash, cannot be opened and never invents a percentage', () => {
    const html = renderToString(<RoomRow room={{ roomName: 'Hall', isComplete: false, activities: [] }} onOpenEvidence={() => {}} />);
    const text = visible(html);
    expect(text).toContain('Hall');
    expect(text).toContain('—');
    expect(text).not.toContain('0%');
    expect(html).not.toContain('aria-expanded');
  });

  it('flags a room that needs review with a small marker', () => {
    const html = renderToString(<RoomRow room={{ ...room, activities: [{ ...activity, reviewRequired: true, reviewReason: 'Photo too dark' }] }} onOpenEvidence={() => {}} />);
    expect(html).toContain('aria-label="Needs review"');
  });

  it('does not flag a room for automatic notes such as disagreeing captures', () => {
    const noisy = { ...activity, reviewRequired: true, reviewReason: 'Captures of this room disagree (0% to 100%); the lower reading is used until a manager confirms.' };
    const html = renderToString(<RoomRow room={{ ...room, reviewRequired: true, activities: [noisy] }} onOpenEvidence={() => {}} />);
    expect(html).not.toContain('aria-label="Needs review"');
  });

  it('roomFacts lists status, observed, estimate, missing and last inspection', () => {
    const facts = roomFacts(room);
    expect(facts[0]).toBe('Work in progress');
    expect(facts).toContain('7 of 11 activities observed');
    expect(facts.join(' ')).toContain('4 not observed');
  });
});
