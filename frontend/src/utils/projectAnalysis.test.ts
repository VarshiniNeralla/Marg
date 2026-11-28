import { describe, expect, it } from 'vitest';
import type { ProjectFloorRow } from '@/services/constructionProgressService';
import {
  buildFloorCsv, filterCounts, floorStatusLabel, isRunActive, matchesFilter, projectHeadline, projectIdsWithCaptures, runLabel, runPct, sortFloors,
} from './projectAnalysis';

const row = (over: Partial<ProjectFloorRow>): ProjectFloorRow => ({
  floorId: 'f', floorName: 'Floor 1', towerId: 't', towerName: 'Tower A', status: 'in_progress',
  progressPct: 50, coveragePct: 80, ...over,
});

describe('status labels', () => {
  it('uses plain wording for every status', () => {
    expect(floorStatusLabel('completed')).toBe('Completed');
    expect(floorStatusLabel('in_progress')).toBe('In progress');
    expect(floorStatusLabel('not_started')).toBe('Not started');
    expect(floorStatusLabel('no_photos')).toBe('No photos');
    expect(floorStatusLabel('not_analysed')).toBe('Not analysed');
  });
  it('passes an unknown status through', () => {
    expect(floorStatusLabel('weird')).toBe('weird');
  });
});

describe('filters', () => {
  const rows = [
    row({ floorId: '1', status: 'completed' }), row({ floorId: '2' }),
    row({ floorId: '3', status: 'no_photos', progressPct: null }), row({ floorId: '4', status: 'not_analysed' }),
  ];
  it('matches by status, All matches everything', () => {
    expect(rows.filter(r => matchesFilter(r, 'all'))).toHaveLength(4);
    expect(rows.filter(r => matchesFilter(r, 'no_photos'))).toHaveLength(1);
  });
  it('counts per chip', () => {
    expect(filterCounts(rows)).toEqual({ all: 4, completed: 1, in_progress: 1, not_started: 0, no_photos: 1 });
  });
});

describe('sortFloors', () => {
  const rows = [
    row({ floorId: 'a', floorName: 'Floor 10', progressPct: 20 }),
    row({ floorId: 'b', floorName: 'Floor 2', progressPct: null }),
    row({ floorId: 'c', floorName: 'Floor 1', progressPct: 90 }),
  ];
  it('sorts floor names naturally', () => {
    expect(sortFloors(rows, 'floor', 'asc').map(r => r.floorId)).toEqual(['c', 'b', 'a']);
  });
  it('keeps missing progress last in both directions', () => {
    expect(sortFloors(rows, 'progress', 'asc').map(r => r.floorId)).toEqual(['a', 'c', 'b']);
    expect(sortFloors(rows, 'progress', 'desc').map(r => r.floorId)).toEqual(['c', 'a', 'b']);
  });
  it('does not change the input', () => {
    const copy = [...rows];
    sortFloors(rows, 'progress', 'asc');
    expect(rows).toEqual(copy);
  });
});

describe('buildFloorCsv', () => {
  it('writes a header and one line per floor with labels', () => {
    const csv = buildFloorCsv([row({ progressPct: 66.66, lastAnalysedAt: '2026-11-01T10:00:00Z' })]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Tower,Floor,Status,Progress %,Coverage %,Rooms photographed,Rooms total,Captures,Last analysed');
    expect(lines[1]).toBe('Tower A,Floor 1,In progress,66.7,80,,,,2026-11-01T10:00:00Z');
  });
  it('quotes commas and quotes, leaves missing numbers empty', () => {
    const csv = buildFloorCsv([row({ floorName: 'Floor "1", east', progressPct: null, status: 'no_photos' })]);
    expect(csv).toContain('"Floor ""1"", east",No photos,,80');
  });
});

describe('run helpers', () => {
  it('knows when a run is active', () => {
    expect(isRunActive('running')).toBe(true);
    expect(isRunActive('queued')).toBe(true);
    expect(isRunActive('completed')).toBe(false);
    expect(isRunActive(undefined)).toBe(false);
  });
  it('computes percent and caps it', () => {
    expect(runPct({ state: 'running', floorsTotal: 4, floorsDone: 1, floorsFailed: 1 })).toBe(50);
    expect(runPct({ state: 'running', floorsTotal: 0, floorsDone: 0, floorsFailed: 0 })).toBe(0);
    expect(runPct({ state: 'completed', floorsTotal: 2, floorsDone: 5, floorsFailed: 0 })).toBe(100);
    expect(runPct(null)).toBe(0);
  });
  it('words each state', () => {
    expect(runLabel({ state: 'running', floorsTotal: 4, floorsDone: 1, floorsFailed: 0, current: { floorId: 'x', floorName: 'Floor 3' } }))
      .toBe('Analysing Floor 3 (1 of 4 done)');
    expect(runLabel({ state: 'partial', floorsTotal: 4, floorsDone: 3, floorsFailed: 1 })).toBe('3 floors analysed, 1 failed');
    expect(runLabel(null)).toBe('');
  });
  it('names the tower when the run covers one tower only', () => {
    expect(runLabel({ state: 'running', floorsTotal: 3, floorsDone: 1, floorsFailed: 0, towerId: 'tA', towerName: 'Tower A' }))
      .toBe('Tower A: 1 of 3 floors done');
    expect(runLabel({ state: 'completed', floorsTotal: 3, floorsQueued: 2, floorsDone: 2, floorsFailed: 0, towerName: 'Tower A' }))
      .toBe('Tower A: All 2 floors analysed');
    // A whole-project run has no tower and reads as before.
    expect(runLabel({ state: 'completed', floorsTotal: 3, floorsDone: 3, floorsFailed: 0, towerName: '' })).toBe('All 3 floors analysed');
  });
});

describe('projectHeadline', () => {
  const towers = [
    { towerId: 'a', towerName: 'T1', floors: 2, progressPct: 0, completed: 2, inProgress: 0, notStarted: 0, noPhotos: 0 },
    { towerId: 'b', towerName: 'T2', floors: 3, progressPct: 0, completed: 1, inProgress: 1, notStarted: 0, noPhotos: 1 },
  ];
  const floors = [
    row({ floorId: '1', flatsTotal: 4, flatsCompleted: 4, progressPct: 100 }),
    row({ floorId: '2', flatsTotal: 6, flatsCompleted: 0, progressPct: 20 }),
    row({ floorId: '3', status: 'no_photos', progressPct: 0, flatsTotal: 0, flatsCompleted: 0 }),
  ];
  it('counts flats completed against all flats, and towers that are fully complete', () => {
    const h = projectHeadline(floors, towers);
    expect(h).toMatchObject({ towersTotal: 2, towersCompleted: 1, flatsTotal: 10, flatsCompleted: 4, floorsCounted: 2 });
    expect(h.flatsCompletedPct).toBe(40);
  });
  it('weights each floor progress by its number of flats', () => {
    // (100*4 + 20*6) / 10 = 52
    expect(projectHeadline(floors, towers).avgFlatProgressPct).toBe(52);
  });
  it('is zero, not an error, when nothing has been analysed', () => {
    const h = projectHeadline([row({ status: 'no_photos', progressPct: 0, flatsTotal: 0 })], towers);
    expect(h.flatsTotal).toBe(0);
    expect(h.flatsCompletedPct).toBe(0);
    expect(h.avgFlatProgressPct).toBeNull();
  });
});

describe('projectIdsWithCaptures', () => {
  it('lists each project that has a capture once', () => {
    expect([...projectIdsWithCaptures([{ projectId: 'a' }, { projectId: 'a' }, { projectId: 'b' }, {}])].sort()).toEqual(['a', 'b']);
  });
});
