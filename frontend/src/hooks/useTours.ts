import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tourService, type ListToursParams } from '@/services/tourService';
import type { TourStatusDTO } from '@/types/dto';

export const TOUR_KEYS = {
  all: ['tours'] as const,
  list: (params?: ListToursParams) => ['tours', 'list', params] as const,
  detail: (id: string) => ['tours', 'detail', id] as const,
};

export function useTours(params?: ListToursParams) {
  return useQuery({
    queryKey: TOUR_KEYS.list(params),
    queryFn: () => tourService.listTours(params),
  });
}

export function useTour(tourId: string) {
  return useQuery({
    queryKey: TOUR_KEYS.detail(tourId),
    queryFn: () => tourService.getTour(tourId),
    enabled: Boolean(tourId),
  });
}

export function useUpdateTourStatus(tourId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: TourStatusDTO) => tourService.updateStatus(tourId, { status }),
    onMutate: async (status) => {
      await qc.cancelQueries({ queryKey: TOUR_KEYS.detail(tourId) });
      const prev = qc.getQueryData(TOUR_KEYS.detail(tourId));
      qc.setQueryData(TOUR_KEYS.detail(tourId), (old: unknown) =>
        old ? { ...(old as object), status } : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(TOUR_KEYS.detail(tourId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TOUR_KEYS.detail(tourId) });
      qc.invalidateQueries({ queryKey: TOUR_KEYS.list() });
    },
  });
}
