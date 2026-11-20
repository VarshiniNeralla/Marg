import { describe, expect, it } from 'vitest';
import type { FlatProgress } from '@/services/constructionProgressService';
import { flatSummaryLine } from './FlatFinishingWorksPage';

const flat = (over: Partial<FlatProgress>): FlatProgress => ({
  flatName: 'Flat 02', completionPct: 31, roomsComplete: 0, roomsTotal: 22, rooms: [],
  roomsPhotographed: 15, roomsRequired: 22, lastInspection: '2026-11-19T11:26:00Z', ...over,
});

describe('flatSummaryLine', () => {
  it('is one plain line of facts, with no percentage in it', () => {
    const line = flatSummaryLine(flat({}), false);
    expect(line).toContain('15 of 22 rooms photographed');
    expect(line).toContain('0 of 22 complete');
    expect(line).toContain('last inspection');
    expect(line).not.toContain('%');
  });

  it('uses "regions" for the common area and copes with older snapshots that have no photographed count', () => {
    expect(flatSummaryLine(flat({}), true)).toContain('regions photographed');
    const old = flatSummaryLine(flat({ roomsPhotographed: undefined, roomsRequired: undefined, lastInspection: undefined }), false);
    expect(old).toBe('22 rooms · 0 of 22 complete');
  });
});
