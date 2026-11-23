import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({
  resolveMediaUrl: (u: string | null | undefined) => (u ? `https://media.test/${u}` : null),
}));

import { DEFAULT_PANO_ORIENTATION, captureTime, panoramaSourceOf, zoomFromHfov } from './panoramaSource';

describe('panoramaSourceOf', () => {
  it('prefers the stitched panorama over the raw upload', () => {
    const s = panoramaSourceOf({ id: '1', mediaAssets: [{ processed_panorama_url: 'pano.jpg', original_url: 'raw.jpg' }] });
    expect(s).toMatchObject({ url: 'https://media.test/pano.jpg', stitched: true });
  });

  it('finds the stitched file under any of its field names', () => {
    expect(panoramaSourceOf({ id: '1', processedPanoramaUrl: 'a.jpg' }).url).toBe('https://media.test/a.jpg');
    expect(panoramaSourceOf({ id: '1', processed_panorama_url: 'b.jpg' }).stitched).toBe(true);
    expect(panoramaSourceOf({ id: '1', mediaAssets: [{ processedPanoramaUrl: 'c.jpg' }] }).stitched).toBe(true);
  });

  it('uses the raw upload when nothing is stitched, and says so', () => {
    const s = panoramaSourceOf({ id: '1', original_url: 'raw.jpg' });
    expect(s).toMatchObject({ url: 'https://media.test/raw.jpg', stitched: false });
  });

  it('never uses the small thumbnail as the panorama', () => {
    expect(panoramaSourceOf({ id: '1', thumbnailUrl: 'thumb.jpg' }).url).toBeNull();
  });

  it('has no url for a missing or still-stitching capture', () => {
    expect(panoramaSourceOf(null).url).toBeNull();
    expect(panoramaSourceOf({ id: '1' })).toMatchObject({ url: null, stitched: false });
  });

  it('reads the stored orientation and fills the gaps with defaults', () => {
    const s = panoramaSourceOf({
      id: '1', processedPanoramaUrl: 'a.jpg',
      mediaAssets: [{ stitch: { gpano: { poseHeadingDegrees: 12, initialViewHeadingDegrees: 90 } } }],
    });
    expect(s.orientation).toEqual({ ...DEFAULT_PANO_ORIENTATION, poseHeadingDegrees: 12, initialViewHeadingDegrees: 90 });
    expect(panoramaSourceOf({ id: '1', processedPanoramaUrl: 'a.jpg' }).orientation).toEqual(DEFAULT_PANO_ORIENTATION);
  });
});

describe('zoomFromHfov', () => {
  it('maps the field of view onto 0..100 and clamps', () => {
    expect(zoomFromHfov(90)).toBe(0);
    expect(zoomFromHfov(30)).toBe(100);
    expect(zoomFromHfov(60)).toBe(50);
    expect(zoomFromHfov(200)).toBe(0);
    expect(zoomFromHfov(1)).toBe(100);
  });
});

describe('captureTime', () => {
  it('takes the first date that exists', () => {
    expect(captureTime({ id: '1', capturedAt: 'a', createdAt: 'b' })).toBe('a');
    expect(captureTime({ id: '1', created_at: 'c' })).toBe('c');
    expect(captureTime(null)).toBeNull();
  });
});
