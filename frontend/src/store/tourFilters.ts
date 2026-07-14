import type { MockTour } from '@/data/mockData';

/** Absolute uploaded media URL (Cloudinary / CDN). */
export function isHttpMediaUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/**
 * Real Virtual Tour: a published floor walkthrough built from engineer pin captures.
 * Excludes Workflow-page `generateTour` stubs (processing / no floorPlanId / no steps)
 * and any record without uploaded panorama media — so admin / manager / engineer
 * all see the same engineer-uploaded catalog.
 */
export function isLiveUploadedTour(tour: MockTour): boolean {
  if (!tour || tour.status !== 'published') return false;
  const rec = tour as MockTour & {
    floorPlanId?: string;
    panoramaUrls?: Array<string | null | undefined>;
    panorama_urls?: Array<string | null | undefined>;
    processedPanoramaUrl?: string | null;
    processed_panorama_url?: string | null;
    thumbnailUrl?: string | null;
    thumbnail_url?: string | null;
  };
  const isWalkthrough = Boolean(rec.floorPlanId) || (Array.isArray(rec.steps) && rec.steps.length > 0);
  if (!isWalkthrough) return false;

  const candidates: unknown[] = [
    rec.thumbnailUrl,
    rec.thumbnail_url,
    rec.processedPanoramaUrl,
    rec.processed_panorama_url,
    ...(rec.panoramaUrls ?? []),
    ...(rec.panorama_urls ?? []),
  ];
  for (const step of rec.steps ?? []) {
    candidates.push(step.panoramaUrl, step.thumbnailUrl);
  }
  return candidates.some(isHttpMediaUrl);
}
