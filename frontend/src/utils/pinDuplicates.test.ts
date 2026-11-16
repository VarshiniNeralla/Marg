import { describe, expect, it } from 'vitest';
import { distinctPointCount, findDuplicateGroups, isSamePlace } from './pinDuplicates';

const pin = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ id, x, y, floorPlanId: 'fp1', flatName: 'Flat 01', roomName: 'Living', captureIds: [], sequenceNumber: Number(id.replace(/\D/g, '')) || 0, ...extra });

describe('stacked duplicate capture points', () => {
  it('counts points on top of each other once', () => {
    const pins = [pin('p1', 10, 10), pin('p2', 10.1, 10.05), pin('p3', 50, 50)];
    expect(distinctPointCount(pins)).toBe(2);
    expect(findDuplicateGroups(pins)).toHaveLength(1);
  });

  it('does not treat different rooms, different plans or distant points as duplicates', () => {
    expect(isSamePlace(pin('a', 10, 10), pin('b', 10, 10, { roomName: 'Kitchen' }))).toBe(false);
    expect(isSamePlace(pin('a', 10, 10), pin('b', 10, 10, { floorPlanId: 'fp2' }))).toBe(false);
    expect(isSamePlace(pin('a', 10, 10), pin('b', 12, 10))).toBe(false);
    expect(distinctPointCount([pin('a', 10, 10), pin('b', 12, 10)])).toBe(2);
  });

  it('keeps the point with photos and never lists a point with photos as removable', () => {
    const withPhotos = pin('p2', 10, 10, { captureIds: ['c1', 'c2'] });
    const g = findDuplicateGroups([pin('p1', 10, 10), withPhotos, pin('p3', 10.05, 10)])[0];
    expect(g.keep.id).toBe('p2');
    expect(g.removable.map(p => p.id).sort()).toEqual(['p1', 'p3']);
    const both = findDuplicateGroups([pin('p1', 10, 10, { captureIds: ['a'] }), pin('p2', 10, 10, { captureIds: ['b'] })])[0];
    expect(both.removable).toEqual([]);                    // two points with photos: nothing is removable
  });

  it('keeps the earliest point when none has photos', () => {
    const g = findDuplicateGroups([pin('p5', 10, 10), pin('p2', 10, 10), pin('p9', 10, 10)])[0];
    expect(g.keep.id).toBe('p2');
    expect(g.removable.map(p => p.id).sort()).toEqual(['p5', 'p9']);
  });

  it('a floor with every point doubled reports the real number (the 224 vs 114 case)', () => {
    const base = Array.from({ length: 114 }, (_, i) => pin(`p${i + 1}`, (i % 12) * 7 + 3, Math.floor(i / 12) * 9 + 4, { roomName: `Room ${i}` }));
    const doubled = [...base, ...base.slice(0, 110).map((b, i) => ({ ...b, id: `d${i + 1}`, sequenceNumber: 200 + i }))];
    expect(doubled).toHaveLength(224);
    expect(distinctPointCount(doubled)).toBe(114);
  });
});
