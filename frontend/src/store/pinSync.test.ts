import { describe, expect, it } from 'vitest';
import { isUnconfirmedCapturedPin, markServerSeen } from './pinSync';

describe('isUnconfirmedCapturedPin', () => {
  it('protects a point made on this device that the server has never confirmed and that has photos', () => {
    expect(isUnconfirmedCapturedPin({ serverSeen: false, captureIds: ['c1'] })).toBe(true);
  });

  it('does NOT protect a point the server had confirmed (a later disappearance means it was deleted elsewhere)', () => {
    expect(isUnconfirmedCapturedPin({ serverSeen: true, captureIds: ['c1'] })).toBe(false);
  });

  it('does NOT protect old points that predate the flag (no resurrection of long-deleted points)', () => {
    expect(isUnconfirmedCapturedPin({ captureIds: ['c1'] })).toBe(false);
  });

  it('does not bother with an empty unconfirmed point (nothing to lose)', () => {
    expect(isUnconfirmedCapturedPin({ serverSeen: false, captureIds: [] })).toBe(false);
    expect(isUnconfirmedCapturedPin({ serverSeen: false })).toBe(false);
  });
});

describe('markServerSeen', () => {
  it('flags every snapshot pin as confirmed without mutating the input', () => {
    const input = [{ id: 'a', serverSeen: false }, { id: 'b' }, { id: 'c', serverSeen: true }];
    const out = markServerSeen(input)!;
    expect(out.map(p => p.serverSeen)).toEqual([true, true, true]);
    expect(input[0].serverSeen).toBe(false);
  });

  it('keeps "no pins in the snapshot" distinct from "zero pins"', () => {
    expect(markServerSeen(undefined)).toBeUndefined();
    expect(markServerSeen([])).toEqual([]);
  });
});
