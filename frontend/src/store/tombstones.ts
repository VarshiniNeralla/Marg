/**
 * Deletion tombstones.
 *
 * The workflow store hydrates from the API and back-fills any locally-cached
 * record the snapshot is missing — on the assumption it "failed to sync." But a
 * record deleted server-side is ALSO missing from the snapshot, so without a way
 * to tell the two apart, the merge resurrects deleted captures/pins/tours on the
 * next reload.
 *
 * A tombstone records that the client intentionally deleted an id. Hydration then
 * (a) never keeps a tombstoned local record and (b) never re-uploads it. Once the
 * server snapshot also lacks the id and enough time passes, the tombstone can be
 * pruned (it has done its job). Persisted across reloads in its own small key.
 */
const TOMBSTONE_KEY = 'sitesurelabs-tombstones';
const MAX_TOMBSTONES = 1000;
// Tombstones older than this are pruned — by then every client has re-synced.
const TOMBSTONE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

type TombstoneMap = Record<string, number>; // id -> deletedAt epoch ms

function load(): TombstoneMap {
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as TombstoneMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function save(map: TombstoneMap): void {
  try {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled storage — tombstones are best-effort */
  }
}

function prune(map: TombstoneMap): TombstoneMap {
  const now = Date.now();
  let entries = Object.entries(map).filter(([, ts]) => now - ts < TOMBSTONE_TTL_MS);
  if (entries.length > MAX_TOMBSTONES) {
    // Keep the most recent MAX_TOMBSTONES.
    entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_TOMBSTONES);
  }
  return Object.fromEntries(entries);
}

/** Mark one or more ids as intentionally deleted. */
export function addTombstones(...ids: string[]): void {
  if (!ids.length) return;
  const map = prune(load());
  const now = Date.now();
  for (const id of ids) {
    if (id) map[id] = now;
  }
  save(map);
}

/** True if this id was deleted by the client and must not be resurrected. */
export function isTombstoned(id: string): boolean {
  if (!id) return false;
  const map = load();
  return id in map;
}

/** Returns the current tombstone id set (pruned). */
export function tombstoneSet(): Set<string> {
  const map = prune(load());
  save(map);
  return new Set(Object.keys(map));
}

/** Drop tombstones for ids the server now also reports as gone (cleanup). */
export function clearTombstones(ids: string[]): void {
  if (!ids.length) return;
  const map = load();
  let changed = false;
  for (const id of ids) {
    if (id in map) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) save(map);
}
