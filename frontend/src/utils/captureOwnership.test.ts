import { describe, expect, it } from 'vitest';
import {
  filterOwnCaptures,
  filterOwnTours,
  isOwnCapture,
  isOwnTour,
  pinCaptureIdsForUser,
  pinHasOwnCapture,
} from './captureOwnership';
import type { MockCapture, MockTour } from '@/data/mockData';

const alice = { id: 'u-alice', name: 'Alice Kumar' };
const bob = { id: 'u-bob', name: 'Bob Singh' };

function cap(partial: Partial<MockCapture> & { id: string }): MockCapture {
  return {
    roomId: 'r1',
    roomName: 'Kitchen',
    projectId: 'p1',
    projectName: 'Site',
    towerId: 't1',
    towerName: 'Tower A',
    floorLabel: 'Floor 1',
    status: 'review',
    reviewStatus: 'uploaded',
    uploadedBy: 'Alice Kumar',
    uploadedAt: 'now',
    reviewedBy: null,
    reviewNotes: null,
    assignedTo: null,
    fileCount: 1,
    sizeMb: 1,
    gradient: '',
    ...partial,
  };
}

describe('isOwnCapture', () => {
  it('matches by uploadedByUserId even when names differ', () => {
    const c = cap({ id: 'c1', uploadedBy: 'Old Name', uploadedByUserId: 'u-alice' });
    expect(isOwnCapture(c, alice)).toBe(true);
    expect(isOwnCapture(c, bob)).toBe(false);
  });

  it('falls back to display name for legacy captures without a user id', () => {
    const c = cap({ id: 'c2', uploadedBy: 'Bob Singh' });
    expect(isOwnCapture(c, bob)).toBe(true);
    expect(isOwnCapture(c, alice)).toBe(false);
  });
});

describe('filterOwnCaptures / pin view', () => {
  it('hides other users captures from a new engineer', () => {
    const captures = [
      cap({ id: 'c-a', uploadedByUserId: 'u-alice', uploadedBy: 'Alice Kumar' }),
      cap({ id: 'c-b', uploadedByUserId: 'u-bob', uploadedBy: 'Bob Singh' }),
    ];
    expect(filterOwnCaptures(captures, bob).map(c => c.id)).toEqual(['c-b']);
    expect(pinHasOwnCapture(['c-a', 'c-b'], new Set(['c-b']))).toBe(true);
    expect(pinHasOwnCapture(['c-a'], new Set(['c-b']))).toBe(false);
    expect(pinCaptureIdsForUser(['c-a', 'c-b'], new Set(['c-b']))).toEqual(['c-b']);
  });
});

describe('isOwnTour / filterOwnTours', () => {
  function tour(partial: Partial<MockTour> & { id: string }): MockTour {
    return {
      captureId: 'c1',
      roomId: 'r1',
      roomName: 'Kitchen',
      projectId: 'p1',
      projectName: 'Site',
      towerId: 't1',
      towerName: 'Tower A',
      floorLabel: 'Floor 1',
      status: 'published',
      captures: 1,
      lastCapture: 'now',
      gradient: '',
      viewCount: 0,
      ...partial,
    };
  }

  it('matches tours by uploadedByUserId', () => {
    const mine = tour({ id: 't1', floorPlanId: 'fp1', uploadedByUserId: 'u-alice' });
    const theirs = tour({ id: 't2', floorPlanId: 'fp1', uploadedByUserId: 'u-bob' });
    expect(isOwnTour(mine, alice)).toBe(true);
    expect(isOwnTour(theirs, alice)).toBe(false);
  });

  it('filters tours so engineers only see their walkthroughs', () => {
    const tours = [
      tour({ id: 't-a', uploadedByUserId: 'u-alice', uploadedBy: 'Alice Kumar' }),
      tour({ id: 't-b', uploadedByUserId: 'u-bob', uploadedBy: 'Bob Singh' }),
    ];
    expect(filterOwnTours(tours, bob).map(t => t.id)).toEqual(['t-b']);
  });
});
