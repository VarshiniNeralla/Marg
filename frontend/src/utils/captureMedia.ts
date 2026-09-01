import type { MockCapture, MockTour, TourStep } from '@/data/mockData';
import { resolveMediaUrl } from '@/config/env';

type MediaAsset = {
  thumbnail_url?: string;
  preview_url?: string;
  processed_panorama_url?: string | null;
  processedPanoramaUrl?: string | null;
  original_url?: string;
  secure_url?: string;
};

type CaptureRecord = MockCapture & Record<string, unknown>;
type TourRecord = MockTour & Record<string, unknown>;

/** Demo panorama stills used when no upload URL is stored yet. */
export const DEMO_THUMBNAIL_URLS = [
  'https://photo-sphere-viewer-data.netlify.app/assets/sphere.jpg',
  'https://photo-sphere-viewer-data.netlify.app/assets/sphere-small.jpg',
  'https://photo-sphere-viewer-data.netlify.app/assets/tour/key-biscayne-1.jpg',
  'https://photo-sphere-viewer-data.netlify.app/assets/tour/key-biscayne-2.jpg',
];

function demoThumbForId(id: string): string {
  let idx = 0;
  for (let i = 0; i < id.length; i++) idx = (idx + id.charCodeAt(i)) % DEMO_THUMBNAIL_URLS.length;
  return DEMO_THUMBNAIL_URLS[idx];
}

/**
 * Ordered image URLs for a capture card (best → fallback).
 *
 * Prefer dedicated gallery thumbs first (small, fast on cellular). Fall back to
 * panorama/original only when thumbs are missing or 404 (legacy path layouts).
 * Tour viewer uses resolveCapturePanoramaUrl separately and always loads full res.
 */
export function resolveCaptureImageCandidates(capture: CaptureRecord): string[] {
  const mediaAssets = capture.mediaAssets as MediaAsset[] | undefined;
  const first = mediaAssets?.[0];

  const raws: Array<string | null | undefined> = [
    (capture.thumbnailUrl as string | undefined),
    (capture.thumbnail_url as string | undefined),
    (capture.previewUrl as string | undefined),
    first?.thumbnail_url,
    first?.preview_url,
    first?.processed_panorama_url,
    first?.processedPanoramaUrl,
    (capture.processedPanoramaUrl as string | undefined),
    (capture.processed_panorama_url as string | undefined),
    first?.original_url,
    first?.secure_url,
    (capture.original_url as string | undefined),
    (capture.originalFileUrl as string | undefined),
  ];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    for (const candidate of expandLocalThumbPaths(raw)) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

/** Map legacy `…/file_thumb.jpg` → also try `…/thumbs/file_thumb.jpg`. */
function expandLocalThumbPaths(url: string | null | undefined): string[] {
  const resolved = resolveMediaUrl(url);
  if (!resolved) return [];
  const out = [resolved];
  const raw = (url || '').trim();
  if (raw.includes('_thumb.') && !raw.includes('/thumbs/')) {
    const alt = raw.replace(/\/([^/]+_thumb\.[^/]+)$/i, '/thumbs/$1');
    const altResolved = resolveMediaUrl(alt);
    if (altResolved && altResolved !== resolved) out.push(altResolved);
  }
  return out;
}

/**
 * Best available preview image for a capture card, or null when the capture has
 * no real image yet.
 *
 * Returns null rather than a stock demo sphere on purpose: with background
 * stitching a capture legitimately has no panorama for ~25s after upload, and
 * substituting an unrelated demo photo would present someone else's image as if
 * it were this site's. Callers must render a placeholder for null.
 */
export function resolveCaptureThumbnailUrl(capture: CaptureRecord): string | null {
  return resolveCaptureImageCandidates(capture)[0] ?? null;
}

/** True when the capture has no usable image URL yet (still stitching or never uploaded). */
export function captureAwaitingPanorama(capture: CaptureRecord): boolean {
  return resolveCaptureImageCandidates(capture).length === 0;
}

/** Stitch job id on a capture, if any (client or media-asset shape). */
export function captureStitchJobId(capture: CaptureRecord): string | undefined {
  const fromCap = capture.stitchJobId as string | undefined;
  if (fromCap) return fromCap;
  const assets = capture.mediaAssets as MediaAsset[] | undefined;
  const fromAsset = (assets?.[0] as { stitchJobId?: string } | undefined)?.stitchJobId;
  return fromAsset || undefined;
}

/** First-step or linked-capture preview for a virtual tour card. */
export function resolveTourThumbnailUrl(tour: TourRecord, captures: MockCapture[]): string {
  const steps = tour.steps as TourStep[] | undefined;
  const stepThumb = steps?.[0]?.thumbnailUrl ?? steps?.[0]?.panoramaUrl;
  if (stepThumb) return resolveMediaUrl(stepThumb) ?? stepThumb;

  const tourThumb =
    (tour.thumbnailUrl as string | undefined) ??
    (tour.thumbnail_url as string | undefined);
  if (tourThumb) return resolveMediaUrl(tourThumb) ?? tourThumb;

  const linked = captures.find(c => c.id === tour.captureId);
  if (linked) {
    const linkedThumb = resolveCaptureThumbnailUrl(linked as CaptureRecord);
    if (linkedThumb) return linkedThumb;
  }

  return demoThumbForId(tour.id);
}
