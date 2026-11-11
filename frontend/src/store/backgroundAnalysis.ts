import { create } from 'zustand';
import {
  constructionProgressService,
  type BackgroundAnalysisJob,
} from '@/services/constructionProgressService';
import { useAuthStore } from './authStore';

/**
 * Background floor analyses (running or recently finished) for the app-wide status indicator.
 *
 * The SERVER is the source of truth: the list comes from GET /construction-progress/analyze/background,
 * so it survives a reload, works across devices, and lets an admin see runs other people started.
 * Only "which finished runs did I already dismiss" is remembered locally, per user.
 */
const DISMISSED_KEY = 'sitesurelabs-bg-analysis-dismissed-v1';
const MAX_REMEMBERED = 50;

function readDismissed(userId: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') as Record<string, unknown>;
    const mine = all[userId];
    return Array.isArray(mine) ? mine.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(userId: string, ids: string[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') as Record<string, string[]>;
    all[userId] = ids.slice(-MAX_REMEMBERED);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: dismissal then only lasts until reload */
  }
}

interface BackgroundAnalysisState {
  jobs: BackgroundAnalysisJob[];
  /** Finished jobs this user already closed. Running jobs are never hidden by this list. */
  dismissed: string[];
  dismissedFor: string | null;
  /** Fetch the latest list. Resolves with the current jobs; on a network error keeps the last list. */
  refresh: () => Promise<BackgroundAnalysisJob[]>;
  dismiss: (jobId: string) => void;
  clear: () => void;
}

export const useBackgroundAnalysisStore = create<BackgroundAnalysisState>((set, get) => ({
  jobs: [],
  dismissed: [],
  dismissedFor: null,

  async refresh() {
    const userId = useAuthStore.getState().user?.id ?? '';
    if (!userId) return get().jobs;
    try {
      const jobs = await constructionProgressService.listBackgroundAnalyses();
      set(s => ({
        jobs: Array.isArray(jobs) ? jobs : [],
        // Load this user's dismissals the first time (or after a user switch).
        ...(s.dismissedFor !== userId ? { dismissed: readDismissed(userId), dismissedFor: userId } : {}),
      }));
    } catch {
      /* offline or a transient error: keep showing what we last knew */
    }
    return get().jobs;
  },

  dismiss(jobId) {
    const userId = useAuthStore.getState().user?.id ?? '';
    const next = get().dismissed.includes(jobId) ? get().dismissed : [...get().dismissed, jobId];
    set({ dismissed: next });
    if (userId) writeDismissed(userId, next);
  },

  clear: () => set({ jobs: [], dismissed: [], dismissedFor: null }),
}));
