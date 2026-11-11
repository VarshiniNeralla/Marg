import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { BackgroundAnalysisJob } from '@/services/constructionProgressService';

// The full icon barrel takes minutes to load under Vitest, and icons are irrelevant to what is asserted here.
vi.mock('@mui/icons-material', () => {
  const Icon = () => null;
  return { CheckCircleRounded: Icon, CloseRounded: Icon, ErrorOutlineRounded: Icon, OpenInNewRounded: Icon };
});

// Node's experimental global localStorage has no setItem, and the persisted auth store grabs it when its
// module loads, so a working one must exist before the imports run.
vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  });
});

// Server rendering always shows a zustand store's INITIAL state, not what a test sets, and there is no DOM
// environment here. So give the component plain, controllable store hooks; the real role check is kept.
const state = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
  jobs: [] as unknown[],
  dismissed: [] as string[],
  dismiss: (() => {}) as (id: string) => void,
}));

vi.mock('@store/authStore', async importOriginal => {
  const real = await importOriginal<typeof import('@store/authStore')>();
  return { ...real, useAuthStore: (select: (s: typeof state) => unknown) => select(state) };
});
vi.mock('@store/backgroundAnalysis', () => ({
  useBackgroundAnalysisStore: (select: (s: typeof state) => unknown) => select(state),
}));

import BackgroundAnalysisIndicator from './BackgroundAnalysisIndicator';

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function job(over: Partial<BackgroundAnalysisJob>): BackgroundAnalysisJob {
  return {
    jobId: 'j1', floorId: 'f1', status: 'processing', floorLabel: 'Tower Heights · Tower A · Floor 7',
    startedAt: iso(75_000), createdAt: iso(76_000), runInBackground: true, startedByName: 'Asha',
    ...over,
  };
}

function render(): string {
  return renderToString(<MemoryRouter><BackgroundAnalysisIndicator /></MemoryRouter>);
}

describe('BackgroundAnalysisIndicator', () => {
  beforeEach(() => {
    state.user = { id: 'u1', role: 'admin' };
    state.jobs = [];
    state.dismissed = [];
  });

  it('renders nothing when no background analysis exists', () => {
    expect(render()).toBe('');
  });

  it('shows what is running, an estimated progress, and View status while a run is active', () => {
    state.jobs = [job({})];
    const html = render();
    expect(html).toContain('Analyzing Tower Heights · Tower A · Floor 7');
    expect(html).toMatch(/est\. \d+%/);
    expect(html).toContain('View status');
    expect(html).toContain('role="progressbar"');          // the thin bar across the top
    expect(html).not.toContain('>Open<');                  // nothing to open yet
  });

  it('shows the estimate honestly: at 75s it is well below 100% and above the 8% floor', () => {
    state.jobs = [job({})];
    const pct = Number(/est\. (\d+)%/.exec(render())?.[1]);
    expect(pct).toBeGreaterThan(8);
    expect(pct).toBeLessThan(92);
  });

  it('summarises several running analyses', () => {
    state.jobs = [job({}), job({ jobId: 'j2', floorId: 'f2' })];
    expect(render()).toContain('2 analyses running');
  });

  it('offers Open once a run has finished, and drops the top bar', () => {
    state.jobs = [job({ status: 'completed', completedAt: iso(30_000) })];
    const html = render();
    expect(html).toContain('Ready for review');
    expect(html).toContain('>Open<');
    expect(html).not.toContain('role="progressbar"');
  });

  it('offers Open floor for a failed run', () => {
    state.jobs = [job({ status: 'failed', completedAt: iso(30_000), error: 'model unavailable' })];
    const html = render();
    expect(html).toContain('Analysis failed');
    expect(html).toContain('Open floor');
  });

  it('keeps showing a running analysis while a finished one is also waiting', () => {
    state.jobs = [job({ jobId: 'run' }), job({ jobId: 'done', status: 'completed', completedAt: iso(1000) })];
    const html = render();
    expect(html).toContain('Analyzing');
    expect(html).not.toContain('Ready for review');
  });

  it('hides a finished run that was dismissed, but never hides a running one', () => {
    state.jobs = [job({ status: 'completed', completedAt: iso(1000) })];
    state.dismissed = ['j1'];
    expect(render()).toBe('');
    state.jobs = [job({ status: 'processing' })];
    expect(render()).toContain('Analyzing');
  });

  it('is invisible to roles that cannot run analyses', () => {
    state.user = { id: 'u2', role: 'field_engineer' };
    state.jobs = [job({})];
    expect(render()).toBe('');
  });

  it('is visible to managers', () => {
    state.user = { id: 'u3', role: 'manager' };
    state.jobs = [job({})];
    expect(render()).toContain('Analyzing');
  });
});
