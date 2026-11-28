import { describe, expect, it } from 'vitest';
import type { ProjectFloorRow } from '@/services/constructionProgressService';
import {
  buildFloorCsv, filterCounts, floorStatusLabel, isRunActive, matchesFilter, projectHeadline, projectIdsWithCaptures, runLabel, runPct, sortFloors, towerProgress,
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
    row({ floorId: '1', towerId: 'a', status: 'completed', progressPct: 100 }),
    row({ floorId: '2', towerId: 'b', status: 'in_progress', progressPct: 20 }),
    row({ floorId: '3', towerId: 'b', status: 'in_progress', progressPct: 30 }),
    row({ floorId: '4', towerId: 'b', status: 'no_photos', progressPct: 0 }),
    row({ floorId: '5', towerId: 'b', status: 'not_analysed', progressPct: 0 }),
  ];
  it('counts floors by state and towers that are fully complete', () => {
    expect(projectHeadline(floors, towers)).toMatchObject({
      towersTotal: 2, towersCompleted: 1, floorsTotal: 5, floorsCompleted: 1, floorsInProgress: 2, floorsAnalysed: 3,
    });
  });
  it('averages only the floors that have a result, so unphotographed floors do not drag it to zero', () => {
    const h = projectHeadline(floors, towers);
    expect(h.analysedAvgPct).toBe(50); // (100 + 20 + 30) / 3
    expect(h.inProgressAvgPct).toBe(25); // (20 + 30) / 2
  });
  it('has no average, not a fake 0, when nothing has been analysed', () => {
    const h = projectHeadline([row({ status: 'no_photos', progressPct: 0 })], towers);
    expect(h.analysedAvgPct).toBeNull();
    expect(h.inProgressAvgPct).toBeNull();
  });
});

describe('towerProgress', () => {
  const towers = [
    { towerId: 'a', towerName: 'T1', floors: 3, progressPct: 0, completed: 0, inProgress: 0, notStarted: 0, noPhotos: 0 },
    { towerId: 'b', towerName: 'T2', floors: 2, progressPct: 0, completed: 0, inProgress: 0, notStarted: 0, noPhotos: 0 },
  ];
  const floors = [
    row({ floorId: '1', towerId: 'a', status: 'in_progress', progressPct: 20 }),
    row({ floorId: '2', towerId: 'a', status: 'in_progress', progressPct: 40 }),
    row({ floorId: '3', towerId: 'a', status: 'no_photos', progressPct: 0 }),
    row({ floorId: '4', towerId: 'b', status: 'no_photos', progressPct: 0 }),
    row({ floorId: '5', towerId: 'b', status: 'no_photos', progressPct: 0 }),
  ];
  it('averages each tower over its analysed floors', () => {
    const [t1, t2] = towerProgress(floors, towers);
    expect(t1).toMatchObject({ floors: 3, floorsAnalysed: 2, floorsInProgress: 2, progressPct: 30 });
    expect(t2.progressPct).toBeNull();
    expect(t2.floorsAnalysed).toBe(0);
  });
});

describe('projectIdsWithCaptures', () => {
  it('lists each project that has a capture once', () => {
    expect([...projectIdsWithCaptures([{ projectId: 'a' }, { projectId: 'a' }, { projectId: 'b' }, {}])].sort()).toEqual(['a', 'b']);
  });
});
