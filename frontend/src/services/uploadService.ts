import apiClient from './apiClient';
import { useAuthStore } from '@store/authStore';
import { API_V1_URL } from '@/config/env';
import type { ApiResponse } from '@/types/dto';
import { compressImageForUpload } from '@/utils/compressImage';

export interface ImageUploadResponse {
  url: string;
  public_id: string;
  width?: number;
  height?: number;
}

/**
 * Upload a single image (project cover / avatar).
 *
 * Uses fetch — not axios — because apiClient defaults to Content-Type:
 * application/json. Axios often keeps that (or a bare multipart/form-data
 * without a boundary) on FormData posts, and FastAPI then returns 422
 * "file field required". fetch leaves Content-Type unset so the browser
 * adds the correct multipart boundary.
 *
 * Large photos are compressed client-side first (server limit is 5 MB).
 */
export async function uploadImage(
  file: File,
  folder = 'thumbnails',
  _onProgress?: (percent: number) => void,
): Promise<ImageUploadResponse> {
  const compressed = await compressImageForUpload(file);
  const form = new FormData();
  form.append('file', compressed, compressed.name || 'thumbnail.jpg');

  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {
    'ngrok-skip-browser-warning': 'true',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `${API_V1_URL}/uploads/image?folder=${encodeURIComponent(folder)}`,
    {
      method: 'POST',
      headers,
      body: form,
      credentials: 'include',
    },
  );

  let body: ApiResponse<ImageUploadResponse> & {
    detail?: unknown;
    error?: string;
    message?: string;
  } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }

  if (!res.ok) {
    const detail = body.detail;
    let message = body.message || `Upload failed (${res.status})`;
    if (typeof detail === 'string') {
      message = detail;
    } else if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { message?: string; msg?: string };
      message = first.message || first.msg || message;
    }
    throw { status: res.status, message, detail };
  }

  if (!body.data?.url) {
    throw { status: res.status, message: 'Upload succeeded but no image URL was returned.' };
  }
  return body.data;
}

export interface UploadedFileResponse {
  original_url: string;
  thumbnail_url: string;
  public_id: string;
  format: string;
  size: number;
  uploaded_at: string;
  resource_type: string;
  original_filename: string;
  original_file_url?: string;
  processed_panorama_url?: string | null;
  thumbnailUrl?: string;
  preview_url?: string;
  file_type?: string;
  processing_status?: 'uploaded' | 'queued' | 'processing' | 'converted' | 'reviewed' | 'published' | 'failed';
  /** Present only while a raw 360 capture is stitching in the background. */
  stitchJobId?: string;
  width?: number | null;
  height?: number | null;
  pages?: number | null;
  raw_pdf_url?: string | null;
}

export interface UploadCaptureFilesResponse {
  files: UploadedFileResponse[];
  count: number;
  /** How many of `files` are still stitching in the background (202 response). */
  pendingCount?: number;
}

export type StitchJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface StitchJobResponse {
  jobId: string;
  status: StitchJobStatus;
  asset: UploadedFileResponse | null;
  error: string | null;
}

/**
 * Single-shot poll of a background stitch job.
 *
 * Deliberately NOT a bounded retry loop like progressAnalysisService's
 * runUntilComplete (which throws "timed out" after 90s) — abandoning a capture
 * is exactly what must never happen here. The caller (fileUploadQueue) drives
 * the cadence from its own durable timer, so polling survives an app restart.
 */
export async function getCaptureStitchJob(jobId: string): Promise<StitchJobResponse> {
  const { data } = await apiClient.get<ApiResponse<StitchJobResponse>>(
    `/uploads/captures/jobs/${jobId}`,
  );
  return data.data!;
}

export async function uploadCaptureFiles(
  files: File[],
  onProgress?: (percent: number) => void,
  captureId?: string,
  signal?: AbortSignal,
): Promise<UploadCaptureFilesResponse> {
  return uploadMediaFiles(
    '/uploads/captures',
    files,
    onProgress,
    captureId ? { capture_id: captureId } : undefined,
    signal,
  );
}

export async function uploadFloorPlanFiles(
  files: File[],
  onProgress?: (percent: number) => void,
  floorPlanId?: string,
): Promise<UploadCaptureFilesResponse> {
  return uploadMediaFiles('/uploads/floorplans', files, onProgress, floorPlanId ? { floor_plan_id: floorPlanId } : undefined);
}

export async function uploadAvatarFiles(
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<UploadCaptureFilesResponse> {
  return uploadMediaFiles('/uploads/avatars', files, onProgress);
}

/**
 * DO NOT add a client-side AbortController/stall watchdog here.
 *
 * A previous attempt aborted the request after 25s of "no upload progress",
 * intending to catch a Cloudflare quick tunnel silently dropping a large
 * (~12-15MB) multipart body. It backfired badly and is worth recording so it
 * isn't reintroduced:
 *
 *  - This endpoint is SYNCHRONOUS server-side: it stitches the dual-fisheye
 *    capture (~25-35s) and uploads the result to Cloudinary before responding.
 *    Throughout that window the client has nothing left to send, so no
 *    upload-progress events fire — indistinguishable from a stalled socket if
 *    you only watch progress events.
 *  - Refining the watchdog to stop once `event.loaded >= event.total` did not
 *    help: in the Capacitor Android WebView that final "fully sent" progress
 *    event never arrives (the native HTTP layer does not surface it), so the
 *    watchdog never disarmed and kept aborting healthy requests anyway.
 *  - Result, confirmed on-device: every capture was cancelled at ~25s and
 *    retried by the durable queue forever. The backend logs showed the same
 *    two files being fully re-stitched over and over, cloudflared logged
 *    `Incoming request ended abruptly: context canceled`, and 28 duplicate
 *    assets accumulated in Cloudinary from what should have been 2 captures.
 *
 * The correct backstop is apiClient's own finite `timeout` (see apiClient.ts),
 * which turns a genuinely dead socket into a normal retryable error without
 * needing to guess whether silence means "stalled" or "server still working".
 */
async function uploadMediaFiles(
  endpoint: string,
  files: File[],
  onProgress?: (percent: number) => void,
  params?: Record<string, string>,
  signal?: AbortSignal,
): Promise<UploadCaptureFilesResponse> {
  const form = new FormData();
  files.forEach(file => form.append('files', file));

  const { data } = await apiClient.post<ApiResponse<UploadCaptureFilesResponse>>(endpoint, form, {
    params,
    // Let the browser set multipart boundary; clearing apiClient's JSON default.
    headers: { 'Content-Type': undefined as unknown as string },
    signal,
    onUploadProgress: event => {
      if (!event.total || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    },
  });

  return data.data!;
}
