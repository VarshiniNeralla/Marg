/**
 * Capture-point size on the floor plan, chosen by the field engineer.
 *
 * This is separate from zooming the plan: points keep a constant on-screen size when the plan is zoomed, which
 * leaves them small on a big drawing. This multiplier makes the visible dots and pins bigger or smaller without
 * touching their tap area, so dense plans do not get overlapping taps.
 */
export const POINT_SCALE_STEPS = [0.75, 1, 1.5, 2, 2.5, 3] as const;
export const DEFAULT_POINT_SCALE = 1;
const STORAGE_KEY = 'sitevision-capture-point-scale';

/** The step closest to `value` (so a stale or hand-edited stored value still lands on a real step). */
export function snapPointScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_POINT_SCALE;
  return POINT_SCALE_STEPS.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best));
}

/** One step bigger (dir = 1) or smaller (dir = -1). Stops at the ends. */
export function stepPointScale(current: number, dir: 1 | -1): number {
  const i = POINT_SCALE_STEPS.indexOf(snapPointScale(current) as (typeof POINT_SCALE_STEPS)[number]);
  const next = Math.min(POINT_SCALE_STEPS.length - 1, Math.max(0, i + dir));
  return POINT_SCALE_STEPS[next];
}

export function canGrowPoints(current: number): boolean {
  return snapPointScale(current) < POINT_SCALE_STEPS[POINT_SCALE_STEPS.length - 1];
}

export function canShrinkPoints(current: number): boolean {
  return snapPointScale(current) > POINT_SCALE_STEPS[0];
}

/** "100%", "150%" ... for the small indicator. */
export function pointScaleLabel(scale: number): string {
  return `${Math.round(snapPointScale(scale) * 100)}%`;
}

export function loadPointScale(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw == null ? DEFAULT_POINT_SCALE : snapPointScale(Number(raw));
  } catch {
    return DEFAULT_POINT_SCALE; // storage blocked or unavailable: just use the normal size
  }
}

export function savePointScale(scale: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(snapPointScale(scale)));
  } catch {
    /* not remembered; the size still applies for this visit */
  }
}
