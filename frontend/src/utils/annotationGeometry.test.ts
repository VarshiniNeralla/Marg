import { describe, expect, it } from 'vitest';
import {
  angularDistanceDeg, arrowHead, boundsOf, dragIsBigEnough, ellipseOutline, rectOutline, shortLabel, simplifyPen, type Pt,
} from './annotationGeometry';

describe('drawing a shape', () => {
  it('ignores a tap', () => {
    expect(dragIsBigEnough([10, 10], [12, 11])).toBe(false);
    expect(dragIsBigEnough([10, 10], [40, 40])).toBe(true);
  });

  it('rectangle is a closed outline whichever way it is dragged', () => {
    const r = rectOutline([50, 40], [10, 10]);
    expect(r[0]).toEqual(r[r.length - 1]);
    expect(boundsOf(r)).toEqual({ x0: 10, y0: 10, x1: 50, y1: 40 });
    expect(r.length).toBe(33);
  });

  it('ellipse fills the drag box and closes', () => {
    const e = ellipseOutline([0, 0], [100, 60]);
    expect(e[0]).toEqual(e[e.length - 1]);
    const b = boundsOf(e)!;
    expect(b.x0).toBeCloseTo(0); expect(b.x1).toBeCloseTo(100);
    expect(b.y0).toBeCloseTo(0); expect(b.y1).toBeCloseTo(60);
  });

  it('arrow head sits at the tip, behind it', () => {
    const [l, r] = arrowHead([0, 0], [100, 0], 16);
    expect(l[0]).toBeLessThan(100); expect(r[0]).toBeLessThan(100);
    expect(l[1]).toBeCloseTo(-r[1]);
  });
});

describe('freehand pen', () => {
  it('keeps the ends and drops points that are too close', () => {
    const raw: Pt[] = [[0, 0], [1, 0], [2, 0], [10, 0], [11, 0], [20, 0]];
    const s = simplifyPen(raw, 4);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([20, 0]);
    expect(s.length).toBeLessThan(raw.length);
  });

  it('never exceeds the point limit', () => {
    const raw: Pt[] = Array.from({ length: 2000 }, (_, i) => [i * 5, Math.sin(i) * 20] as Pt);
    expect(simplifyPen(raw, 4, 200).length).toBeLessThanOrEqual(200);
  });
});

describe('helpers', () => {
  it('angular distance wraps around the sphere', () => {
    expect(angularDistanceDeg([179, 0], [-179, 0])).toBeCloseTo(2, 3);
    expect(angularDistanceDeg([0, 0], [0, 90])).toBeCloseTo(90, 3);
    expect(angularDistanceDeg([10, 20], [10, 20])).toBeCloseTo(0, 3);
  });

  it('shortens long comments for the on-photo label', () => {
    expect(shortLabel('Windows not yet installed')).toBe('Windows not yet installed');
    expect(shortLabel('x'.repeat(100), 20).length).toBe(20);
    expect(shortLabel('  a   b  ')).toBe('a b');
  });
});
