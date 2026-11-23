import { resolveMediaUrl } from '@/config/env';

/** The part of GPano orientation a panorama view needs. Same shape the tour viewer uses. */
export interface PanoOrientation {
  poseHeadingDegrees: number;
  posePitchDegrees: number;
  poseRollDegrees: number;
  initialViewHeadingDegrees: number;
  initialViewPitchDegrees: number;
  initialHorizontalFovDegrees: number;
}

export const DEFAULT_PANO_ORIENTATION: PanoOrientation = {
  poseHeadingDegrees: 0,
  posePitchDegrees: 0,
  poseRollDegrees: 0,
  initialViewHeadingDegrees: 0,
  initialViewPitchDegrees: 0,
  initialHorizontalFovDegrees: 72,
};

type MediaAsset = {
  original_url?: string;
  secure_url?: string;
  processed_panorama_url?: string | null;
  processedPanoramaUrl?: string | null;
  stitch?: { gpano?: Partial<PanoOrientation> } | null;
};

/** GET /captures/{id} returns the stored capture document as is (camelCase and snake_case both occur). */
export interface RawCapture {
  id: string;
  roomName?: string;
  mediaAssets?: MediaAsset[];
  processedPanoramaUrl?: string | null;
  processed_panorama_url?: string | null;
  original_url?: string | null;
  originalFileUrl?: string | null;
  thumbnailUrl?: string | null;
  capturedAt?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
}

export interface PanoramaSource {
  /** Address of the image to show, or null when the capture has no usable image yet. */
  url: string | null;
  /** True when this is the stitched equirectangular file (certainly a 360). False = the raw upload, which may be a plain photo. */
  stitched: boolean;
  orientation: PanoOrientation;
}

/** Zoom level for Photo Sphere Viewer from a horizontal field of view (minFov 30, maxFov 90). */
export function zoomFromHfov(hfov: number, minFov = 30, maxFov = 90): number {
  const c = Math.min(maxFov, Math.max(minFov, hfov));
  return Math.round(((maxFov - c) / (maxFov - minFov)) * 100);
}

/**
 * Pick the 360 image of a capture. The stitched panorama is preferred over the raw upload, exactly like the
 * tour viewer, so a drag in the evidence view looks the same as in the tour.
 */
export function panoramaSourceOf(cap: RawCapture | null | undefined): PanoramaSource {
  if (!cap) return { url: null, stitched: false, orientation: DEFAULT_PANO_ORIENTATION };
  const first = cap.mediaAssets?.[0];
  const stitchedRaw =
    first?.processed_panorama_url
    ?? first?.processedPanoramaUrl
    ?? cap.processedPanoramaUrl
    ?? cap.processed_panorama_url
    ?? null;
  const rawFallback = first?.original_url ?? first?.secure_url ?? cap.originalFileUrl ?? cap.original_url ?? null;
  const stitchedUrl = resolveMediaUrl(stitchedRaw || undefined) ?? null;
  const url = stitchedUrl ?? resolveMediaUrl(rawFallback || undefined) ?? null;
  const g = first?.stitch?.gpano;
  return {
    url,
    stitched: !!stitchedUrl,
    orientation: g
      ? {
        poseHeadingDegrees: g.poseHeadingDegrees ?? 0,
        posePitchDegrees: g.posePitchDegrees ?? 0,
        poseRollDegrees: g.poseRollDegrees ?? 0,
        initialViewHeadingDegrees: g.initialViewHeadingDegrees ?? 0,
        initialViewPitchDegrees: g.initialViewPitchDegrees ?? 0,
        initialHorizontalFovDegrees: g.initialHorizontalFovDegrees ?? 72,
      }
      : DEFAULT_PANO_ORIENTATION,
  };
}

export function captureTime(cap: RawCapture | null | undefined): string | null {
  return cap?.capturedAt || cap?.createdAt || cap?.created_at || null;
}

// ── How an image should be shown ─────────────────────────────────────────────

/**
 * 'flat'            not about 2:1: a normal photo, shown as a plain image.
 * 'dualfisheye'     about 2:1 with dark corners: a RAW 360 camera file (two fisheye circles).
 * 'equirectangular' about 2:1 with filled corners: a genuine stitched 360.
 * Same rule as the tour viewer (a raw dual fisheye and a true equirectangular are both about 2:1, so the corners decide).
 */
export type Projection = 'flat' | 'dualfisheye' | 'equirectangular';

const RATIO_MIN = 1.8;
const RATIO_MAX = 2.2;

export function classifyProjection(img: HTMLImageElement): Projection {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return 'flat';
  const ratio = w / h;
  if (ratio < RATIO_MIN || ratio > RATIO_MAX) return 'flat';
  try {
    const cw = 128;
    const ch = 64;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'equirectangular';
    ctx.drawImage(img, 0, 0, cw, ch);
    const patch = 12;
    const corners: Array<[number, number]> = [[0, 0], [cw - patch, 0], [0, ch - patch], [cw - patch, ch - patch]];
    let dark = 0;
    for (const [sx, sy] of corners) {
      const { data } = ctx.getImageData(sx, sy, patch, patch);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (sum / (data.length / 4) < 24) dark++;
    }
    return dark >= 3 ? 'dualfisheye' : 'equirectangular';
  } catch {
    // A canvas tainted by CORS cannot be read: treat it as a stitched 360.
    return 'equirectangular';
  }
}
