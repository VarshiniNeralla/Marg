import { describe, expect, it } from 'vitest';
import type { BackgroundProjectRun } from '@/services/constructionProgressService';
import { jobProgressPct, splitBackgroundJobs } from './analysisProgress';
import { projectRunPath, projectRunToJob } from './projectRunJob';

const run = (over: Partial<BackgroundProjectRun>): BackgroundProjectRun => ({
  jobId: 'j1', projectId: 'p 1', projectName: 'My Home Vipina', state: 'running',
  floorsTotal: 408, floorsQueued: 8, floorsDone: 2, floorsFailed: 0, ...over,
});

describe('projectRunToJob', () => {
  it('maps the run state onto the job statuses the indicator already understands', () => {
    expect(projectRunToJob(run({ state: 'queued' })).status).toBe('pending');
    expect(projectRunToJob(run({ state: 'running' })).status).toBe('processing');
    expect(projectRunToJob(run({ state: 'completed' })).status).toBe('completed');
    expect(projectRunToJob(run({ state: 'partial' })).status).toBe('completed');
    expect(projectRunToJob(run({ state: 'failed' })).status).toBe('failed');
  });

  it('uses real progress: floors finished out of floors queued, not a time estimate', () => {
    const job = projectRunToJob(run({ floorsDone: 2, floorsFailed: 1, floorsQueued: 8 }));
    expect(job.progressPct).toBe(37.5);
    expect(jobProgressPct(job, Date.now())).toBe(38);
  });

  it('never shows 100% before the server says the run is finished', () => {
    const almost = projectRunToJob(run({ floorsDone: 8, floorsQueued: 8, state: 'running' }));
    expect(jobProgressPct(almost, Date.now())).toBe(99);
    expect(jobProgressPct(projectRunToJob(run({ state: 'completed' })), Date.now())).toBe(100);
  });

  it('names the project and whether it is the whole project or one tower', () => {
    expect(projectRunToJob(run({})).floorLabel).toBe('My Home Vipina · whole project');
    expect(projectRunToJob(run({ towerId: 't1', towerName: 'T3' })).floorLabel).toBe('My Home Vipina · T3');
  });

  it('keeps a project run apart from a floor run with the same id, and can be dismissed', () => {
    const job = projectRunToJob(run({ state: 'completed' }));
    expect(job.jobId).toBe('project:j1');
    expect(splitBackgroundJobs([job], new Set()).finished).toHaveLength(1);
    expect(splitBackgroundJobs([job], new Set(['project:j1'])).finished).toHaveLength(0);
  });

  it('carries the failure reason', () => {
    const job = projectRunToJob(run({ state: 'failed', errors: [{ floorId: '', message: 'timed out' }] }));
    expect(job.error).toBe('timed out');
  });
});

describe('projectRunPath', () => {
  it('opens the project analysis page for that project', () => {
    expect(projectRunPath('p 1')).toBe('/construction-progress/project-analysis?project=p%201');
  });
});
