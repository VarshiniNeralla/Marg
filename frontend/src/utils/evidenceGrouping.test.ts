import { describe, expect, it } from 'vitest';
import { flatsOf, pageSlice, roomsInFlat, NO_FLAT_LABEL, type EvidenceItem } from './evidenceImages';

const item = (id: string, flatName: string, roomName: string): EvidenceItem => ({
  captureId: id, role: 'direct', flatName, roomName, views: [], capturedAt: null, confidencePct: 80,
});

const items = [
  item('1', 'Flat 10', 'Kitchen'),
  item('2', 'Flat 2', 'Living / Dining'),
  item('3', 'Flat 2', 'Bedroom-2'),
  item('4', 'Flat 2', 'Living / Dining'),
  item('5', '', 'Lobby'),
  item('6', 'Flat 10', 'Bedroom-3'),
];

describe('flatsOf', () => {
  it('lists each flat once with its count, in natural order, common areas last', () => {
    expect(flatsOf(items).map(f => [f.label, f.count])).toEqual([
      ['Flat 2', 3], ['Flat 10', 2], [NO_FLAT_LABEL, 1],
    ]);
  });
});

describe('roomsInFlat', () => {
  it('lists only the rooms of that flat, with counts', () => {
    expect(roomsInFlat(items, 'Flat 2').map(r => [r.label, r.count])).toEqual([['Bedroom-2', 1], ['Living / Dining', 2]]);
    expect(roomsInFlat(items, 'Flat 10').map(r => r.label)).toEqual(['Bedroom-3', 'Kitchen']);
  });
  it('finds the rooms that belong to no flat', () => {
    expect(roomsInFlat(items, '').map(r => r.label)).toEqual(['Lobby']);
  });
});

describe('pageSlice', () => {
  const list = Array.from({ length: 14 }, (_, i) => i + 1);
  it('returns one page at a time', () => {
    expect(pageSlice(list, 1, 6)).toEqual({ rows: [1, 2, 3, 4, 5, 6], page: 1, pages: 3 });
    expect(pageSlice(list, 3, 6)).toEqual({ rows: [13, 14], page: 3, pages: 3 });
  });
  it('clamps a page that no longer exists (after a filter shrinks the list)', () => {
    expect(pageSlice([1, 2], 5, 6)).toEqual({ rows: [1, 2], page: 1, pages: 1 });
    expect(pageSlice([], 1, 6)).toEqual({ rows: [], page: 1, pages: 1 });
  });
});
