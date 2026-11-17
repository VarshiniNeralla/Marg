import apiClient from './apiClient';
import type { ApiResponse } from '@/types/dto';
import type { Annotation } from '@/utils/annotationGeometry';

export interface ReviewNote {
  id: string;
  tourId: string;
  captureId: string;
  text: string;
  annotation: Annotation | null;
  resolved: boolean;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewReviewNote {
  captureId: string;
  text: string;
  annotation?: Annotation | null;
}

export const reviewNoteService = {
  async list(tourId: string): Promise<ReviewNote[]> {
    const { data } = await apiClient.get<ApiResponse<ReviewNote[]>>(`/tours/${tourId}/review-notes`);
    return data.data ?? [];
  },

  async create(tourId: string, payload: NewReviewNote): Promise<ReviewNote> {
    const { data } = await apiClient.post<ApiResponse<ReviewNote>>(`/tours/${tourId}/review-notes`, payload);
    return data.data!;
  },

  async update(noteId: string, payload: { text?: string; resolved?: boolean }): Promise<ReviewNote> {
    const { data } = await apiClient.put<ApiResponse<ReviewNote>>(`/review-notes/${noteId}`, payload);
    return data.data!;
  },

  async remove(noteId: string): Promise<void> {
    await apiClient.delete(`/review-notes/${noteId}`);
  },
};
