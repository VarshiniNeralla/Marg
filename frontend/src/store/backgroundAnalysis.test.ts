import { describe, expect, it, beforeEach, vi } from 'vitest';

// Node's experimental global localStorage has no setItem. Install a real one before the store module loads.
const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const impl = {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
  };
  vi.stubGlobal('localStorage', impl);
  return impl;
});

const auth = vi.hoisted(() => ({ userId: 'u1' as string | null }));
vi.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ user: auth.userId ? { id: auth.userId } : null }) },
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/services/constructionProgressService', () => ({
  constructionProgressService: { listBackgroundAnalyses: api.list },
}));

import { useBackgroundAnalysisStore } from './backgroundAnalysis';

const J = (jobId: string, status = 'processing') => ({ jobId, floorId: 'f', status });

describe('background analysis store', () => {
  beforeEach(() => {
    storage.clear();
    auth.userId = 'u1';
    api.list.mockReset();
    useBackgroundAnalysisStore.getState().clear();
  });

  it('refresh stores what the server lists', async () => {
    api.list.mockResolvedValue([J('a'), J('b', 'completed')]);
    const jobs = await useBackgroundAnalysisStore.getState().refresh();
    expect(jobs.map(j => j.jobId)).toEqual(['a', 'b']);
    expect(useBackgroundAnalysisStore.getState().jobs).toHaveLength(2);
  });

  it('keeps the last known list when the request fails', async () => {
    api.list.mockResolvedValueOnce([J('a')]);
    await useBackgroundAnalysisStore.getState().refresh();
    api.list.mockRejectedValueOnce(new Error('offline'));
    const jobs = await useBackgroundAnalysisStore.getState().refresh();
    expect(jobs.map(j => j.jobId)).toEqual(['a']);
  });

  it('does not call the server when nobody is signed in', async () => {
    auth.userId = null;
    await useBackgroundAnalysisStore.getState().refresh();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('remembers dismissals per user, across a reload', async () => {
    api.list.mockResolvedValue([J('a', 'completed')]);
    await useBackgroundAnalysisStore.getState().refresh();
    useBackgroundAnalysisStore.getState().dismiss('a');
    expect(useBackgroundAnalysisStore.getState().dismissed).toEqual(['a']);

    // "Reload": in-memory state is gone, storage remains.
    useBackgroundAnalysisStore.setState({ jobs: [], dismissed: [], dismissedFor: null });
    await useBackgroundAnalysisStore.getState().refresh();
    expect(useBackgroundAnalysisStore.getState().dismissed).toEqual(['a']);

    // A different user on the same browser does not inherit them.
    auth.userId = 'u2';
    useBackgroundAnalysisStore.setState({ dismissed: [], dismissedFor: null });
    await useBackgroundAnalysisStore.getState().refresh();
    expect(useBackgroundAnalysisStore.getState().dismissed).toEqual([]);
  });

  it('dismissing twice is harmless and the remembered list is capped', () => {
    const { dismiss } = useBackgroundAnalysisStore.getState();
    dismiss('x');
    dismiss('x');
    expect(useBackgroundAnalysisStore.getState().dismissed).toEqual(['x']);
    for (let i = 0; i < 80; i++) dismiss(`id-${i}`);
    const saved = JSON.parse(storage.getItem('sitesurelabs-bg-analysis-dismissed-v1') ?? '{}');
    expect(saved.u1.length).toBeLessThanOrEqual(50);
  });
});
