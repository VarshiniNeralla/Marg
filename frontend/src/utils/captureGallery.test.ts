import { describe, expect, it } from 'vitest';
import { capturesInSelection, collectFloorCaptureIds } from './captureGallery';

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

describe('capturesInSelection (toolbar Delete all follows the current selection)', () => {
  const cap = (id: string, projectId: string, towerId: string, floorLabel: string) => ({ id, projectId, towerId, floorLabel });
  const all = [
    cap('p1-tA-f1', 'P1', 'tA', 'Floor 1'), cap('p1-tA-f2', 'P1', 'tA', 'Floor 2'),
    cap('p1-tB-f1', 'P1', 'tB', 'Floor 1'), cap('p2-tA-f1', 'P2', 'tA', 'Floor 1'),
  ];
  const ids = (r: { cards: { id: string }[] }) => r.cards.map(c => c.id).sort();

  it('project selected: every capture of that project, none of another project', () => {
    const r = capturesInSelection(all, { projectId: 'P1', towerId: 'all', floorId: 'all' });
    expect(r.scope).toBe('project');
    expect(ids(r)).toEqual(['p1-tA-f1', 'p1-tA-f2', 'p1-tB-f1']);
  });

  it('tower selected: only that tower inside the project (not the same tower id in another project)', () => {
    const r = capturesInSelection(all, { projectId: 'P1', towerId: 'tA', floorId: 'all' });
    expect(r.scope).toBe('tower');
    expect(ids(r)).toEqual(['p1-tA-f1', 'p1-tA-f2']);
  });

  it('floor selected: only that floor of that tower, not the same floor label elsewhere', () => {
    const r = capturesInSelection(all, { projectId: 'P1', towerId: 'tA', floorId: 'f1', floorLabel: 'Floor 1' });
    expect(r.scope).toBe('floor');
    expect(ids(r)).toEqual(['p1-tA-f1']);
  });

  it('a floor whose label cannot be resolved matches nothing instead of widening', () => {
    const r = capturesInSelection(all, { projectId: 'P1', towerId: 'tA', floorId: 'f1', floorLabel: null });
    expect(r.cards).toEqual([]);
  });
});
