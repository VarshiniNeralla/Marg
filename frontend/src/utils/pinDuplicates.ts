/**
 * Capture points that sit on top of each other.
 *
 * A point is a duplicate of another when it is on the same floor plan, at (almost) the same spot, with the same
 * Flat / Room label (or both unlabelled). Such points look like ONE marker on the plan but each counts, so a floor
 * with 114 visible points can report 224. Nothing here deletes anything: it only finds them so the count can be
 * honest and so a person can review and remove the empty extras on purpose.
 */

export interface PinLike {
  id: string;
  x: number;
  y: number;
  floorPlanId?: string;
  flatName?: string;
  roomName?: string;
  captureIds?: readonly string[];
  sequenceNumber?: number;
}

/** Percent of the plan. 0.25 % of a plan is a couple of pixels: well inside one marker. */
export const SAME_SPOT_TOLERANCE_PCT = 0.25;

const norm = (s?: string) => (s || '').trim().toLowerCase();
const captureCount = (p: PinLike) => p.captureIds?.length ?? 0;

export function isSamePlace(a: PinLike, b: PinLike, tolerance = SAME_SPOT_TOLERANCE_PCT): boolean {
  if ((a.floorPlanId || '') !== (b.floorPlanId || '')) return false;
  if (norm(a.flatName) !== norm(b.flatName) || norm(a.roomName) !== norm(b.roomName)) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
}

export interface DuplicateGroup<T extends PinLike> {
  /** The point that stays: the one with the most photos, then the earliest. */
  keep: T;
  /** Every other point at that spot. */
  extras: T[];
  /** The extras that have NO photos, i.e. the ones that are safe to remove. Points with photos are never listed. */
  removable: T[];
}

export function findDuplicateGroups<T extends PinLike>(pins: readonly T[], tolerance = SAME_SPOT_TOLERANCE_PCT): DuplicateGroup<T>[] {
  const used = new Set<string>();
  const groups: DuplicateGroup<T>[] = [];
  for (let i = 0; i < pins.length; i++) {
    const a = pins[i];
    if (used.has(a.id)) continue;
    const members = [a];
    for (let j = i + 1; j < pins.length; j++) {
      const b = pins[j];
      if (used.has(b.id)) continue;
      if (isSamePlace(a, b, tolerance)) members.push(b);
    }
    if (members.length < 2) continue;
    members.forEach(m => used.add(m.id));
    const ordered = [...members].sort((p, q) =>
      captureCount(q) - captureCount(p) || (p.sequenceNumber ?? Infinity) - (q.sequenceNumber ?? Infinity));
    const [keep, ...extras] = ordered;
    groups.push({ keep, extras, removable: extras.filter(e => captureCount(e) === 0) });
  }
  return groups;
}

/** How many points there really are: stacked duplicates count once. */
export function distinctPointCount(pins: readonly PinLike[], tolerance = SAME_SPOT_TOLERANCE_PCT): number {
  const extras = findDuplicateGroups(pins, tolerance).reduce((n, g) => n + g.extras.length, 0);
  return pins.length - extras;
}
