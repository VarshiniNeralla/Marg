import { describe, expect, it } from 'vitest';
import { bytesToHex, sha256OfBlob } from './fingerprint';
import {
  assessStorage, AVG_PHOTO_BYTES, CRITICAL_PHOTOS_LEFT, describeStorage, estimateTripBytes, formatBytes, LOW_PHOTOS_LEFT,
} from './storageCheck';

describe('sha256OfBlob', () => {
  it('matches the known SHA-256 of "abc"', async () => {
    expect(await sha256OfBlob(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches the known SHA-256 of an empty file', async () => {
    expect(await sha256OfBlob(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('different bytes give different fingerprints, same bytes the same', async () => {
    const a = await sha256OfBlob(new Blob([new Uint8Array([1, 2, 3])]));
    const b = await sha256OfBlob(new Blob([new Uint8Array([1, 2, 4])]));
    const a2 = await sha256OfBlob(new Blob([new Uint8Array([1, 2, 3])]));
    expect(a).not.toBe(b);
    expect(a).toBe(a2);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hex helper pads single digits', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });
});

describe('assessStorage', () => {
  const mb = (n: number) => n * 1024 * 1024;

  it('plenty of room is ok', () => {
    const r = assessStorage(mb(10_000), mb(1_000));
    expect(r.level).toBe('ok');
    expect(r.photosLeft).toBe(Math.floor(mb(9_000) / AVG_PHOTO_BYTES));
  });

  it('warns below the low threshold and flags critical below the critical one', () => {
    expect(assessStorage(mb(300 + 12 * (LOW_PHOTOS_LEFT - 1)), mb(300)).level).toBe('low');
    expect(assessStorage(mb(300 + 12 * (CRITICAL_PHOTOS_LEFT - 1)), mb(300)).level).toBe('critical');
  });

  it('full or over-full storage is critical with zero photos left, never negative', () => {
    const r = assessStorage(mb(100), mb(500));
    expect(r.level).toBe('critical');
    expect(r.photosLeft).toBe(0);
  });

  it('missing numbers are unknown, never a false alarm', () => {
    expect(assessStorage(undefined, undefined).level).toBe('unknown');
    expect(assessStorage(0, 10).level).toBe('unknown');
    expect(describeStorage(assessStorage(null, null))).toBe('');
  });

  it('the plan example: 10 floors x 20 pins is about 2.3 GB', () => {
    expect(formatBytes(estimateTripBytes(200))).toBe('2.3 GB');
  });

  it('describes the level in plain words', () => {
    expect(describeStorage({ level: 'critical', photosLeft: 3, freeBytes: 1 })).toMatch(/Almost out of space/);
    expect(describeStorage({ level: 'low', photosLeft: 20, freeBytes: 1 })).toMatch(/getting low/);
    expect(describeStorage({ level: 'ok', photosLeft: 90, freeBytes: 1 })).toMatch(/about 90 more photos/);
  });
});
