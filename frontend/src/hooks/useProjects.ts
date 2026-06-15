import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectService, type ListProjectsParams } from '@/services/projectService';
import type { CreateProjectRequest, UpdateProjectRequest } from '@/types/dto';

export const PROJECT_KEYS = {
  all: ['projects'] as const,
  list: (params?: ListProjectsParams) => ['projects', 'list', params] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
};

export function useProjects(params?: ListProjectsParams) {
  return useQuery({
    queryKey: PROJECT_KEYS.list(params),
    queryFn: () => projectService.listProjects(params),
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: PROJECT_KEYS.detail(projectId),
    queryFn: () => projectService.getProject(projectId),
    enabled: Boolean(projectId),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProjectRequest) => projectService.createProject(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECT_KEYS.all }),
  });
}

export function useUpdateProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateProjectRequest) => projectService.updateProject(projectId, payload),
    onSuccess: (updated) => {
      qc.setQueryData(PROJECT_KEYS.detail(projectId), updated);
      qc.invalidateQueries({ queryKey: PROJECT_KEYS.list() });
    },
  });
}
