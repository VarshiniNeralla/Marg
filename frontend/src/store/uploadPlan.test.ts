import { describe, expect, it } from 'vitest';
import {
  buildReview, computeProgress, describeProgress, evaluatePreChecks, isDrained, isUnsent, MOBILE_DATA_WARN_BYTES,
  type PreCheckInput, type QueuedPhotoInfo,
} from './uploadPlan';

const MB = 1024 * 1024;
const photo = (pinId: string, extra: Partial<QueuedPhotoInfo> = {}): QueuedPhotoInfo => ({ pinId, bytes: 12 * MB, status: 'queued', ...extra });
const floors: Record<string, { floorId: string; floorName: string }> = {
  a1: { floorId: 'f1', floorName: 'Floor 1' },
  a2: { floorId: 'f1', floorName: 'Floor 1' },
  b1: { floorId: 'f2', floorName: 'Floor 2' },
};

describe('buildReview', () => {
  it('groups photos per floor with counts and sizes', () => {
    const r = buildReview([photo('a1'), photo('a2'), photo('b1')], id => floors[id]);
    expect(r.totalPhotos).toBe(3);
    expect(r.totalBytes).toBe(36 * MB);
    expect(r.floors).toEqual([
      { floorId: 'f1', floorName: 'Floor 1', towerId: undefined, towerName: undefined, photos: 2, bytes: 24 * MB, needsAttention: 0, pinIds: ['a1', 'a2'] },
      { floorId: 'f2', floorName: 'Floor 2', towerId: undefined, towerName: undefined, photos: 1, bytes: 12 * MB, needsAttention: 0, pinIds: ['b1'] },
    ]);
  });

  it('flags damaged / failed photos instead of hiding them', () => {
    const r = buildReview([photo('a1'), photo('a2', { status: 'failed', failKind: 'corrupt' })], id => floors[id]);
    expect(r.needsAttention).toBe(1);
    expect(r.floors[0].needsAttention).toBe(1);
    expect(r.totalPhotos).toBe(2);
  });

  it('leaves out photos already on the server (stitching)', () => {
    const r = buildReview([photo('a1'), photo('a2', { status: 'processing', stitchJobId: 'j' })], id => floors[id]);
    expect(r.totalPhotos).toBe(1);
  });

  it('a point whose floor is unknown is still counted, never dropped', () => {
    const r = buildReview([photo('zzz')], () => undefined);
    expect(r.totalPhotos).toBe(1);
    expect(r.floors[0].floorName).toBe('Other points');
  });
});

describe('isUnsent', () => {
  it('only photos that still have to be sent', () => {
    expect(isUnsent(photo('a'))).toBe(true);
    expect(isUnsent(photo('a', { status: 'uploading' }))).toBe(true);
    expect(isUnsent(photo('a', { status: 'failed' }))).toBe(false);
    expect(isUnsent(photo('a', { status: 'processing', stitchJobId: 'j' }))).toBe(false);
  });
});

describe('evaluatePreChecks', () => {
  const ok: PreCheckInput = { serverReachable: true, signedIn: true, connection: 'wifi', batteryLevel: 0.8, charging: false, bytesToSend: 500 * MB };

  it('all good -> can start, nothing to say', () => {
    const r = evaluatePreChecks(ok);
    expect(r.canStart).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('no connection, unreachable server, or signed out each block the upload', () => {
    expect(evaluatePreChecks({ ...ok, connection: 'none' }).canStart).toBe(false);
    expect(evaluatePreChecks({ ...ok, serverReachable: false }).canStart).toBe(false);
    const signedOut = evaluatePreChecks({ ...ok, signedIn: false });
    expect(signedOut.canStart).toBe(false);
    expect(signedOut.blockers[0]).toMatch(/safely on this phone/);
  });

  it('big upload over mobile data warns but does not block', () => {
    const r = evaluatePreChecks({ ...ok, connection: 'cellular', bytesToSend: MOBILE_DATA_WARN_BYTES + 1 });
    expect(r.canStart).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/mobile data/);
    expect(evaluatePreChecks({ ...ok, connection: 'cellular', bytesToSend: 1 * MB }).warnings).toEqual([]);
  });

  it('low battery warns, very low blocks, charging is always fine, unknown is ignored', () => {
    expect(evaluatePreChecks({ ...ok, batteryLevel: 0.15 }).warnings.join(' ')).toMatch(/Battery is low/);
    expect(evaluatePreChecks({ ...ok, batteryLevel: 0.15 }).canStart).toBe(true);
    expect(evaluatePreChecks({ ...ok, batteryLevel: 0.05 }).canStart).toBe(false);
    expect(evaluatePreChecks({ ...ok, batteryLevel: 0.05, charging: true }).canStart).toBe(true);
    expect(evaluatePreChecks({ ...ok, batteryLevel: null, charging: null }).warnings).toEqual([]);
  });
});

describe('computeProgress', () => {
  it('counts photos sent so far', () => {
    expect(computeProgress(200, 146, 0)).toEqual({ total: 200, done: 54, remaining: 146, failed: 0, percent: 27 });
  });

  it('never goes backwards or past 100% when photos are added mid-upload', () => {
    const p = computeProgress(10, 15, 0);
    expect(p.total).toBe(15);
    expect(p.done).toBe(0);
    expect(computeProgress(10, 0, 0).percent).toBe(100);
  });

  it('failed photos are not counted as done', () => {
    const p = computeProgress(10, 0, 2);
    expect(p.done).toBe(8);
    expect(p.failed).toBe(2);
  });

  it('describes progress the way the plan words it', () => {
    expect(describeProgress(computeProgress(200, 146, 0), { name: 'Floor 3', done: 12, total: 20 })).toBe('Floor 3: 12 of 20 · overall 54 of 200');
  });
});

describe('isDrained', () => {
  it('only when no photo is left to send and no change is waiting', () => {
    expect(isDrained(0, 0)).toBe(true);
    expect(isDrained(1, 0)).toBe(false);
    expect(isDrained(0, 3)).toBe(false);
  });
});
