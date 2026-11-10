import { describe, expect, it } from 'vitest';
import { paginateGroups } from './paginateGroups';

const group = (name: string, n: number) => ({ name, captures: Array.from({ length: n }, (_, i) => `${name}-${i + 1}`) });
const counts = (pages: { captures: unknown[] }[][]) => pages.map(p => p.reduce((s, g) => s + g.captures.length, 0));

describe('paginateGroups', () => {
  it('splits a floor with 104 captures into pages of 12 (the case that rendered everything at once)', () => {
    const pages = paginateGroups([group('Floor 5', 104)], 12);
    expect(pages).toHaveLength(9);                       // 8 full pages + 1 of 8
    expect(counts(pages)).toEqual([12, 12, 12, 12, 12, 12, 12, 12, 8]);
    expect(pages.every(p => p.length === 1 && p[0].name === 'Floor 5')).toBe(true);
  });

  it('never loses or repeats a capture when a floor is split', () => {
    const pages = paginateGroups([group('F', 104)], 12);
    const all = pages.flatMap(p => p.flatMap(g => g.captures));
    expect(all).toHaveLength(104);
    expect(new Set(all).size).toBe(104);
    expect(all[0]).toBe('F-1');
    expect(all[103]).toBe('F-104');
  });

  it('keeps small floors together on one page', () => {
    const pages = paginateGroups([group('A', 5), group('B', 4), group('C', 3)], 12);
    expect(pages).toHaveLength(1);
    expect(counts(pages)).toEqual([12]);
  });

  it('starts a new page when the next small floor would not fit', () => {
    const pages = paginateGroups([group('A', 8), group('B', 6)], 12);
    expect(counts(pages)).toEqual([8, 6]);
  });

  it('flushes a half-filled page before a big floor, then splits the big floor', () => {
    const pages = paginateGroups([group('A', 3), group('Big', 30), group('Z', 2)], 12);
    expect(counts(pages)).toEqual([3, 12, 12, 6, 2]);
    expect(pages.map(p => p.map(g => g.name))).toEqual([['A'], ['Big'], ['Big'], ['Big'], ['Z']]);
  });

  it('a floor that exactly fills a page is not split', () => {
    expect(counts(paginateGroups([group('A', 12)], 12))).toEqual([12]);
  });

  it('always returns one (empty) page for no data, and tolerates a bad page size', () => {
    expect(paginateGroups([], 12)).toEqual([[]]);
    expect(counts(paginateGroups([group('A', 3)], 0))).toEqual([1, 1, 1]);
  });
});
