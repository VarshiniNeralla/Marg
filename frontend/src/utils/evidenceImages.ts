import apiClient from '@/services/apiClient';
import type { ApiResponse } from '@/types/dto';

/**
 * GET /captures/{id} returns the raw stored capture document (camelCase
 * fields) — see EvidenceLightbox.tsx for why this can't go through the
 * mistyped captureService.getCapture() wrapper.
 */
interface RawCapture {
  id: string;
  roomName?: string;
  processedPanoramaUrl?: string | null;
  original_url?: string | null;
  originalFileUrl?: string | null;
  thumbnailUrl?: string | null;
}

function captureUrl(cap: RawCapture): string | undefined {
  return cap.processedPanoramaUrl || cap.original_url || cap.originalFileUrl || cap.thumbnailUrl || undefined;
}

/**
 * Resolves a set of capture ids to their real image URLs in one batched call,
 * so a report builder can embed actual evidence photos rather than just
 * listing opaque capture ids. Ids that fail to resolve (deleted capture,
 * network error) are simply absent from the returned map.
 */
export async function resolveCaptureImageUrls(captureIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(captureIds));
  const results = await Promise.all(
    unique.map(id =>
      apiClient.get<ApiResponse<RawCapture>>(`/captures/${id}`)
        .then(res => res.data.data ?? null)
        .catch(() => null),
    ),
  );
  const map = new Map<string, string>();
  results.forEach(cap => {
    if (!cap) return;
    const url = captureUrl(cap);
    if (url) map.set(cap.id, url);
  });
  return map;
}
