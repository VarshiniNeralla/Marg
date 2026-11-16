import { describe, expect, it } from 'vitest';
import { collectFloorCaptureIds } from './captureGallery';

const pin = (...captureIds: string[]) => ({ captureIds });

describe('collectFloorCaptureIds (delete a whole floor from Capture History)', () => {
  it('takes exactly the shown cards when no point has earlier visits', () => {
    const r = collectFloorCaptureIds([{ id: 'a' }, { id: 'b' }], [pin('a'), pin('b')]);
    expect(r).toEqual({ ids: ['a', 'b'], shown: 2, earlier: 0 });
  });

  it('also takes the earlier visits of the same points, so no older card reappears', () => {
    const r = collectFloorCaptureIds([{ id: 'a2' }, { id: 'b' }], [pin('a1', 'a2'), pin('b')]);
    expect(r.ids.sort()).toEqual(['a1', 'a2', 'b']);
    expect(r.shown).toBe(2);
    expect(r.earlier).toBe(1);
  });

  it('never takes other people\'s visits when the own-capture set is given', () => {
    const own = new Set(['a2', 'a3']);
    const r = collectFloorCaptureIds([{ id: 'a3' }], [pin('a1-someone-else', 'a2', 'a3')], own);
    expect(r.ids.sort()).toEqual(['a2', 'a3']);
    expect(r.earlier).toBe(1);
  });

  it('does not touch points of other floors', () => {
    const r = collectFloorCaptureIds([{ id: 'a' }], [pin('a'), pin('other-floor-1', 'other-floor-2')]);
    expect(r.ids).toEqual(['a']);
  });

  it('counts a capture once even if the card is also an earlier visit of another card\'s pin', () => {
    const r = collectFloorCaptureIds([{ id: 'a' }, { id: 'b' }], [pin('a', 'b'), pin('b')]);
    expect(r.ids.sort()).toEqual(['a', 'b']);
    expect(r.earlier).toBe(0);
  });

  it('handles an empty floor', () => {
    expect(collectFloorCaptureIds([], [pin('a')])).toEqual({ ids: [], shown: 0, earlier: 0 });
  });
});
