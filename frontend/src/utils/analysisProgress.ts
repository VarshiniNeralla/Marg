import { parseServerTime } from './notificationTime';

/**
 * Shared by the floor-analysis overlay and the app-wide "analysis running" indicator.
 *
 * The backend reports only a status (pending / processing / completed / failed), not a real
 * percentage, so progress here is an ESTIMATE driven by elapsed time. It never reaches 100%
 * until the server says the job is done, and the UI labels it as an estimate.
 */

export type AnalysisJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface TimedJob {
  status: AnalysisJobStatus;
  startedAt?: string | null;
  createdAt?: string | null;
}

/** Soft stage labels: elapsed time picks which hint to show. */
export function analysisStageLabel(elapsedSec: number): string {
  if (elapsedSec < 25) return 'Reading floor plan & mapping rooms…';
  if (elapsedSec < 70) return 'Scoring captures against finishing works…';
  if (elapsedSec < 150) return 'Building room heatmap & flat summaries…';
  return 'Finalizing progress report — almost done…';
}

export function formatElapsed(elapsedSec: number): string {
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

/** Keeps moving while we wait; asymptotes toward ~92% so it never looks "done" before the server says so. */
export function softProgressPct(elapsedSec: number): number {
  return Math.min(92, Math.round(8 + 84 * (1 - Math.exp(-Math.max(0, elapsedSec) / 90))));
}

export function isActiveStatus(status: AnalysisJobStatus): boolean {
  return status === 'pending' || status === 'processing';
}

/** Seconds since the job started (or was queued, if it has not started yet). */
export function jobElapsedSec(job: Pick<TimedJob, 'startedAt' | 'createdAt'>, nowMs: number): number {
  const t = parseServerTime(job.startedAt) ?? parseServerTime(job.createdAt);
  if (t === null) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

/** Estimated progress for any job: 100 when completed, the soft estimate while running. */
export function jobProgressPct(job: TimedJob, nowMs: number): number {
  if (job.status === 'completed') return 100;
  return softProgressPct(jobElapsedSec(job, nowMs));
}

/** Splits jobs into what is still running and what finished and has not been dismissed. */
export function splitBackgroundJobs<T extends { jobId: string; status: AnalysisJobStatus }>(
  jobs: readonly T[],
  dismissed: ReadonlySet<string>,
): { active: T[]; finished: T[] } {
  return {
    active: jobs.filter(j => isActiveStatus(j.status)),
    finished: jobs.filter(j => !isActiveStatus(j.status) && !dismissed.has(j.jobId)),
  };
}
