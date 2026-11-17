import { describe, expect, it } from 'vitest';
import { pickBeforeAfter, pickWithLatest, snapOptionLabel } from './tourCompare';

const t = (id: string, date: string, extra: Record<string, unknown> = {}) => ({ id, date, dateLabel: date.slice(0, 10), ...extra });
const timeline = [t('c1', '2026-09-01T10:00:00Z'), t('c2', '2026-10-05T10:00:00Z'), t('c3', '2026-11-17T10:00:00Z', { isLatest: true })];

describe('date options', () => {
  it('marks the latest capture', () => {
    expect(snapOptionLabel(timeline[2], 2, 3)).toContain('Latest');
    expect(snapOptionLabel(timeline[0], 0, 3)).not.toContain('Latest');
  });
});

describe('selected date with the latest', () => {
  it('pairs the chosen date with the latest capture', () => {
    const r = pickWithLatest(timeline, 'c1')!;
    expect([r.left.id, r.right.id]).toEqual(['c1', 'c3']);
  });

  it('when the latest is chosen, pairs it with the capture before it', () => {
    const r = pickWithLatest(timeline, 'c3')!;
    expect([r.left.id, r.right.id]).toEqual(['c2', 'c3']);
    expect(pickWithLatest(timeline, null)!.left.id).toBe('c2');
  });

  it('needs at least two captures', () => {
    expect(pickWithLatest([timeline[0]], 'c1')).toBeNull();
    expect(pickWithLatest([], null)).toBeNull();
  });
});

describe('before and after', () => {
  it('defaults to the first and the latest capture', () => {
    const r = pickBeforeAfter(timeline, null, null)!;
    expect([r.before.id, r.after.id]).toEqual(['c1', 'c3']);
  });

  it('shows the older date on the left whichever order the person picked', () => {
    const r = pickBeforeAfter(timeline, 'c3', 'c2')!;
    expect([r.before.id, r.after.id]).toEqual(['c2', 'c3']);
  });

  it('never shows the same capture twice', () => {
    const r = pickBeforeAfter(timeline, 'c2', 'c2')!;
    expect(r.before.id).not.toBe(r.after.id);
  });

  it('any two dates work', () => {
    const r = pickBeforeAfter(timeline, 'c1', 'c2')!;
    expect([r.before.id, r.after.id]).toEqual(['c1', 'c2']);
  });

  it('needs at least two captures', () => {
    expect(pickBeforeAfter([timeline[0]], null, null)).toBeNull();
  });
});
