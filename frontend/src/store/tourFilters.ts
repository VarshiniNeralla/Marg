import type { MockTour } from '@/data/mockData';

/** Absolute uploaded media URL (Cloudinary / CDN). */
export function isHttpMediaUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/**
 * Real Virtual Tour: a published floor walkthrough built from engineer pin captures.
 * Excludes Workflow-page `generateTour` stubs (no floorPlanId / no steps).
 *
 * Media may live only on linked captures — TourViewer derives panoramas from pins
 * after refresh — so catalog membership must NOT require tour-level HTTP URLs.
 */
export function isLiveUploadedTour(tour: MockTour): boolean {
  if (!tour || tour.status !== 'published') return false;
  const rec = tour as MockTour & {
    floorPlanId?: string;
    floor_plan_id?: string;
    panoramaUrls?: Array<string | null | undefined>;
    panorama_urls?: Array<string | null | undefined>;
    processedPanoramaUrl?: string | null;
    processed_panorama_url?: string | null;
    thumbnailUrl?: string | null;
    thumbnail_url?: string | null;
  };
  const hasFloorPlan = Boolean(rec.floorPlanId || rec.floor_plan_id);
  const hasSteps = Array.isArray(rec.steps) && rec.steps.length > 0;
  if (!hasFloorPlan && !hasSteps) return false;

  // Walkthroughs linked to a floor plan are catalog-valid even when panorama
  // fields are empty (viewer rebuilds steps from capturePins on load).
  if (hasFloorPlan) return true;

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
  // Legacy published step tours without floorPlanId still need at least one media URL.
  return candidates.some(isHttpMediaUrl);
}
