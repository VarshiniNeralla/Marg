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
// short of that (but genuinely observed) is "in_progress".
// not_assessed = no relevant area photographed yet (inactive; not incomplete).
// no_evidence = applicable area photographed but no work evidence found.
// not_observable = cannot be scored from photos (concealed / document-only).
export type ActivityStatus =
  | 'no_evidence'
  | 'not_assessed'
  | 'not_observable'
  | 'in_progress'
  | 'completed';

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

/** Pin positions frozen at analysis time — keeps markers aligned with boxes. */
export interface HeatmapPinMarker {
  pinId: string;
  sequenceNumber: number;
  x: number;
  y: number;
  flatName: string;
  roomName: string;
  state: RoomHeatmapState;
  capturesCount: number;
}

export interface RoomActivityAssessment {
  activityId: string;
  activityName: string;
  completionPct: number;
  confidencePct: number;
  evidenceCaptureIds: string[];
  /** Short assessor rationale when present (T7). */
  evidence?: string;
  /** Optional per-room status; used to exclude not_observable from averages. */
  status?: ActivityStatus;
}

export interface RoomProgress {
  roomName: string;
  // True only when EVERY activity confirmed in this room individually
  // reached the completion threshold — a room with zero confirmed
  // activities is never "complete".
  isComplete: boolean;
  activities: RoomActivityAssessment[];
  /** Pins attributed to this room at analysis time (sequence numbers). */
  pinNumbers?: number[];
  /** Captures resolved into this room — drives coverage UI independently of AI scores. */
  capturesCount?: number;
}

export interface FlatProgress {
  flatName: string;
  // v4.4: work progress over photographed rooms; 100% only when all required
  // roster rooms are photographed and complete.
  completionPct: number;
  roomsComplete: number;
  roomsTotal: number;
  roomsRequired?: number;
  roomsPhotographed?: number;
  isFullyComplete?: boolean;
  rooms: RoomProgress[];
}

export interface SummaryCards {
  roomsCompleted: number;
  roomsInProgress: number;
  roomsNotStarted: number;
  activitiesCompleted: number;
  activitiesInProgress: number;
  activitiesNotStarted: number;
  /** Explicit not-assessed count (no relevant area captured). */
  activitiesNotAssessed?: number;
  activitiesNotObservable?: number;
  imagesAnalyzed: number;
  lastInspection: string | null;
  avgConfidencePct: number;
  /** Rooms with ≥1 usable capture ÷ roster rooms — sibling of overall progress. */
  coveragePct?: number;
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
  /** Present on snapshots created after pin/box alignment fix. */
  heatmapPins?: HeatmapPinMarker[];
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

export type RoomCorrectVerdict = 'yes' | 'no';
export type ProgressMappingVerdict = 'correct' | 'mostly_correct' | 'wrong';

export interface ActivityCorrection {
  activityId: string;
  verdict: 'correct' | 'wrong';
  /** Reviewer's estimate of the true completion %. */
  correctPercentage?: number;
  /** Why the reviewer marked this activity correct/wrong. */
  note?: string;
}

/** Per-pin room-mapping judgment when multiple pins fall in one room. */
export interface PinRoomVerdict {
  pinNumber: number;
  roomCorrect: RoomCorrectVerdict;
  actualRoom?: string;
}

export interface ProgressReviewCreate {
  snapshotId: string;
  floorId: string;
  flatName: string;
  roomName: string;
  pinNumbers?: number[];
  roomCorrect: RoomCorrectVerdict;
  actualRoom?: string;
  /** When present, room-ID accuracy is scored per pin instead of per room. */
  pinRoomVerdicts?: PinRoomVerdict[];
  progressVerdict: ProgressMappingVerdict;
  activityCorrections?: ActivityCorrection[];
  note?: string;
}

export interface ProgressReview extends ProgressReviewCreate {
  reviewId: string;
  orgId: string;
  reviewedBy: string;
  model: string;
  promptVersion: string;
  rigVersion: number | null;
  createdAt: string;
}

export interface ProgressReviewVersionSummary {
  promptVersion: string;
  rigVersion: number | null;
  reviewCount: number;
  roomIdentificationAccuracyPct: number | null;
  roomCorrectYes: number;
  roomCorrectNo: number;
  progressMapping: {
    correct: number;
    mostly_correct: number;
    wrong: number;
    accuracyPct: number | null;
  };
  activityWrongCounts: Record<string, number>;
}

export interface ProgressReviewSummary {
  floorId: string | null;
  totalReviews: number;
  byVersion: ProgressReviewVersionSummary[];
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

  getFloorDetail(floorId: string): Promise<FloorProgressSnapshot | null> {
    return unwrap(apiClient.get(`/construction-progress/floors/${floorId}`));
  },

  analyzeFloor(floorId: string): Promise<FloorProgressSnapshot> {
    // Room-map extraction + per-capture scoring routinely exceeds the shared
    // apiClient 180s timeout (observed 3–4+ minutes on multi-flat floors).
    // Timing out early dismisses the UI while the backend is still working and
    // often triggers a second overlapping analyze. Give this call its own budget.
    return unwrap(
      apiClient.post(
        `/construction-progress/floors/${floorId}/analyze`,
        undefined,
        { timeout: 900_000 },
      ),
    );
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

  createReview(payload: ProgressReviewCreate): Promise<ProgressReview> {
    return unwrap(apiClient.post('/construction-progress/reviews', payload));
  },

  listReviews(params?: { floorId?: string; snapshotId?: string }): Promise<ProgressReview[]> {
    return unwrap(apiClient.get('/construction-progress/reviews', { params }));
  },

  reviewSummary(params?: { floorId?: string }): Promise<ProgressReviewSummary> {
    return unwrap(apiClient.get('/construction-progress/reviews/summary', { params }));
  },
};

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  no_evidence: 'No Photos Yet',
  not_assessed: 'Not Assessed',
  not_observable: 'Not Observable',
  in_progress: 'Work in Progress',
  completed: 'Completed',
};
