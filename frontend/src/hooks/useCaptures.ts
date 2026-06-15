import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { captureService, type ListCapturesParams } from '@/services/captureService';
import type { UpdateCaptureReviewRequest } from '@/types/dto';

export const CAPTURE_KEYS = {
  all: ['captures'] as const,
  list: (params?: ListCapturesParams) => ['captures', 'list', params] as const,
  detail: (id: string) => ['captures', 'detail', id] as const,
};

export function useCaptures(params?: ListCapturesParams) {
  return useQuery({
    queryKey: CAPTURE_KEYS.list(params),
    queryFn: () => captureService.listCaptures(params),
  });
}

export function useCapture(captureId: string) {
  return useQuery({
    queryKey: CAPTURE_KEYS.detail(captureId),
    queryFn: () => captureService.getCapture(captureId),
    enabled: Boolean(captureId),
  });
}

export function useUpdateCaptureReview(captureId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateCaptureReviewRequest) =>
      captureService.updateReview(captureId, payload),
    // Optimistic update
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: CAPTURE_KEYS.detail(captureId) });
      const prev = qc.getQueryData(CAPTURE_KEYS.detail(captureId));
      qc.setQueryData(CAPTURE_KEYS.detail(captureId), (old: unknown) =>
        old ? { ...(old as object), review_status: payload.review_status } : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(CAPTURE_KEYS.detail(captureId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CAPTURE_KEYS.detail(captureId) });
      qc.invalidateQueries({ queryKey: CAPTURE_KEYS.list() });
    },
  });
}
