import { describe, expect, it } from 'vitest';
import { floorLabel, floorRank, layoutFloors, layoutSummary, normalizeLayout } from './floorNaming';

describe('floorLabel', () => {
  it('names basements, the ground floor and numbered floors', () => {
    expect(floorLabel(-2)).toBe('Basement 2');
    expect(floorLabel(-1)).toBe('Basement 1');
    expect(floorLabel(0)).toBe('Ground Floor');
    expect(floorLabel(7)).toBe('Floor 7');
  });
});

describe('layoutFloors', () => {
  it('G+44 is the Ground Floor and Floor 1 to Floor 44', () => {
    const f = layoutFloors({ basements: 0, ground: true, above: 44 });
    expect(f).toHaveLength(45);
    expect(f[0]).toEqual({ number: 0, label: 'Ground Floor' });
    expect(f[1]).toEqual({ number: 1, label: 'Floor 1' });
    expect(f[44]).toEqual({ number: 44, label: 'Floor 44' });
  });
  it('puts basements below ground, deepest first', () => {
    const f = layoutFloors({ basements: 2, ground: true, above: 2 });
    expect(f.map(x => x.label)).toEqual(['Basement 2', 'Basement 1', 'Ground Floor', 'Floor 1', 'Floor 2']);
    expect(f.map(x => x.number)).toEqual([-2, -1, 0, 1, 2]);
  });
  it('can leave out the ground floor and cleans odd input', () => {
    expect(layoutFloors({ basements: 0, ground: false, above: 3 }).map(x => x.number)).toEqual([1, 2, 3]);
    expect(normalizeLayout({ basements: -4, ground: true, above: Number.NaN })).toEqual({ basements: 0, ground: true, above: 0 });
    expect(layoutFloors({ basements: 0, ground: false, above: 0 })).toEqual([]);
  });
  it('floor numbers are unique, so the per-tower unique index holds', () => {
    const nums = layoutFloors({ basements: 3, ground: true, above: 10 }).map(x => x.number);
    expect(new Set(nums).size).toBe(nums.length);
  });
});

describe('layoutSummary', () => {
  it('uses site shorthand', () => {
    expect(layoutSummary({ basements: 0, ground: true, above: 44 })).toBe('G+44');
    expect(layoutSummary({ basements: 2, ground: true, above: 30 })).toBe('2B+G+30');
    expect(layoutSummary({ basements: 0, ground: false, above: 14 })).toBe('14');
  });
});

describe('floorRank', () => {
  it('orders basements, ground, then numbered floors', () => {
    const names = ['Floor 10', 'Floor 2', 'Ground Floor', 'Basement 1', 'Basement 2', 'Floor 1'];
    const sorted = [...names].sort((a, b) => floorRank(a) - floorRank(b));
    expect(sorted).toEqual(['Basement 2', 'Basement 1', 'Ground Floor', 'Floor 1', 'Floor 2', 'Floor 10']);
  });
  it('sends names it cannot read last', () => {
    expect(floorRank('Terrace')).toBeGreaterThan(floorRank('Floor 99'));
    expect(floorRank('')).toBeGreaterThan(floorRank('Floor 99'));
  });
});
