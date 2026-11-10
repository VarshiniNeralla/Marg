/**
 * Offline site pack: the rules, without storage or network (unit tested).
 *
 * A floor plan image is saved on the phone, keyed by its address with the login token and the server name removed, so
 * the saved copy is found whatever token the app happens to hold. A changed plan has a new address, so it is
 * automatically treated as "needs download" and the old copy is cleaned up.
 */

/** Stable key for a media address: just the /media/... path, with no host and no access_token. */
export function mediaKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;
  let path: string;
  let search = '';
  try {
    const u = new URL(raw, 'http://placeholder.invalid');
    path = u.pathname;
    const params = new URLSearchParams(u.search);
    params.delete('access_token');
    const rest = params.toString();
    search = rest ? `?${rest}` : '';
  } catch {
    return null;
  }
  // Only the app's own stored media can be saved. Hosted-elsewhere images (e.g. Cloudinary) are left alone.
  if (!path.startsWith('/media/')) return null;
  return `${path}${search}`;
}

export interface PlanLike {
  id: string;
  floorId: string;
  towerId?: string;
  fileUrl?: string | null;
  file_url?: string | null;
  rawPdfUrl?: string | null;
  raw_pdf_url?: string | null;
  mediaAssets?: { original_url?: string; rawPdfUrl?: string | null; raw_pdf_url?: string | null }[];
}

/** The media keys a floor plan needs to open: its image, and its PDF when it has one. */
export function planMediaKeys(plan: PlanLike): string[] {
  const image = plan.fileUrl ?? plan.file_url ?? plan.mediaAssets?.[0]?.original_url ?? null;
  const pdf = plan.rawPdfUrl ?? plan.raw_pdf_url ?? plan.mediaAssets?.[0]?.rawPdfUrl ?? plan.mediaAssets?.[0]?.raw_pdf_url ?? null;
  const keys = [mediaKey(image), mediaKey(pdf)].filter((k): k is string => !!k);
  return [...new Set(keys)];
}

export type FloorOfflineStatus = 'available' | 'needs-download' | 'no-plan' | 'unsupported';

/**
 * A floor is available offline only when EVERY file its plan needs is saved.
 * 'unsupported' = it has a plan, but the plan lives somewhere the pack cannot save from.
 */
export function floorStatus(plan: PlanLike | undefined, saved: ReadonlySet<string>): FloorOfflineStatus {
  if (!plan) return 'no-plan';
  const keys = planMediaKeys(plan);
  const hasAnyAddress = !!(plan.fileUrl ?? plan.file_url ?? plan.mediaAssets?.[0]?.original_url);
  if (!keys.length) return hasAnyAddress ? 'unsupported' : 'no-plan';
  return keys.every(k => saved.has(k)) ? 'available' : 'needs-download';
}

export interface TowerSummary {
  towerId: string;
  towerName: string;
  floors: number;
  available: number;
  needsDownload: number;
}

export interface FloorRef {
  id: string;
  towerId: string;
}

/** Per-tower counts for the pack screen. Floors with no plan are ignored (nothing to save). */
export function summariseTowers(
  towers: { id: string; name: string }[],
  floors: FloorRef[],
  planOfFloor: (floorId: string) => PlanLike | undefined,
  saved: ReadonlySet<string>,
): TowerSummary[] {
  return towers.map(t => {
    let total = 0;
    let available = 0;
    let needs = 0;
    for (const f of floors) {
      if (f.towerId !== t.id) continue;
      const s = floorStatus(planOfFloor(f.id), saved);
      if (s === 'no-plan' || s === 'unsupported') continue;
      total += 1;
      if (s === 'available') available += 1;
      else needs += 1;
    }
    return { towerId: t.id, towerName: t.name, floors: total, available, needsDownload: needs };
  }).filter(t => t.floors > 0);
}

/** "3 floors in Tower B are not downloaded" (the warning shown before leaving coverage). */
export function leavingCoverageWarnings(summaries: TowerSummary[]): string[] {
  return summaries
    .filter(t => t.needsDownload > 0)
    .map(t => `${t.needsDownload} floor${t.needsDownload === 1 ? '' : 's'} in ${t.towerName} ${t.needsDownload === 1 ? 'is' : 'are'} not downloaded`);
}

/**
 * Every distinct file to save for these floors. A plan image shared by several floors appears once, so it is stored
 * and downloaded once.
 */
export function keysToDownload(
  floorIds: string[],
  planOfFloor: (floorId: string) => PlanLike | undefined,
  saved: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const id of floorIds) {
    const plan = planOfFloor(id);
    if (!plan) continue;
    for (const k of planMediaKeys(plan)) if (!saved.has(k)) out.add(k);
  }
  return [...out];
}

/** Saved files no current plan refers to any more (the plan was replaced). Safe to delete to free space. */
export function orphanKeys(saved: Iterable<string>, currentlyNeeded: ReadonlySet<string>): string[] {
  return [...saved].filter(k => !currentlyNeeded.has(k));
}

/** A file name that keeps the original extension (the viewer decides PDF vs image from it). */
export function savedFileName(key: string, hash: string): string {
  const path = key.split('?')[0];
  const dot = path.lastIndexOf('.');
  const ext = dot > path.lastIndexOf('/') ? path.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
  return `${hash}${ext}`;
}

/** Small stable hash for file names (not security related). */
export function shortHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Does this start like a real plan file (PNG, JPEG, PDF, WebP)? A saved error page or an empty file must never be
 * kept as if it were a floor plan.
 */
export function looksLikePlanFile(head: Uint8Array): boolean {
  const starts = (sig: number[]) => sig.every((b, i) => head[i] === b);
  return (
    starts([0x89, 0x50, 0x4e, 0x47])         // PNG
    || starts([0xff, 0xd8, 0xff])            // JPEG
    || starts([0x25, 0x50, 0x44, 0x46])      // %PDF
    || (starts([0x52, 0x49, 0x46, 0x46]) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) // WebP
  );
}
