import apiClient from './apiClient';
import type {
  ApiResponse,
  PaginatedResponse,
  TourResponse,
  UpdateTourStatusRequest,
} from '@/types/dto';

export interface ListToursParams {
  skip?: number;
  limit?: number;
  project_id?: string;
  tower_id?: string;
  status?: string;
}

export const tourService = {
  async listTours(params: ListToursParams = {}): Promise<PaginatedResponse<TourResponse>> {
    const { data } = await apiClient.get<ApiResponse<PaginatedResponse<TourResponse>>>('/tours', { params });
    return data.data!;
  },

  async getTour(tourId: string): Promise<TourResponse> {
    const { data } = await apiClient.get<ApiResponse<TourResponse>>(`/tours/${tourId}`);
    return data.data!;
  },

  async updateStatus(tourId: string, payload: UpdateTourStatusRequest): Promise<TourResponse> {
    const { data } = await apiClient.put<ApiResponse<TourResponse>>(`/tours/${tourId}/status`, payload);
    return data.data!;
  },

  async publishTour(tourId: string): Promise<TourResponse> {
    return tourService.updateStatus(tourId, { status: 'published' });
  },
};
