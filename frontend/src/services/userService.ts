import apiClient from './apiClient';
import type {
  ApiResponse,
  PaginatedResponse,
  UserResponse,
  UserDetailResponse,
  UserListResponse,
  UpdateUserRequest,
} from '@/types/dto';

export interface ListUsersParams {
  skip?: number;
  limit?: number;
  role?: string;
  is_active?: boolean;
}

export const userService = {
  async listUsers(params: ListUsersParams = {}): Promise<PaginatedResponse<UserListResponse>> {
    const { data } = await apiClient.get<ApiResponse<PaginatedResponse<UserListResponse>>>('/users', { params });
    return data.data!;
  },

  async getMe(): Promise<UserDetailResponse> {
    const { data } = await apiClient.get<ApiResponse<UserDetailResponse>>('/users/me');
    return data.data!;
  },

  async getUser(userId: string): Promise<UserDetailResponse> {
    const { data } = await apiClient.get<ApiResponse<UserDetailResponse>>(`/users/${userId}`);
    return data.data!;
  },

  async updateUser(userId: string, payload: UpdateUserRequest): Promise<UserResponse> {
    const { data } = await apiClient.put<ApiResponse<UserResponse>>(`/users/${userId}`, payload);
    return data.data!;
  },

  async setUserPassword(userId: string, newPassword: string): Promise<void> {
    await apiClient.put(`/users/${userId}/password`, { new_password: newPassword });
  },

  async deactivateUser(userId: string): Promise<void> {
    await apiClient.delete(`/users/${userId}`);
  },

  async setUserProjects(userId: string, projectIds: string[]): Promise<string[]> {
    const { data } = await apiClient.put<ApiResponse<{ assigned_project_ids: string[] }>>(
      `/users/${userId}/projects`,
      { project_ids: projectIds },
    );
    return data.data?.assigned_project_ids ?? [];
  },

  async getFavoriteTours(): Promise<string[]> {
    const { data } = await apiClient.get<ApiResponse<{ tour_ids: string[] }>>('/users/me/favorite-tours');
    return data.data?.tour_ids ?? [];
  },

  async setFavoriteTours(tourIds: string[]): Promise<string[]> {
    const { data } = await apiClient.put<ApiResponse<{ tour_ids: string[] }>>(
      '/users/me/favorite-tours',
      { tour_ids: tourIds },
    );
    return data.data?.tour_ids ?? tourIds;
  },
};
