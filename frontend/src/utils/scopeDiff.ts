export interface ScopeDiff {
  /** Ticked now but not part of the analysed list. */
  added: string[];
  /** Part of the analysed list but not ticked now. */
  removed: string[];
  changed: boolean;
}

/**
 * Compare the floor's current activity list with the one the last analysis used.
 * A missing analysed list means "everything" (old snapshots), so `allIds` stands in for it.
 */
export function scopeDiff(current: string[], analysed: string[] | null | undefined, allIds: string[]): ScopeDiff {
  const before = new Set(analysed && analysed.length ? analysed : allIds);
  const now = new Set(current);
  const added = [...now].filter(id => !before.has(id));
  const removed = [...before].filter(id => !now.has(id));
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}

/** Show "Run analysis again to apply": the server says so, or the lists differ. */
export function needsRerun(serverFlag: boolean | undefined, diff: ScopeDiff): boolean {
  return !!serverFlag || diff.changed;
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

export function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
}
