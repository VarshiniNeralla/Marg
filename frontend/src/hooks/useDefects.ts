import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { defectService, type ListDefectsParams } from '@/services/defectService';
import type { CreateDefectRequest, UpdateDefectRequest } from '@/types/dto';

export const DEFECT_KEYS = {
  all: ['defects'] as const,
  list: (params?: ListDefectsParams) => ['defects', 'list', params] as const,
  detail: (id: string) => ['defects', 'detail', id] as const,
};

export function useDefects(params?: ListDefectsParams) {
  return useQuery({
    queryKey: DEFECT_KEYS.list(params),
    queryFn: () => defectService.listDefects(params),
  });
}

export function useCreateDefect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateDefectRequest) => defectService.createDefect(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: DEFECT_KEYS.all }),
  });
}

export function useUpdateDefect(defectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateDefectRequest) => defectService.updateDefect(defectId, payload),
    onSuccess: (updated) => {
      qc.setQueryData(DEFECT_KEYS.detail(defectId), updated);
      qc.invalidateQueries({ queryKey: DEFECT_KEYS.list() });
    },
  });
}
