import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  constructionProgressService, type FloorScope, type ScopeApplyTo,
} from '@/services/constructionProgressService';

export const scopeKey = (floorId: string) => ['cp-floor-scope', floorId] as const;

/** The floor's activity list (which core activities the AI assesses). Default is everything ticked. */
export function useFloorScope(floorId: string | undefined) {
  return useQuery({
    queryKey: scopeKey(floorId ?? ''),
    queryFn: () => constructionProgressService.getFloorScope(floorId!),
    enabled: !!floorId,
    staleTime: 15_000,
  });
}

export function useSaveFloorScope(floorId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { activityIds: string[]; applyTo: ScopeApplyTo }) =>
      constructionProgressService.saveFloorScope(floorId!, vars.activityIds, vars.applyTo),
    onSuccess: (scope: FloorScope) => {
      qc.setQueryData(scopeKey(floorId ?? ''), scope);
      // Other floors may have changed too (tower / project), and overviews show scope size.
      void qc.invalidateQueries({ queryKey: ['cp-floor-scope'] });
      void qc.invalidateQueries({ queryKey: ['cp-project-overview'] });
    },
  });
}
