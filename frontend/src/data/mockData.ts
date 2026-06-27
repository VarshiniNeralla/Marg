// Centralized mock data — all screens consume from here

export type ProjectStatus = 'active' | 'review' | 'done' | 'draft';
export type CaptureStatus = 'processed' | 'review' | 'rejected' | 'uploading';
export type TourStatus = 'draft' | 'processing' | 'in_review' | 'published';
export type UserRole = 'super_admin' | 'admin' | 'manager' | 'field_engineer' | 'reviewer' | 'viewer';
export type DefectSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DefectStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type ReviewStatus = 'uploaded' | 'assigned' | 'reviewing' | 'changes_requested' | 'approved' | 'published';

// ── Projects ──────────────────────────────────────────────────────────────────
export interface MockProject {
  id: string;
  name: string;
  location: string;
  city: string;
  state: string;
  client: string;
  description: string;
  status: ProjectStatus;
  progress: number;
  towers: number;
  floors: number;
  flats?: number;
  rooms: number;
  captures: number;
  totalRooms: number;
  startDate: string;
  endDate: string;
  gradient: string;
  accent: string;
  lastUpdated: string;
  thumbnail: string | null;
  teamSize: number;
}

export const mockProjects: MockProject[] = [];

// ── Towers ────────────────────────────────────────────────────────────────────
export interface MockTower {
  id: string;
  projectId: string;
  name: string;
  floors: number;
  rooms: number;
  captures: number;
  progress: number;
  description: string;
  status: 'active' | 'complete' | 'pending';
}

export const mockTowers: MockTower[] = [];

// ── Floors ────────────────────────────────────────────────────────────────────
export interface MockFloor {
  id: string;
  towerId: string;
  number: number;
  label: string;
  rooms: number;
  mapped: number;
  status: 'complete' | 'partial' | 'pending';
  floorPlanId?: string;
}

export function getFloors(_towerId: string): MockFloor[] {
  return [];
}

// ── Rooms ─────────────────────────────────────────────────────────────────────
export interface MockRoom {
  id: string;
  floorId: string;
  towerId: string;
  projectId: string;
  name: string;
  type: 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'balcony' | 'utility';
  captureCount: number;
  status: 'captured' | 'pending' | 'review' | 'rejected';
  lastCaptured: string | null;
}

export function getRooms(_floorId: string, _towerId: string, _projectId: string): MockRoom[] {
  return [];
}

// ── Captures ──────────────────────────────────────────────────────────────────
export interface MockCapture {
  id: string;
  roomId: string;
  roomName: string;
  projectId: string;
  projectName: string;
  towerId: string;
  towerName: string;
  floorLabel: string;
  status: CaptureStatus;
  reviewStatus: ReviewStatus;
  uploadedBy: string;
  uploadedAt: string;
  capturedAt?: string;       // real ISO timestamp recorded at upload — drives the timeline
  reviewedBy: string | null;
  reviewNotes: string | null;
  assignedTo: string | null;
  fileCount: number;
  sizeMb: number;
  gradient: string;
}

export const mockCaptures: MockCapture[] = [];

// ── Tours ─────────────────────────────────────────────────────────────────────
// One stop in a sequential walkthrough tour — a single pin's panorama.
export interface TourStep {
  pinId: string;
  captureId: string;
  sequenceNumber: number;   // pin order (1-based)
  label: string;            // e.g. "Pin 1"
  panoramaUrl: string | null;
  thumbnailUrl?: string | null;
}

export interface MockTour {
  id: string;
  captureId: string;
  roomId: string;
  roomName: string;
  projectId: string;
  projectName: string;
  towerId: string;
  towerName: string;
  floorLabel: string;
  status: TourStatus;
  captures: number;
  lastCapture: string;
  gradient: string;
  viewCount: number;
  // Sequential walkthrough steps — one per pin, in pin order (1 → 2 → 3 …).
  // Each step is a panorama the viewer steps through with prev/next arrows.
  steps?: TourStep[];
}

export const mockTours: MockTour[] = [];

// ── Floor Plans ───────────────────────────────────────────────────────────────
export interface MockFloorPlan {
  id: string;
  projectId: string;
  towerId: string;
  floorId: string;
  floorLabel: string;
  uploadedBy: string;
  uploadedAt: string;
  fileType: 'pdf' | 'png' | 'jpg';
  fileName: string;
  fileSizeMb: number;
  rooms: MockRoomMarker[];
}

export interface MockRoomMarker {
  id: string;
  name: string;
  number: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: 'not_started' | 'in_progress' | 'reviewed' | 'published';
  captureId?: string;
  tourId?: string;
}

export const mockFloorPlans: MockFloorPlan[] = [];

export function getFloorPlanByFloor(towerId: string, floorId: string): MockFloorPlan | undefined {
  return mockFloorPlans.find(fp => fp.towerId === towerId && fp.floorId === floorId);
}

// ── Defects ───────────────────────────────────────────────────────────────────
export interface MockDefect {
  id: string;
  title: string;
  description: string;
  severity: DefectSeverity;
  status: DefectStatus;
  projectId: string;
  projectName: string;
  towerId?: string;
  towerName?: string;
  floorLabel?: string;
  roomName?: string;
  captureId?: string;
  assignedTo: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const mockDefects: MockDefect[] = [];

// ── Notifications ─────────────────────────────────────────────────────────────
export type NotifType = 'capture_uploaded' | 'review_requested' | 'tour_published' | 'defect_assigned' | 'floor_plan_uploaded' | 'review_approved' | 'review_rejected';

export interface MockNotification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

export const mockNotifications: MockNotification[] = [];

// ── Users ─────────────────────────────────────────────────────────────────────
export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string | null;
  designation: string;
  phone: string;
  joinedAt: string;
  lastActive: string;
  projectIds: string[];
}

export const mockUsers: MockUser[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
export function getProjectById(id: string): MockProject | undefined {
  return mockProjects.find(p => p.id === id);
}
export function getTowersByProject(projectId: string): MockTower[] {
  return mockTowers.filter(t => t.projectId === projectId);
}
export function getCapturesByProject(projectId: string): MockCapture[] {
  return mockCaptures.filter(c => c.projectId === projectId);
}
export function getToursByProject(projectId: string): MockTour[] {
  return mockTours.filter(t => t.projectId === projectId);
}
export function getCaptureById(id: string): MockCapture | undefined {
  return mockCaptures.find(c => c.id === id);
}
export function getTourById(id: string): MockTour | undefined {
  return mockTours.find(t => t.id === id);
}

export const statusConfig = {
  capture: {
    processed: { label: 'Processed', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    review:    { label: 'In Review', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    rejected:  { label: 'Rejected',  color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
    uploading: { label: 'Uploading', color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  },
  project: {
    active:  { label: 'Active',     color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    review:  { label: 'In Review',  color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    done:    { label: 'Completed',  color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
    draft:   { label: 'Draft',      color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
  },
  tour: {
    published:  { label: 'Published',  color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    in_review:  { label: 'In Review',  color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    processing: { label: 'Processing', color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
    draft:      { label: 'Draft',      color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
  },
  defect: {
    open:        { label: 'Open',        color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
    in_progress: { label: 'In Progress', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    resolved:    { label: 'Resolved',    color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    closed:      { label: 'Closed',      color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
  },
  severity: {
    low:      { label: 'Low',      color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
    medium:   { label: 'Medium',   color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    high:     { label: 'High',     color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
    critical: { label: 'Critical', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  },
  reviewStatus: {
    uploaded:           { label: 'Uploaded',          color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
    assigned:           { label: 'Assigned',          color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
    reviewing:          { label: 'Reviewing',         color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    changes_requested:  { label: 'Changes Requested', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
    approved:           { label: 'Approved',          color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    published:          { label: 'Published',         color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  },
};

// ── Capture Series (timeline / history / before-after) ─────────────────────────
// The backend models one capture per upload; over a construction project a single
// room is captured repeatedly as work progresses. We synthesise that dated series
// here (deterministic, seeded by roomId) so the timeline, before/after comparison
// and room-history panels all read from one consistent source.

export interface CaptureSnapshot {
  id: string;            // synthetic id, e.g. "c1__2"
  baseCaptureId: string; // the room's canonical capture id (links to mockCaptures)
  roomId: string;
  date: string;          // ISO date, e.g. "2025-05-01"
  dateLabel: string;     // "May 01"
  monthLabel: string;    // "May"
  reviewStatus: ReviewStatus;
  progress: number;      // construction completeness 0–100 at this snapshot
  fileCount: number;
  capturedBy: string;
  note: string | null;
  gradient: string;      // distinct per snapshot so before/after is visually different
  isLatest: boolean;
}

// A small palette of evolving "construction stage" gradients — earliest (bare) to
// latest (finished). Index by stage so later snapshots look more complete.
const STAGE_GRADIENTS = [
  'linear-gradient(135deg, #475569 0%, #1e293b 100%)', // structure / grey
  'linear-gradient(135deg, #57534e 0%, #292524 100%)', // plaster
  'linear-gradient(135deg, #525b6b 0%, #2a3344 100%)', // services
  'linear-gradient(135deg, #3f5e7a 0%, #1e3a52 100%)', // finishing
  'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)', // handover-ready
  'linear-gradient(135deg, #1a3a2a 0%, #0f2318 100%)', // snag-free
];

const SERIES_STATUS_FLOW: ReviewStatus[] = ['uploaded', 'assigned', 'reviewing', 'approved', 'published'];

function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

const SERIES_CAPTURERS = ['Ravi Kumar', 'Anil Prakash', 'Kiran Desai', 'Meena Reddy', 'Sunita Rao'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SNAPSHOT_NOTES = [
  'Structural shell complete — bare concrete capture.',
  'Plastering and internal walls finished.',
  'Electrical and plumbing rough-in documented.',
  'Flooring and finishes in progress.',
  'Final handover-ready capture — all snags cleared.',
];

/**
 * Build the dated capture series for a room. Deterministic per roomId.
 * Captures land on the 1st and 15th of consecutive months starting in May 2025.
 */
export function getCaptureSeries(roomId: string, baseCaptureId: string, baseGradient: string): CaptureSnapshot[] {
  const seed = hashSeed(roomId);
  const count = 4 + (seed % 3); // 4–6 snapshots
  const startMonth = 4; // May (0-indexed)

  return Array.from({ length: count }, (_, i) => {
    const monthOffset = Math.floor(i / 2);
    const day = i % 2 === 0 ? 1 : 15;
    const monthIdx = (startMonth + monthOffset) % 12;
    const mm = String(monthIdx + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const isLatest = i === count - 1;
    // Status climbs toward published as snapshots get newer.
    const statusIdx = Math.min(SERIES_STATUS_FLOW.length - 1, Math.floor((i / (count - 1)) * SERIES_STATUS_FLOW.length));
    const progress = Math.round(((i + 1) / count) * 100);
    const stageIdx = Math.min(STAGE_GRADIENTS.length - 1, Math.floor((i / (count - 1)) * (STAGE_GRADIENTS.length - 1)));

    return {
      id: `${baseCaptureId}__${i + 1}`,
      baseCaptureId,
      roomId,
      date: `2025-${mm}-${dd}`,
      dateLabel: `${MONTHS[monthIdx]} ${dd}`,
      monthLabel: MONTHS[monthIdx],
      reviewStatus: SERIES_STATUS_FLOW[statusIdx],
      progress,
      fileCount: 6 + ((seed >> i) % 8),
      capturedBy: SERIES_CAPTURERS[(seed + i) % SERIES_CAPTURERS.length],
      note: SNAPSHOT_NOTES[Math.min(SNAPSHOT_NOTES.length - 1, i)] ?? null,
      // Latest snapshot uses the room's real gradient; earlier ones use stage gradients.
      gradient: isLatest ? baseGradient : STAGE_GRADIENTS[stageIdx],
      isLatest,
    };
  });
}

/** Convenience: the series for a given canonical capture. */
export function getCaptureSeriesForCapture(captureId: string): CaptureSnapshot[] {
  const cap = getCaptureById(captureId);
  if (!cap) return [];
  return getCaptureSeries(cap.roomId, cap.id, cap.gradient);
}

export interface RoomHistory {
  roomId: string;
  captureCount: number;
  latest: CaptureSnapshot;
  first: CaptureSnapshot;
  series: CaptureSnapshot[];
  progressDelta: number;                       // latest.progress - first.progress
  reviewHistory: { status: ReviewStatus; dateLabel: string }[];
}

/** Aggregate room-history summary used by the Room History panel (7E). */
export function getRoomHistory(captureId: string): RoomHistory | null {
  const series = getCaptureSeriesForCapture(captureId);
  if (!series.length) return null;
  const latest = series[series.length - 1];
  const first = series[0];
  return {
    roomId: latest.roomId,
    captureCount: series.length,
    latest,
    first,
    series,
    progressDelta: latest.progress - first.progress,
    reviewHistory: series.map(s => ({ status: s.reviewStatus, dateLabel: s.dateLabel })),
  };
}

// ── Permissions ───────────────────────────────────────────────────────────────
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'publish';

export interface PermissionMatrix {
  role: UserRole;
  modules: Record<string, PermissionAction[]>;
}

export const permissionMatrix: PermissionMatrix[] = [
  {
    role: 'admin',
    modules: {
      projects:  ['view','create','edit','delete'],
      captures:  ['view','create','edit','delete','approve'],
      tours:     ['view','create','edit','delete','publish'],
      analytics: ['view'],
      users:     ['view','create','edit','delete'],
      settings:  ['view','edit'],
    },
  },
  {
    role: 'manager',
    modules: {
      projects:  ['view','create','edit'],
      captures:  ['view','create','edit'],
      tours:     ['view','create'],
      analytics: ['view'],
      users:     ['view'],
      settings:  ['view'],
    },
  },
  {
    role: 'field_engineer',
    modules: {
      projects:  ['view'],
      captures:  ['view','create','edit'],
      tours:     ['view'],
      analytics: [],
      users:     [],
      settings:  [],
    },
  },
  {
    role: 'reviewer',
    modules: {
      projects:  ['view'],
      captures:  ['view','approve'],
      tours:     ['view'],
      analytics: ['view'],
      users:     [],
      settings:  [],
    },
  },
  {
    role: 'viewer',
    modules: {
      projects:  ['view'],
      captures:  ['view'],
      tours:     ['view'],
      analytics: ['view'],
      users:     [],
      settings:  [],
    },
  },
];

// ── Audit Logs ────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'capture_uploaded'
  | 'capture_approved'
  | 'capture_rejected'
  | 'tour_published'
  | 'tour_deleted'
  | 'tour_draft'
  | 'defect_created'
  | 'defect_resolved'
  | 'floor_plan_uploaded'
  | 'user_invited'
  | 'user_role_changed'
  | 'review_assigned'
  | 'project_created'
  | 'project_updated';

export interface MockAuditLog {
  id: string;
  actorId: string;
  actorName: string;
  eventType: AuditEventType;
  entityType: 'capture' | 'tour' | 'defect' | 'floor_plan' | 'user' | 'project';
  entityId: string;
  entityName: string;
  projectId: string | null;
  description: string;
  createdAt: string;
}

export const mockAuditLogs: MockAuditLog[] = [];
