import apiClient from './apiClient';
import type {
  ApiResponse,
  PaginatedResponse,
  DefectResponse,
  CreateDefectRequest,
  UpdateDefectRequest,
} from '@/types/dto';

export interface ListDefectsParams {
  skip?: number;
  limit?: number;
  project_id?: string;
  status?: string;
  severity?: string;
}

export const defectService = {
  async listDefects(params: ListDefectsParams = {}): Promise<PaginatedResponse<DefectResponse>> {
    const { data } = await apiClient.get<ApiResponse<PaginatedResponse<DefectResponse>>>('/defects', { params });
    return data.data!;
  },

  async getDefect(defectId: string): Promise<DefectResponse> {
    const { data } = await apiClient.get<ApiResponse<DefectResponse>>(`/defects/${defectId}`);
    return data.data!;
  },

  async createDefect(payload: CreateDefectRequest): Promise<DefectResponse> {
    const { data } = await apiClient.post<ApiResponse<DefectResponse>>('/defects', payload);
    return data.data!;
  },

  async updateDefect(defectId: string, payload: UpdateDefectRequest): Promise<DefectResponse> {
    const { data } = await apiClient.put<ApiResponse<DefectResponse>>(`/defects/${defectId}`, payload);
    return data.data!;
  },
};
