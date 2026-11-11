import { describe, expect, it } from 'vitest';
import {
  analysisStageLabel, formatElapsed, jobElapsedSec, jobProgressPct, softProgressPct, splitBackgroundJobs,
} from './analysisProgress';
import { parseServerTime } from './notificationTime';

const NOW = Date.parse('2026-11-11T12:00:00Z');

describe('softProgressPct', () => {
  it('starts low, only moves forward, and never reaches 100 on its own', () => {
    expect(softProgressPct(0)).toBe(8);
    let prev = 0;
    for (const s of [0, 10, 30, 60, 120, 300, 900, 36_000]) {
      const p = softProgressPct(s);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThanOrEqual(92);
      prev = p;
    }
    expect(softProgressPct(-50)).toBe(8); // clock skew never goes backwards
  });
});

describe('labels', () => {
  it('formats elapsed time', () => {
    expect(formatElapsed(7)).toBe('7s');
    expect(formatElapsed(65)).toBe('1:05');
  });
  it('moves through the stage hints as time passes', () => {
    expect(analysisStageLabel(5)).toMatch(/floor plan/);
    expect(analysisStageLabel(60)).toMatch(/Scoring/);
    expect(analysisStageLabel(120)).toMatch(/heatmap/);
    expect(analysisStageLabel(400)).toMatch(/almost done/);
  });
});

describe('jobElapsedSec / jobProgressPct', () => {
  it('measures from startedAt, falling back to createdAt, treating bare timestamps as UTC', () => {
    expect(jobElapsedSec({ startedAt: '2026-11-11T11:58:00Z', createdAt: '2026-11-11T11:00:00Z' }, NOW)).toBe(120);
    expect(jobElapsedSec({ startedAt: null, createdAt: '2026-11-11T11:59:00' }, NOW)).toBe(60);
    expect(jobElapsedSec({ startedAt: null, createdAt: null }, NOW)).toBe(0);
    expect(jobElapsedSec({ startedAt: '2026-11-11T12:05:00Z' }, NOW)).toBe(0); // in the future: clamp
  });
  it('is 100 only for completed jobs', () => {
    const base = { startedAt: '2026-11-11T10:00:00Z' };
    expect(jobProgressPct({ ...base, status: 'processing' }, NOW)).toBe(92);
    expect(jobProgressPct({ ...base, status: 'failed' }, NOW)).toBe(92);
    expect(jobProgressPct({ ...base, status: 'completed' }, NOW)).toBe(100);
  });
});

describe('splitBackgroundJobs', () => {
  const jobs = [
    { jobId: 'a', status: 'processing' as const },
    { jobId: 'b', status: 'pending' as const },
    { jobId: 'c', status: 'completed' as const },
    { jobId: 'd', status: 'failed' as const },
    { jobId: 'e', status: 'completed' as const },
  ];
  it('separates running from finished and hides dismissed finished jobs', () => {
    const { active, finished } = splitBackgroundJobs(jobs, new Set(['e']));
    expect(active.map(j => j.jobId)).toEqual(['a', 'b']);
    expect(finished.map(j => j.jobId)).toEqual(['c', 'd']);
  });
  it('never hides a running job, even if its id was dismissed earlier', () => {
    expect(splitBackgroundJobs(jobs, new Set(['a', 'b'])).active).toHaveLength(2);
  });
});

describe('parseServerTime', () => {
  it('returns null for junk and parses zone-less timestamps as UTC', () => {
    expect(parseServerTime(null)).toBeNull();
    expect(parseServerTime('Just now')).toBeNull();
    expect(parseServerTime('2026-11-11T12:00:00')).toBe(NOW);
    expect(parseServerTime('2026-11-11T12:00:00.123456')).toBe(NOW + 123);
  });
});
