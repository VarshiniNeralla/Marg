import apiClient from './apiClient';
import type { ApiResponse } from '@/types/dto';

export type ActivitySection = 'flat' | 'common';

export interface ActivityDefinition {
  activityId: string;
  name: string;
  section: ActivitySection;
  sequenceIndex: number;
}

// A construction manager wants "is this done or not", not five shades of
// maybe — "completed" requires near-total, visible confirmation, everything
// short of that (but genuinely observed) is "in_progress". An activity
// nobody has photographed anywhere gets its own "no_evidence" state — it is
// NOT "in_progress", since that would falsely claim observed work.
export type ActivityStatus = 'no_evidence' | 'in_progress' | 'completed';

export interface ActivityAssessment {
  activityId: string;
  name: string;
  section: ActivitySection;
  sequenceIndex: number;
  status: ActivityStatus;
  completionPct: number;
  confidencePct: number;
  evidenceCaptureIds: string[];
}

export type RoomHeatmapState = 'no_images' | 'uploaded' | 'in_progress' | 'completed';

export interface HeatmapPoint { x: number; y: number; }

export interface RoomHeatmapEntry {
  flatName: string;
  roomName: string;
  polygon: HeatmapPoint[];
  state: RoomHeatmapState;
  capturesCount: number;
}

export interface RoomActivityAssessment {
  activityId: string;
  activityName: string;
  completionPct: number;
  confidencePct: number;
  evidenceCaptureIds: string[];
}

export interface RoomProgress {
  roomName: string;
  // True only when EVERY activity confirmed in this room individually
  // reached the completion threshold — a room with zero confirmed
  // activities is never "complete".
  isComplete: boolean;
  activities: RoomActivityAssessment[];
}

export interface FlatProgress {
  flatName: string;
  // (rooms complete) / (rooms total in this flat's room-map roster) — a
  // flat only reaches 100% once every one of its rooms is independently
  // complete, not once any single room is photographed.
  completionPct: number;
  roomsComplete: number;
  roomsTotal: number;
  rooms: RoomProgress[];
}

export interface SummaryCards {
  roomsCompleted: number;
  roomsInProgress: number;
  roomsNotStarted: number;
  activitiesCompleted: number;
  activitiesInProgress: number;
  activitiesNotStarted: number;
  imagesAnalyzed: number;
  lastInspection: string | null;
  avgConfidencePct: number;
}

export interface FloorProgressSnapshot {
  snapshotId: string;
  projectId: string;
  projectName: string;
  towerId: string;
  towerName: string;
  floorId: string;
  floorName: string;
  floorPlanId: string;
  floorPlanImageUrl: string;
  snapshotDate: string;
  overallProgressPct: number;
  overallConfidencePct: number;
  overallStatus: ActivityStatus;
  imagesAnalyzedCount: number;
  activities: ActivityAssessment[];
  roomHeatmap: RoomHeatmapEntry[];
  flatProgress: FlatProgress[];
  summaryCards: SummaryCards;
  executiveSummary: string;
  model: string;
  createdAt: string;
}

export interface FloorSummary {
  floorId: string;
  projectId: string;
  projectName: string;
  towerId: string;
  towerName: string;
  floorName: string;
  overallProgressPct: number | null;
  overallStatus: ActivityStatus | null;
  lastInspection: string | null;
  analyzed: boolean;
}

export interface TimelinePoint {
  snapshotId: string;
  snapshotDate: string;
  overallProgressPct: number;
}

export interface FloorComparison {
  before: FloorProgressSnapshot;
  after: FloorProgressSnapshot;
  progressDelta: number;
  newlyCompletedActivities: string[];
}

async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const { data } = await promise;
  return data.data as T;
}

export const constructionProgressService = {
  listActivities(): Promise<ActivityDefinition[]> {
    return unwrap(apiClient.get('/construction-progress/activities'));
  },

  listFloors(): Promise<FloorSummary[]> {
    return unwrap(apiClient.get('/construction-progress/floors'));
  },

  getFloorDetail(floorId: string): Promise<FloorProgressSnapshot> {
    return unwrap(apiClient.get(`/construction-progress/floors/${floorId}`));
  },

  analyzeFloor(floorId: string): Promise<FloorProgressSnapshot> {
    return unwrap(apiClient.post(`/construction-progress/floors/${floorId}/analyze`));
  },

  getTimeline(floorId: string): Promise<TimelinePoint[]> {
    return unwrap(apiClient.get(`/construction-progress/floors/${floorId}/timeline`));
  },

  getHeatmap(floorId: string): Promise<RoomHeatmapEntry[]> {
    return unwrap(apiClient.get(`/construction-progress/floors/${floorId}/heatmap`));
  },

  compare(floorId: string, fromSnapshotId: string, toSnapshotId: string): Promise<FloorComparison> {
    return unwrap(
      apiClient.get(`/construction-progress/floors/${floorId}/compare`, {
        params: { from: fromSnapshotId, to: toSnapshotId },
      }),
    );
  },

  deleteFloorReports(floorId: string): Promise<{ deletedCount: number }> {
    return unwrap(apiClient.delete(`/construction-progress/floors/${floorId}`));
  },
};

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  no_evidence: 'No Photos Yet',
  in_progress: 'Work in Progress',
  completed: 'Completed',
};
