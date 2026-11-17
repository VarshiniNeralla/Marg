/**
 * Which two captures a Virtual Tour shows side by side. Pure, so the rules are tested without a browser.
 *
 * A point's timeline is its captures in the order they were taken (oldest first, latest last). "With latest" pairs the
 * chosen date with the latest capture; "Before & After" pairs any two dates, always shown oldest on the left.
 */
import { orderCapturesChronologically } from './reportFormat';

export type CompareView = 'single' | 'withLatest' | 'beforeAfter';

export interface SnapLike {
  id: string;
  date?: string;
  dateLabel?: string;
  isLatest?: boolean;
}

/** "17 Nov 2026, 10:32 am · Latest" for a date picker row. */
export function snapOptionLabel(snap: SnapLike, index: number, total: number): string {
  const when = snap.dateLabel || `Visit ${index + 1}`;
  return snap.isLatest || index === total - 1 ? `${when} · Latest` : when;
}

/** The selected date next to the latest capture. When the latest itself is selected it is paired with the one before it. */
export function pickWithLatest<T extends SnapLike>(timeline: readonly T[], selectedId: string | null): { left: T; right: T } | null {
  if (timeline.length < 2) return null;
  const latest = timeline[timeline.length - 1];
  const selected = selectedId ? timeline.find(s => s.id === selectedId) : undefined;
  if (selected && selected.id !== latest.id) return { left: selected, right: latest };
  return { left: timeline[timeline.length - 2], right: latest };
}

/** Any two different dates, oldest first. Missing or equal choices fall back to the first and the latest capture. */
export function pickBeforeAfter<T extends SnapLike>(
  timeline: readonly T[], beforeId: string | null, afterId: string | null,
): { before: T; after: T } | null {
  if (timeline.length < 2) return null;
  const byId = (id: string | null) => (id ? timeline.find(s => s.id === id) : undefined);
  let a = byId(beforeId) ?? timeline[0];
  let b = byId(afterId) ?? timeline[timeline.length - 1];
  if (a.id === b.id) {
    // the same capture twice shows nothing: move the second pick to the nearest different one
    b = timeline.find(s => s.id !== a.id) ?? b;
    if (b.id === a.id) return null;
  }
  const ia = timeline.findIndex(s => s.id === a.id);
  const ib = timeline.findIndex(s => s.id === b.id);
  const { before, after } = orderCapturesChronologically(a, b, ia, ib);
  return { before: before as T, after: after as T };
}
