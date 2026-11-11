import { create } from 'zustand';

/**
 * Analyses the user started with "Run in background" during this browser session.
 *
 * In-memory on purpose: it only exists to make the "ready for review" alert instant for
 * a user who is still in the app. The server writes the real notification whether or
 * not the browser is open, and the watcher picks that up on its next poll, so losing
 * this list on reload costs nothing.
 */
export interface TrackedAnalysis {
  jobId: string;
  floorId: string;
  startedAt: number;
}

interface BackgroundAnalysisState {
  jobs: Record<string, TrackedAnalysis>;
  track: (job: TrackedAnalysis) => void;
  untrack: (jobId: string) => void;
  /** True while a background analysis for this floor is being tracked. */
  isRunningForFloor: (floorId: string) => boolean;
  clear: () => void;
}

export const useBackgroundAnalysisStore = create<BackgroundAnalysisState>((set, get) => ({
  jobs: {},
  track: job => set(s => ({ jobs: { ...s.jobs, [job.jobId]: job } })),
  untrack: jobId => set(s => {
    if (!(jobId in s.jobs)) return s;
    const next = { ...s.jobs };
    delete next[jobId];
    return { jobs: next };
  }),
  isRunningForFloor: floorId => Object.values(get().jobs).some(j => j.floorId === floorId),
  clear: () => set({ jobs: {} }),
}));
