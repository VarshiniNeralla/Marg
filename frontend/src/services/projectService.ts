import apiClient from './apiClient';
import type {
  ApiResponse,
  PaginatedResponse,
  ProjectResponse,
  CreateProjectRequest,
  UpdateProjectRequest,
} from '@/types/dto';

export interface ListProjectsParams {
  skip?: number;
  limit?: number;
  status?: string;
}

export const projectService = {
  async listProjects(params: ListProjectsParams = {}): Promise<PaginatedResponse<ProjectResponse>> {
    const { data } = await apiClient.get<ApiResponse<PaginatedResponse<ProjectResponse>>>('/projects', { params });
    return data.data!;
  },

  async getProject(projectId: string): Promise<ProjectResponse> {
    const { data } = await apiClient.get<ApiResponse<ProjectResponse>>(`/projects/${projectId}`);
    return data.data!;
  },

  async createProject(payload: CreateProjectRequest): Promise<ProjectResponse> {
    const { data } = await apiClient.post<ApiResponse<ProjectResponse>>('/projects', payload);
    return data.data!;
  },

  async updateProject(projectId: string, payload: UpdateProjectRequest): Promise<ProjectResponse> {
    const { data } = await apiClient.put<ApiResponse<ProjectResponse>>(`/projects/${projectId}`, payload);
    return data.data!;
  },

  async deleteProject(projectId: string): Promise<void> {
    await apiClient.delete(`/projects/${projectId}`);
  },
};
