import { describe, expect, it } from 'vitest';
import {
  coordScale, floorCoordScale, normalizePolygon, polygonCentroid, polygonToSvgPoints,
} from './heatmapGeometry';

describe('heatmapGeometry', () => {
  it('detects fractional coordinates', () => {
    expect(coordScale([{ x: 0.1, y: 0.9 }, { x: 1, y: 0.5 }])).toBe(100);
  });

  it('keeps percentage coordinates as is', () => {
    expect(coordScale([{ x: 10, y: 90 }, { x: 55.5, y: 20 }])).toBe(1);
  });

  it('converts fractions and percentages to the same SVG points', () => {
    const frac = [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.6 }];
    const pct = [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 60 }];
    expect(polygonToSvgPoints(frac)).toBe('10,20 50,20 50,60');
    expect(polygonToSvgPoints(pct)).toBe('10,20 50,20 50,60');
  });

  it('returns an empty string for degenerate polygons', () => {
    expect(polygonToSvgPoints([])).toBe('');
    expect(polygonToSvgPoints(null)).toBe('');
    expect(polygonToSvgPoints([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe('');
  });

  it('drops non-finite points and clamps to the viewBox', () => {
    expect(normalizePolygon([{ x: NaN, y: 1 }, { x: 5, y: 5 }])).toEqual([{ x: 5, y: 5 }]);
    expect(polygonToSvgPoints([{ x: -5, y: 120 }, { x: 10, y: 10 }, { x: 20, y: 30 }])).toBe('0,100 10,10 20,30');
  });

  it('uses one scale across a floor', () => {
    expect(floorCoordScale([[{ x: 0.2, y: 0.2 }], [{ x: 1, y: 1 }], undefined])).toBe(100);
    expect(floorCoordScale([[{ x: 0.2, y: 0.2 }], [{ x: 40, y: 60 }]])).toBe(1);
  });

  it('computes a centroid', () => {
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toEqual({ x: 5, y: 5 });
    expect(polygonCentroid([])).toBeNull();
  });
});
