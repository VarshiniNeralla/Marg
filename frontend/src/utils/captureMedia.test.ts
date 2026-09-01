import { describe, expect, it } from 'vitest';
import { resolveCaptureImageCandidates } from './captureMedia';

describe('resolveCaptureImageCandidates', () => {
  it('prefers thumbnail_url over full panorama for gallery cards', () => {
    const candidates = resolveCaptureImageCandidates({
      id: 'c1',
      thumbnail_url: '/media/SiteVision/captures/org/thumbs/a_thumb.jpg',
      processedPanoramaUrl: '/media/SiteVision/captures/org/a.jpg',
      original_url: '/media/SiteVision/captures/org/a.jpg',
    } as never);

    expect(candidates[0]).toContain('thumb');
    expect(candidates.some(u => u.includes('/a.jpg') && !u.includes('thumb'))).toBe(true);
  });
});
