import type { MockCapture, MockTour, TourStep } from '@/data/mockData';

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

/** Best available preview image for a capture card or tour tile. */
export function resolveCaptureThumbnailUrl(capture: CaptureRecord): string {
  const mediaAssets = capture.mediaAssets as MediaAsset[] | undefined;
  const first = mediaAssets?.[0];

  return (
    (capture.thumbnailUrl as string | undefined) ??
    (capture.thumbnail_url as string | undefined) ??
    (capture.previewUrl as string | undefined) ??
    first?.thumbnail_url ??
    first?.preview_url ??
    first?.processed_panorama_url ??
    first?.processedPanoramaUrl ??
    (capture.processedPanoramaUrl as string | undefined) ??
    (capture.processed_panorama_url as string | undefined) ??
    first?.original_url ??
    first?.secure_url ??
    (capture.original_url as string | undefined) ??
    (capture.originalFileUrl as string | undefined) ??
    demoThumbForId(capture.id)
  );
}

/** First-step or linked-capture preview for a virtual tour card. */
export function resolveTourThumbnailUrl(tour: TourRecord, captures: MockCapture[]): string {
  const steps = tour.steps as TourStep[] | undefined;
  const stepThumb = steps?.[0]?.thumbnailUrl ?? steps?.[0]?.panoramaUrl;
  if (stepThumb) return stepThumb;

  const tourThumb =
    (tour.thumbnailUrl as string | undefined) ??
    (tour.thumbnail_url as string | undefined);
  if (tourThumb) return tourThumb;

  const linked = captures.find(c => c.id === tour.captureId);
  if (linked) return resolveCaptureThumbnailUrl(linked as CaptureRecord);

  return demoThumbForId(tour.id);
}
