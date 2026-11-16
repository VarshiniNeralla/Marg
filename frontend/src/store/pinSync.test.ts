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

describe('isUnconfirmedPlacedPin (an admin-placed labelled point the server has not confirmed)', () => {
  it('is protected until the server confirms it, whether it is labelled or marked predefined', async () => {
    const { isUnconfirmedPlacedPin } = await import('./pinSync');
    expect(isUnconfirmedPlacedPin({ serverSeen: false, flatName: 'Flat 01', roomName: 'Living' })).toBe(true);
    expect(isUnconfirmedPlacedPin({ serverSeen: false, isPredefined: true })).toBe(true);
  });

  it('is not protected once confirmed, when it predates the flag, or when it is an unlabelled free point', async () => {
    const { isUnconfirmedPlacedPin } = await import('./pinSync');
    expect(isUnconfirmedPlacedPin({ serverSeen: true, flatName: 'Flat 01', roomName: 'Living' })).toBe(false);
    expect(isUnconfirmedPlacedPin({ flatName: 'Flat 01', roomName: 'Living' })).toBe(false);
    expect(isUnconfirmedPlacedPin({ serverSeen: false })).toBe(false);
  });
});

describe('pinClientAgeMs (only a point with a real timestamp from this device can be kept by the short window)', () => {
  it('has an age only when this device stamped the point', async () => {
    const { pinClientAgeMs } = await import('./pinSync');
    expect(pinClientAgeMs({ clientCreatedAt: 1000 }, 61_000)).toBe(60_000);
  });

  it('has no age (never kept by the window) without that timestamp, even if its text says "Just now"', async () => {
    const { pinClientAgeMs } = await import('./pinSync');
    expect(pinClientAgeMs({}, 61_000)).toBe(Infinity);
    expect(pinClientAgeMs({ clientCreatedAt: 'Just now' }, 61_000)).toBe(Infinity);
  });
});
