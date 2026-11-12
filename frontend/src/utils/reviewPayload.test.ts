import { describe, expect, it } from 'vitest';
import { buildReviewPayload } from './reviewPayload';

const target = { snapshotId: 's1', floorId: 'f1', flatName: 'A-101', roomName: 'Bedroom 1', activityId: 'paint' };

describe('buildReviewPayload', () => {
  it('requires a reason', () => {
    expect(buildReviewPayload(target, { mode: 'accept', reason: '   ' })).toEqual({ ok: false, error: 'A reason is required.' });
  });

  it('accept sends "correct" and no percentage', () => {
    const r = buildReviewPayload(target, { mode: 'accept', pct: 80, reason: 'Looks right' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toMatchObject({
      snapshotId: 's1', floorId: 'f1', flatName: 'A-101', roomName: 'Bedroom 1', roomCorrect: 'yes', progressVerdict: 'correct',
    });
    const c = r.payload.activityCorrections![0];
    expect(c).toEqual({ activityId: 'paint', verdict: 'correct', note: 'Looks right' });
    expect('correctPercentage' in c).toBe(false);
  });

  it('completed sends wrong with 100', () => {
    const r = buildReviewPayload(target, { mode: 'completed', reason: 'Handed over', note: ' extra ' });
    expect(r.ok && r.payload.progressVerdict).toBe('wrong');
    expect(r.ok && r.payload.activityCorrections![0].correctPercentage).toBe(100);
    expect(r.ok && r.payload.note).toBe('extra');
  });

  it('in progress accepts only 1-99', () => {
    expect(buildReviewPayload(target, { mode: 'in_progress', pct: '', reason: 'x' }).ok).toBe(false);
    expect(buildReviewPayload(target, { mode: 'in_progress', pct: 0, reason: 'x' }).ok).toBe(false);
    expect(buildReviewPayload(target, { mode: 'in_progress', pct: 100, reason: 'x' }).ok).toBe(false);
    const r = buildReviewPayload(target, { mode: 'in_progress', pct: '45', reason: 'x' });
    expect(r.ok && r.payload.activityCorrections![0].correctPercentage).toBe(45);
  });

  it('correct accepts 0-100 whole numbers', () => {
    expect(buildReviewPayload(target, { mode: 'correct', pct: -1, reason: 'x' }).ok).toBe(false);
    expect(buildReviewPayload(target, { mode: 'correct', pct: 101, reason: 'x' }).ok).toBe(false);
    expect(buildReviewPayload(target, { mode: 'correct', pct: 12.5, reason: 'x' }).ok).toBe(false);
    const r = buildReviewPayload(target, { mode: 'correct', pct: 0, reason: 'x' });
    expect(r.ok && r.payload.activityCorrections![0].correctPercentage).toBe(0);
    expect(r.ok && r.payload.progressVerdict).toBe('wrong');
  });
});
