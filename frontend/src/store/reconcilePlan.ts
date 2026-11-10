/**
 * Verified deletion, decision part. A photo's file leaves the phone only when:
 *   1. the server returned the SAME fingerprint the phone computed (checked per photo, see `fingerprintsAgree`), and
 *   2. the final reconciliation lists that fingerprint as held by the server.
 * Anything else is KEPT. Pure functions: no storage, no network.
 */

export interface RetainedPhoto {
  id: string;
  ownerId?: string;
  pinId: string;
  /** Path under Directory.Data. */
  fileUri: string;
  fileName: string;
  mimeType: string;
  bytes?: number;
  /** Fingerprint computed on the phone at capture time. */
  sha256: string;
  /** When the photo was taken (drives pin numbering if it ever has to be re-sent). */
  createdAt: number;
  uploadedAt: number;
}

/** Per-photo check. When either side has no fingerprint there is nothing to compare, so the photo is not trusted. */
export function fingerprintsAgree(phone: string | undefined, server: string | undefined): 'match' | 'mismatch' | 'unknown' {
  if (!phone || !server) return 'unknown';
  return phone.toLowerCase() === server.toLowerCase() ? 'match' : 'mismatch';
}

export interface ReconcileOutcome {
  /** Ledger ids whose files may now be deleted. */
  deleteIds: string[];
  /** Ledger ids the server does not hold: kept, and offered for re-sending. */
  missingIds: string[];
}

/**
 * `present` is the list the server returned. A photo is deleted ONLY if its fingerprint is in it; a photo the server
 * did not mention at all counts as missing, never as fine.
 */
export function planReleases(retained: RetainedPhoto[], present: string[]): ReconcileOutcome {
  const held = new Set(present.map(h => h.toLowerCase()));
  const deleteIds: string[] = [];
  const missingIds: string[] = [];
  for (const r of retained) {
    if (held.has(r.sha256.toLowerCase())) deleteIds.push(r.id);
    else missingIds.push(r.id);
  }
  return { deleteIds, missingIds };
}

/** The unique fingerprints to ask the server about (one photo can be in the ledger twice after a re-send). */
export function fingerprintsToCheck(retained: RetainedPhoto[]): string[] {
  return [...new Set(retained.map(r => r.sha256.toLowerCase()))];
}
