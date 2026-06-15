import apiClient from './apiClient';
import type {
  ApiResponse,
  OrganizationResponse,
  OrganizationMeResponse,
  CreateOrganizationRequest,
  UpdateOrganizationRequest,
} from '@/types/dto';

export const organizationService = {
  async getMyOrg(): Promise<OrganizationMeResponse> {
    const { data } = await apiClient.get<ApiResponse<OrganizationMeResponse>>('/organizations/me');
    return data.data!;
  },

  async updateMyOrg(payload: UpdateOrganizationRequest): Promise<OrganizationResponse> {
    const { data } = await apiClient.put<ApiResponse<OrganizationResponse>>('/organizations/me', payload);
    return data.data!;
  },

  async createOrganization(payload: CreateOrganizationRequest): Promise<OrganizationResponse> {
    const { data } = await apiClient.post<ApiResponse<OrganizationResponse>>('/organizations', payload);
    return data.data!;
  },
};
