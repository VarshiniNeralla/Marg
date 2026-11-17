/**
 * Pure geometry for drawing on a tour photo. Shapes are drawn in screen pixels, then stored as points in the
 * photo's own coordinates (sphere: yaw/pitch degrees, flat: 0..1 of the image) so they stay on the right spot when
 * the viewer rotates or zooms. Kept free of React and the viewer so it is unit-tested on its own.
 */
export type Pt = [number, number];
export type ShapeKind = 'rect' | 'ellipse' | 'arrow' | 'pen';
export type AnnotationSpace = 'sphere' | 'flat';

export interface Shape { kind: ShapeKind; color: string; points: Pt[] }
export interface Annotation { space: AnnotationSpace; focus?: Pt; shapes: Shape[] }

export const ANNOTATION_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'] as const;
export const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS[0];
export const MAX_SHAPES = 12;

const MIN_DRAG = 6; // px: a tap is not a shape

export function dragIsBigEnough(a: Pt, b: Pt, min = MIN_DRAG): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) >= min;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Closed rectangle outline (first point repeated at the end), every edge split so it bends correctly on a sphere. */
export function rectOutline(a: Pt, b: Pt, steps = 8): Pt[] {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const corners: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const out: Pt[] = [];
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < steps; i++) out.push(lerp(corners[c], corners[c + 1], i / steps));
  }
  out.push(corners[0]);
  return out;
}

/** Closed ellipse that fills the drag box. */
export function ellipseOutline(a: Pt, b: Pt, n = 48): Pt[] {
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const rx = Math.abs(a[0] - b[0]) / 2;
  const ry = Math.abs(a[1] - b[1]) / 2;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  out.push(out[0]);
  return out;
}

/** Thin out a freehand stroke so it stays small and smooth. */
export function simplifyPen(points: readonly Pt[], minGap = 4, maxPoints = 200): Pt[] {
  if (points.length <= 2) return [...points];
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i][0] - last[0], points[i][1] - last[1]) >= minGap) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  if (out.length <= maxPoints) return out;
  const step = out.length / maxPoints;
  const thinned: Pt[] = [];
  for (let i = 0; i < maxPoints - 1; i++) thinned.push(out[Math.floor(i * step)]);
  thinned.push(out[out.length - 1]);
  return thinned;
}

/** The two wing points of an arrow head at `tip`, pointing away from `tail`. */
export function arrowHead(tail: Pt, tip: Pt, size = 16, spread = Math.PI / 7): [Pt, Pt] {
  const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
  const wing = (s: number): Pt => [tip[0] - size * Math.cos(angle + s), tip[1] - size * Math.sin(angle + s)];
  return [wing(spread), wing(-spread)];
}

export function boundsOf(points: readonly Pt[]): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!points.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Angle in degrees between two directions on a sphere (yaw/pitch in degrees). */
export function angularDistanceDeg(a: Pt, b: Pt): number {
  const rad = Math.PI / 180;
  const [y1, p1, y2, p2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(y1 - y2);
  return Math.acos(Math.min(1, Math.max(-1, c))) / rad;
}

/** Truncate a comment for the label next to a shape. */
export function shortLabel(text: string, max = 48): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
