import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { constructionProgressService, type ProjectAnalyzeStart } from '@/services/constructionProgressService';
import { isRunActive } from '@/utils/projectAnalysis';

export const POLL_MS = 4000;

const overviewKey = (projectId: string) => ['cp-project-overview', projectId] as const;
const statusKey = (projectId: string) => ['cp-project-status', projectId] as const;

export function useProjectOverview(projectId: string | undefined) {
  return useQuery({
    queryKey: overviewKey(projectId ?? ''),
    queryFn: () => constructionProgressService.getProjectOverview(projectId!),
    enabled: !!projectId,
    staleTime: 10_000,
  });
}

/** Run status. Polls every few seconds while the run is queued or running, then stops. */
export function useProjectAnalyzeStatus(projectId: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: statusKey(projectId ?? ''),
    queryFn: async () => {
      const run = await constructionProgressService.getProjectAnalyzeStatus(projectId!);
      if (run && !isRunActive(run.state)) {
        // Finished: refresh the numbers once.
        void qc.invalidateQueries({ queryKey: overviewKey(projectId!) });
      }
      return run;
    },
    enabled: !!projectId,
    refetchInterval: (query) => (isRunActive(query.state.data?.state) ? POLL_MS : false),
  });
}

export function useAnalyzeProject(projectId: string | undefined) {
  const qc = useQueryClient();
  // `void` in the variables type keeps `mutate()` / `mutateAsync()` callable with no argument (whole project).
  return useMutation<ProjectAnalyzeStart, Error, { towerId?: string } | void>({
    mutationFn: (vars) =>
      constructionProgressService.analyzeProject(projectId!, { towerId: (vars as { towerId?: string } | undefined)?.towerId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusKey(projectId ?? '') });
    },
  });
}
