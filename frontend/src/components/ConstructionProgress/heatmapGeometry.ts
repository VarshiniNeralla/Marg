export interface XY { x: number; y: number }

/**
 * Backend polygons / pins are stored either as fractions (0-1) or percentages (0-100).
 * Returns the multiplier that brings every point to a 0-100 scale.
 */
export function coordScale(points: XY[]): number {
  let max = 0;
  for (const p of points) {
    if (Number.isFinite(p.x)) max = Math.max(max, Math.abs(p.x));
    if (Number.isFinite(p.y)) max = Math.max(max, Math.abs(p.y));
  }
  return max > 0 && max <= 1.0001 ? 100 : 1;
}

/** Scale every point to 0-100, dropping non-finite points. */
export function normalizePolygon(polygon: XY[] | null | undefined, scale?: number): XY[] {
  const pts = (polygon ?? []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const s = scale ?? coordScale(pts);
  return pts.map(p => ({ x: p.x * s, y: p.y * s }));
}

/** SVG `points` attribute (viewBox 0 0 100 100), or '' for fewer than 3 points. */
export function polygonToSvgPoints(polygon: XY[] | null | undefined, scale?: number): string {
  const pts = normalizePolygon(polygon, scale);
  if (pts.length < 3) return '';
  const r = (n: number) => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
  return pts.map(p => `${r(p.x)},${r(p.y)}`).join(' ');
}

/** One shared scale for a whole floor so rooms stay consistent with each other. */
export function floorCoordScale(polygons: Array<XY[] | null | undefined>): number {
  return coordScale(polygons.flatMap(p => p ?? []));
}

export function polygonCentroid(polygon: XY[]): XY | null {
  if (polygon.length === 0) return null;
  const sum = polygon.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}
