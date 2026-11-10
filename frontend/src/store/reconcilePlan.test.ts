import { describe, expect, it } from 'vitest';
import { fingerprintsAgree, fingerprintsToCheck, planReleases, type RetainedPhoto } from './reconcilePlan';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function photo(id: string, sha256: string): RetainedPhoto {
  return { id, pinId: 'p1', fileUri: `pending-uploads/${id}`, fileName: `${id}.insp`, mimeType: 'application/octet-stream', sha256, createdAt: 1, uploadedAt: 2 };
}

describe('fingerprintsAgree', () => {
  it('equal fingerprints match, ignoring case', () => {
    expect(fingerprintsAgree(A, A.toUpperCase())).toBe('match');
  });
  it('different fingerprints mismatch (the photo must be sent again)', () => {
    expect(fingerprintsAgree(A, B)).toBe('mismatch');
  });
  it('a missing side is unknown, never a match', () => {
    expect(fingerprintsAgree(undefined, A)).toBe('unknown');
    expect(fingerprintsAgree(A, undefined)).toBe('unknown');
    expect(fingerprintsAgree(undefined, undefined)).toBe('unknown');
  });
});

describe('planReleases: only confirmed photos may be deleted', () => {
  const retained = [photo('1', A), photo('2', B), photo('3', C)];

  it('deletes exactly the photos the server confirmed, keeps the rest', () => {
    const r = planReleases(retained, [A, C]);
    expect(r.deleteIds).toEqual(['1', '3']);
    expect(r.missingIds).toEqual(['2']);
  });

  it('an empty answer deletes nothing', () => {
    const r = planReleases(retained, []);
    expect(r.deleteIds).toEqual([]);
    expect(r.missingIds).toEqual(['1', '2', '3']);
  });

  it('fingerprints the server returns for photos we do not have are ignored', () => {
    const r = planReleases(retained, ['d'.repeat(64)]);
    expect(r.deleteIds).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(planReleases(retained, [A.toUpperCase()]).deleteIds).toEqual(['1']);
  });

  it('every photo ends up in exactly one list', () => {
    for (const present of [[], [A], [A, B], [A, B, C]]) {
      const r = planReleases(retained, present);
      expect([...r.deleteIds, ...r.missingIds].sort()).toEqual(['1', '2', '3']);
    }
  });
});

describe('fingerprintsToCheck', () => {
  it('lists each fingerprint once', () => {
    expect(fingerprintsToCheck([photo('1', A), photo('2', A), photo('3', B)])).toEqual([A, B]);
  });
});
