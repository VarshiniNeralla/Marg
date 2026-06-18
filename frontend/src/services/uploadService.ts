import apiClient from './apiClient';
import type { ApiResponse } from '@/types/dto';

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
  width?: number | null;
  height?: number | null;
  pages?: number | null;
}

export interface UploadCaptureFilesResponse {
  files: UploadedFileResponse[];
  count: number;
}

export async function uploadCaptureFiles(
  files: File[],
  onProgress?: (percent: number) => void,
  captureId?: string,
): Promise<UploadCaptureFilesResponse> {
  return uploadMediaFiles('/uploads/captures', files, onProgress, captureId ? { capture_id: captureId } : undefined);
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

async function uploadMediaFiles(
  endpoint: string,
  files: File[],
  onProgress?: (percent: number) => void,
  params?: Record<string, string>,
): Promise<UploadCaptureFilesResponse> {
  const form = new FormData();
  files.forEach(file => form.append('files', file));

  const { data } = await apiClient.post<ApiResponse<UploadCaptureFilesResponse>>(endpoint, form, {
    params,
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: event => {
      if (!event.total || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    },
  });

  return data.data!;
}
