import { describe, expect, it } from 'vitest';
import type { FloorProgressSnapshot, RoomActivityAssessment } from '@/services/constructionProgressService';
import { collectEvidence, evidencePath, evidenceTitle, roomKey, roomsOf } from './evidenceImages';

const detail = (captureId: string, flatName: string, roomName: string, role: 'direct' | 'inferred' = 'direct') => ({
  captureId, role, flatName, roomName, views: ['front'], capturedAt: '2026-11-20T10:00:00Z', confidencePct: 80,
});

function act(activityId: string, ids: string[], over: Partial<RoomActivityAssessment> = {}): RoomActivityAssessment {
  return {
    activityId, activityName: `Name of ${activityId}`, completionPct: 60, confidencePct: 80,
    evidenceCaptureIds: ids, detectionType: 'direct', ...over,
  };
}

function snapshot(over: Partial<FloorProgressSnapshot> = {}): FloorProgressSnapshot {
  return {
    floorName: 'Floor 3',
    activities: [],
    flatProgress: [
      {
        flatName: 'Flat 301', completionPct: 50, roomsComplete: 0, roomsTotal: 2,
        rooms: [
          {
            roomName: 'Bedroom 1', isComplete: false,
            activities: [act('punning', ['a', 'b', 'c', 'd'], { evidenceDetails: ['a', 'b', 'c', 'd'].map(i => detail(i, 'Flat 301', 'Bedroom 1')) })],
          },
          {
            roomName: 'Living', isComplete: false,
            activities: [
              act('punning', ['e'], { evidenceDetails: [detail('e', 'Flat 301', 'Living')] }),
              act('paint', ['p1']),
            ],
          },
        ],
      },
      {
        flatName: 'Common Area', completionPct: 10, roomsComplete: 0, roomsTotal: 1,
        rooms: [{ roomName: 'Lobby', isComplete: false, activities: [act('punning', ['f'], { evidenceDetails: [detail('f', 'Common Area', 'Lobby')] })] }],
      },
    ],
    ...over,
  } as unknown as FloorProgressSnapshot;
}

const ids = (s: FloorProgressSnapshot, activity: string, filter = {}) =>
  collectEvidence(s, activity, filter).items.map(i => i.captureId);

describe('evidencePath', () => {
  it('has the activity and only the filters that were given', () => {
    expect(evidencePath('fl1', 'punning')).toBe('/construction-progress/fl1/evidence?activity=punning');
    expect(evidencePath('fl1', 'punning', { flat: 'Flat 301', room: 'Bedroom 1' }))
      .toBe('/construction-progress/fl1/evidence?activity=punning&flat=Flat+301&room=Bedroom+1');
  });

  it('escapes ids that contain special characters', () => {
    expect(evidencePath('a/b', 'x.y')).toContain('/construction-progress/a%2Fb/evidence');
  });
});

describe('collectEvidence', () => {
  it('gathers every capture from every room, not just the first few', () => {
    const r = collectEvidence(snapshot(), 'punning');
    expect(r.items.map(i => i.captureId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(r.activityName).toBe('Name of punning');
  });

  it('narrows to a flat, and to a room', () => {
    expect(ids(snapshot(), 'punning', { flat: 'Flat 301' })).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids(snapshot(), 'punning', { flat: 'Flat 301', room: 'Living' })).toEqual(['e']);
    expect(ids(snapshot(), 'punning', { flat: 'Common Area' })).toEqual(['f']);
  });

  it('shows each capture once even if two rooms list it', () => {
    const s = snapshot();
    s.flatProgress[0].rooms[1].activities[0] = act('punning', ['a', 'e'], {
      evidenceDetails: [detail('a', 'Flat 301', 'Living'), detail('e', 'Flat 301', 'Living')],
    });
    expect(ids(s, 'punning')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('reads the plain ids of older snapshots that have no detail rows', () => {
    const r = collectEvidence(snapshot(), 'paint');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ captureId: 'p1', flatName: 'Flat 301', roomName: 'Living', role: 'direct' });
  });

  it('only returns the asked activity', () => {
    expect(ids(snapshot(), 'nothing-like-this')).toEqual([]);
  });

  it('falls back to the floor-level list when there is no room data', () => {
    const s = snapshot({ flatProgress: [] });
    s.activities = [{
      activityId: 'punning', name: 'Punning Works', completionPct: 40, confidencePct: 70, evidenceCaptureIds: ['x', 'y'],
      status: 'in_progress', section: 'flat', sequenceIndex: 1,
    } as never];
    const r = collectEvidence(s, 'punning');
    expect(r.items.map(i => i.captureId)).toEqual(['x', 'y']);
    expect(r.activityName).toBe('Punning Works');
  });

  it('does not fall back to floor-level evidence when a room was asked for', () => {
    const s = snapshot();
    s.activities = [{ activityId: 'punning', name: 'P', evidenceCaptureIds: ['zzz'] } as never];
    expect(ids(s, 'punning', { flat: 'Flat 301', room: 'Kitchen' })).toEqual([]);
  });

  it('copes with no snapshot at all', () => {
    expect(collectEvidence(null, 'punning')).toEqual({ activityName: 'Activity', items: [] });
  });
});

describe('titles and rooms', () => {
  it('builds a readable title', () => {
    expect(evidenceTitle({ flatName: 'Flat 301', roomName: 'Living' })).toBe('Flat 301 · Living');
    expect(evidenceTitle({ flatName: '', roomName: 'Living' })).toBe('Living');
    expect(evidenceTitle({ flatName: '', roomName: '' })).toBe('Capture');
  });

  it('counts images per room in order, for the filter chips', () => {
    const items = collectEvidence(snapshot(), 'punning').items;
    expect(roomsOf(items).map(r => [r.label, r.count])).toEqual([
      ['Flat 301 · Bedroom 1', 4], ['Flat 301 · Living', 1], ['Common Area · Lobby', 1],
    ]);
    expect(roomKey(items[0])).toBe(roomsOf(items)[0].key);
  });
});
