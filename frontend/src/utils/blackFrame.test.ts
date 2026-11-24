import { describe, expect, it } from 'vitest';
import { BLACK_PHOTO_MESSAGE, isNearlyBlack, lumaFromRgba, meanAndSpread } from './blackFrame';

const flat = (value: number, n = 1000) => Array.from({ length: n }, () => value);
const noisy = (centre: number, wobble: number, n = 1000) => Array.from({ length: n }, (_, i) => centre + ((i % 7) - 3) * wobble);

describe('isNearlyBlack', () => {
  it('flags a black frame, like the real ones from the tablet (mean about 2.8, spread about 1.5)', () => {
    expect(isNearlyBlack(noisy(2.8, 0.5))).toBe(true);
    expect(isNearlyBlack(flat(0))).toBe(true);
  });

  it('does not flag a normal photo (mean 133, spread 75)', () => {
    const normal = Array.from({ length: 1000 }, (_, i) => (i % 2 ? 60 : 206));
    expect(isNearlyBlack(normal)).toBe(false);
  });

  it('does not flag a dim room that still shows detail', () => {
    const dimButReal = Array.from({ length: 1000 }, (_, i) => (i % 2 ? 2 : 40));
    expect(isNearlyBlack(dimButReal)).toBe(false);
  });

  it('does not flag a plain bright wall or a flat grey frame (those are a different problem)', () => {
    expect(isNearlyBlack(flat(200))).toBe(false);
    expect(isNearlyBlack(flat(128))).toBe(false);
  });

  it('never calls an empty sample black', () => {
    expect(isNearlyBlack([])).toBe(false);
  });
});

describe('helpers', () => {
  it('turns RGBA pixels into brightness', () => {
    expect(lumaFromRgba([0, 0, 0, 255, 255, 255, 255, 255]).map(Math.round)).toEqual([0, 255]);
    expect(lumaFromRgba([])).toEqual([]);
  });

  it('measures mean and spread', () => {
    const { mean, spread } = meanAndSpread([0, 10]);
    expect(mean).toBe(5);
    expect(spread).toBe(5);
    expect(meanAndSpread([])).toEqual({ mean: 0, spread: 0 });
  });

  it('has a plain message with no jargon or em dash', () => {
    expect(BLACK_PHOTO_MESSAGE).not.toContain('—');
    expect(BLACK_PHOTO_MESSAGE.toLowerCase()).toContain('retake');
  });
});
