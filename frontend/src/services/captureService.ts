import apiClient from './apiClient';
import type {
  ApiResponse,
  PaginatedResponse,
  CaptureResponse,
  CreateCaptureRequest,
  UpdateCaptureReviewRequest,
  CloudinarySignatureResponse,
} from '@/types/dto';

export interface ListCapturesParams {
  skip?: number;
  limit?: number;
  project_id?: string;
  tower_id?: string;
  review_status?: string;
  status?: string;
}

export const captureService = {
  async listCaptures(params: ListCapturesParams = {}): Promise<PaginatedResponse<CaptureResponse>> {
    const { data } = await apiClient.get<ApiResponse<PaginatedResponse<CaptureResponse>>>('/captures', { params });
    return data.data!;
  },

  async getCapture(captureId: string): Promise<CaptureResponse> {
    const { data } = await apiClient.get<ApiResponse<CaptureResponse>>(`/captures/${captureId}`);
    return data.data!;
  },

  async createCapture(payload: CreateCaptureRequest): Promise<CaptureResponse> {
    const { data } = await apiClient.post<ApiResponse<CaptureResponse>>('/captures', payload);
    return data.data!;
  },

  async updateReview(captureId: string, payload: UpdateCaptureReviewRequest): Promise<CaptureResponse> {
    const { data } = await apiClient.put<ApiResponse<CaptureResponse>>(`/captures/${captureId}/review`, payload);
    return data.data!;
  },

  async deleteCapture(captureId: string): Promise<void> {
    await apiClient.delete(`/captures/${captureId}`);
  },

  async getUploadSignature(folder: string): Promise<CloudinarySignatureResponse> {
    const { data } = await apiClient.post<ApiResponse<CloudinarySignatureResponse>>('/captures/upload-signature', { folder });
    return data.data!;
  },
};
