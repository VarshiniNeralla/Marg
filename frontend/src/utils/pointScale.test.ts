import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POINT_SCALE, POINT_SCALE_STEPS, canGrowPoints, canShrinkPoints, loadPointScale, pointScaleLabel,
  savePointScale, snapPointScale, stepPointScale,
} from './pointScale';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => { data[k] = v; },
    },
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('steps', () => {
  it('starts at the normal size, which is a real step', () => {
    expect(DEFAULT_POINT_SCALE).toBe(1);
    expect(POINT_SCALE_STEPS).toContain(DEFAULT_POINT_SCALE);
  });

  it('steps up and down one at a time and stops at both ends', () => {
    expect(stepPointScale(1, 1)).toBe(1.5);
    expect(stepPointScale(1.5, 1)).toBe(2);
    expect(stepPointScale(1, -1)).toBe(0.75);
    expect(stepPointScale(0.75, -1)).toBe(0.75);
    expect(stepPointScale(3, 1)).toBe(3);
  });

  it('knows when a button has nothing left to do', () => {
    expect(canGrowPoints(3)).toBe(false);
    expect(canGrowPoints(2.5)).toBe(true);
    expect(canShrinkPoints(0.75)).toBe(false);
    expect(canShrinkPoints(1)).toBe(true);
  });

  it('walking all the way up and back returns to where it started', () => {
    let s: number = DEFAULT_POINT_SCALE;
    for (let i = 0; i < 10; i++) s = stepPointScale(s, 1);
    expect(s).toBe(3);
    for (let i = 0; i < 10; i++) s = stepPointScale(s, -1);
    expect(s).toBe(0.75);
  });
});

describe('snapPointScale', () => {
  it('lands odd values on the nearest step and survives garbage', () => {
    expect(snapPointScale(1.4)).toBe(1.5);
    expect(snapPointScale(9)).toBe(3);
    expect(snapPointScale(-4)).toBe(0.75);
    expect(snapPointScale(Number.NaN)).toBe(1);
    expect(snapPointScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
  it('labels as a whole percentage', () => {
    expect(pointScaleLabel(1)).toBe('100%');
    expect(pointScaleLabel(1.5)).toBe('150%');
    expect(pointScaleLabel(0.75)).toBe('75%');
  });
});

describe('remembering the size on the device', () => {
  it('uses the normal size when nothing is stored', () => {
    fakeStorage();
    expect(loadPointScale()).toBe(1);
  });

  it('saves and reads it back', () => {
    fakeStorage();
    savePointScale(2);
    expect(loadPointScale()).toBe(2);
  });

  it('ignores a corrupt stored value', () => {
    fakeStorage({ 'sitevision-capture-point-scale': 'huge' });
    expect(loadPointScale()).toBe(1);
  });

  it('still works when storage is blocked', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
      },
    });
    expect(loadPointScale()).toBe(1);
    expect(() => savePointScale(2)).not.toThrow();
  });
});
