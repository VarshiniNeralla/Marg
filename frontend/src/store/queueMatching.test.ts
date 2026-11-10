import { describe, expect, it } from 'vitest';
import { capturedAtMatchesEntry, isSameQueuedFile } from './queueMatching';

describe('isSameQueuedFile', () => {
  it('treats a different size under the same camera file name as a DIFFERENT photo (second visit)', () => {
    expect(isSameQueuedFile({ fileName: 'IMG_001.insp', expectedBytes: 12_000_000 }, 'IMG_001.insp', 12_400_000)).toBe(false);
  });

  it('treats same name and same size as the same photo (double-fire)', () => {
    expect(isSameQueuedFile({ fileName: 'IMG_001.insp', expectedBytes: 12_000_000 }, 'IMG_001.insp', 12_000_000)).toBe(true);
  });

  it('never matches a different name', () => {
    expect(isSameQueuedFile({ fileName: 'IMG_001.insp', expectedBytes: 5 }, 'IMG_002.insp', 5)).toBe(false);
  });

  it('falls back to the name when a size is unknown (entries saved before sizes were recorded)', () => {
    expect(isSameQueuedFile({ fileName: 'IMG_001.insp' }, 'IMG_001.insp', 12_000_000)).toBe(true);
    expect(isSameQueuedFile({ fileName: 'IMG_001.insp', expectedBytes: 12_000_000 }, 'IMG_001.insp', undefined)).toBe(true);
  });
});

describe('capturedAtMatchesEntry', () => {
  const t = Date.parse('2026-11-06T10:00:00.000Z');

  it('matches the capture that was attached from this very entry', () => {
    expect(capturedAtMatchesEntry('2026-11-06T10:00:00.000Z', t)).toBe(true);
    expect(capturedAtMatchesEntry('2026-11-06T10:00:01.500Z', t)).toBe(true);
  });

  it('does NOT match an earlier visit to the same point, even if the file name repeated', () => {
    expect(capturedAtMatchesEntry('2026-11-05T09:00:00.000Z', t)).toBe(false);
  });

  it('is conservative when the time is missing or unreadable (keep the entry, upload it)', () => {
    expect(capturedAtMatchesEntry(undefined, t)).toBe(false);
    expect(capturedAtMatchesEntry('', t)).toBe(false);
    expect(capturedAtMatchesEntry('6 Nov 2026, 3:45 pm', Number.NaN)).toBe(false);
  });
});
