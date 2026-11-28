import type { BackgroundAnalysisJob, BackgroundProjectRun } from '@/services/constructionProgressService';
import type { AnalyzeJobStatus } from '@/services/constructionProgressService';

const STATUS: Record<string, AnalyzeJobStatus> = {
  queued: 'pending',
  running: 'processing',
  completed: 'completed',
  partial: 'completed', // finished, with some floors failed: still ready to open
  failed: 'failed',
};

/** Where a project run's result is shown. */
export function projectRunPath(projectId: string): string {
  return `/construction-progress/project-analysis?project=${encodeURIComponent(projectId)}`;
}

/**
 * Shape a whole-project run like a floor job so the app-wide indicator and watcher can treat both the same.
 * Unlike a floor job, a project run knows its real progress: floors finished out of floors queued.
 */
export function projectRunToJob(run: BackgroundProjectRun): BackgroundAnalysisJob {
  const queued = run.floorsQueued ?? 0;
  const finished = (run.floorsDone ?? 0) + (run.floorsFailed ?? 0);
  const scope = run.towerId ? run.towerName || 'tower' : 'whole project';
  return {
    jobId: `project:${run.jobId}`,
    floorId: '',
    kind: 'project',
    projectId: run.projectId,
    status: STATUS[run.state] ?? 'processing',
    createdAt: run.createdAt ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.finishedAt ?? null,
    runInBackground: true,
    floorLabel: `${run.projectName || 'Project'} · ${scope}`,
    progressPct: queued > 0 ? (finished / queued) * 100 : null,
    floorsDone: finished,
    floorsQueued: queued,
    currentFloorName: run.current?.floorName ?? null,
    error: run.state === 'failed' ? run.errors?.[0]?.message ?? null : null,
  };
}
