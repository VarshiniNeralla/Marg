import type {
  MockProject, MockTower, MockCapture, MockTour, MockFloorPlan,
  MockDefect, MockNotification, MockAuditLog, MockUser,
  ReviewStatus, CaptureSnapshot, RoomHistory,
} from '@/data/mockData';
import { statusConfig } from '@/data/mockData';
import type { ProjectArchived, WfCapturePin, WfFlat, WfFloor, WfRoom } from './workflowStore';

export { statusConfig };

export interface WorkflowData {
  projects: ProjectArchived[];
  towers: MockTower[];
  floors: WfFloor[];
  flats: WfFlat[];
  rooms: WfRoom[];
  captures: MockCapture[];
  tours: MockTour[];
  floorPlans: MockFloorPlan[];
  capturePins?: WfCapturePin[];
  defects: MockDefect[];
  notifications: MockNotification[];
  auditLogs: MockAuditLog[];
  users: MockUser[];
}

// ── Entity lookups ────────────────────────────────────────────────────────────

export function getProjectById(projects: MockProject[], id: string) {
  return projects.find(p => p.id === id);
}

export function getTowersByProject(towers: MockTower[], projectId: string) {
  return towers.filter(t => t.projectId === projectId);
}

export function getFloorsByTower(floors: WfFloor[], towerId: string) {
  return [...floors.filter(f => f.towerId === towerId)].sort((a, b) => b.number - a.number);
}

export function getRoomsByFloor(rooms: WfRoom[], floorId: string) {
  return rooms.filter(r => r.floorId === floorId);
}

export function getFlatsByFloor(flats: WfFlat[], floorId: string) {
  return flats.filter(f => f.floorId === floorId);
}

export function getRoomsByFlat(rooms: WfRoom[], flatId: string) {
  return rooms.filter(r => r.flatId === flatId);
}

export function getCaptureById(captures: MockCapture[], id: string) {
  return captures.find(c => c.id === id);
}

export function getTourById(tours: MockTour[], id: string) {
  return tours.find(t => t.id === id);
}

export function getFloorPlanByFloor(floorPlans: MockFloorPlan[], towerId: string, floorId: string) {
  return floorPlans.find(fp => fp.towerId === towerId && fp.floorId === floorId);
}

export function getCapturePinsByFloorPlan(pins: WfCapturePin[], floorPlanId: string) {
  return [...pins.filter(p => p.floorPlanId === floorPlanId)].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
}

export function getPinForCapture(pins: WfCapturePin[], captureId: string) {
  return pins.find(p => p.captureIds.includes(captureId));
}

/**
 * Real capture timeline for the pin that owns `captureId`. Returns every capture
 * attached to that pin, sorted oldest → newest by real recorded timestamp. If the
 * capture isn't on a pin (legacy / non-pin capture), returns just that capture.
 */
export function getPinCaptureTimeline(
  pins: WfCapturePin[],
  captures: MockCapture[],
  captureId: string,
): MockCapture[] {
  const pin = getPinForCapture(pins, captureId);
  const ids = pin ? pin.captureIds : [captureId];
  const list = ids
    .map(id => captures.find(c => c.id === id))
    .filter((c): c is MockCapture => !!c);
  return list.sort((a, b) => {
    const ta = (a as MockCapture & { capturedAt?: string }).capturedAt ?? '';
    const tb = (b as MockCapture & { capturedAt?: string }).capturedAt ?? '';
    return ta.localeCompare(tb);
  });
}

export function getCapturesByProject(captures: MockCapture[], projectId: string) {
  return captures.filter(c => c.projectId === projectId);
}

export function getToursByProject(tours: MockTour[], projectId: string) {
  return tours.filter(t => t.projectId === projectId);
}

export function getTourForCapture(tours: MockTour[], captureId: string) {
  return tours.find(t => t.captureId === captureId);
}

// ── Capture series (room history) ───────────────────────────────────────────

const STAGE_GRADIENTS = [
  'linear-gradient(135deg, #475569 0%, #1e293b 100%)',
  'linear-gradient(135deg, #57534e 0%, #292524 100%)',
  'linear-gradient(135deg, #525b6b 0%, #2a3344 100%)',
  'linear-gradient(135deg, #3f5e7a 0%, #1e3a52 100%)',
  'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)',
  'linear-gradient(135deg, #1a3a2a 0%, #0f2318 100%)',
];

const SERIES_STATUS_FLOW: ReviewStatus[] = ['uploaded', 'assigned', 'reviewing', 'approved', 'published'];
const SERIES_CAPTURERS = ['Ravi Kumar', 'Anil Prakash', 'Kiran Desai', 'Meena Reddy', 'Sunita Rao'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function getCaptureSeries(roomId: string, baseCaptureId: string, baseGradient: string): CaptureSnapshot[] {
  const seed = hashSeed(roomId);
  const count = 4 + (seed % 3);
  const startMonth = 4;

  return Array.from({ length: count }, (_, i) => {
    const monthOffset = Math.floor(i / 2);
    const day = i % 2 === 0 ? 1 : 15;
    const monthIdx = (startMonth + monthOffset) % 12;
    const mm = String(monthIdx + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const isLatest = i === count - 1;
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
      note: null,
      gradient: isLatest ? baseGradient : STAGE_GRADIENTS[stageIdx],
      isLatest,
    };
  });
}

export function getCaptureSeriesForCapture(capture: MockCapture | undefined): CaptureSnapshot[] {
  if (!capture) return [];
  return getCaptureSeries(capture.roomId, capture.id, capture.gradient);
}

export function getRoomHistory(capture: MockCapture | undefined): RoomHistory | null {
  const series = getCaptureSeriesForCapture(capture);
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

// ── Aggregated stats ──────────────────────────────────────────────────────────

export function computeDashboardStats(data: WorkflowData) {
  const activeProjects = data.projects.filter(p => !p.archived && p.status === 'active');
  const pendingReviews = data.captures.filter(c => c.status === 'review').length;
  const mappedRooms = data.rooms.filter(r =>
    data.captures.some(c => c.roomId === r.id && c.status === 'processed')
  ).length;

  return {
    projectCount: data.projects.filter(p => !p.archived).length,
    activeProjectCount: activeProjects.length,
    towerCount: data.towers.length,
    flatCount: data.flats.length,
    roomCount: data.rooms.length,
    mappedRoomCount: mappedRooms,
    captureCount: data.captures.length,
    tourCount: data.tours.length,
    publishedTourCount: data.tours.filter(t => t.status === 'published').length,
    toursPendingPublish: data.tours.filter(t => t.status !== 'published').length,
    pendingReviews,
    defectOpenCount: data.defects.filter(d => d.status === 'open' || d.status === 'in_progress').length,
  };
}

export function enrichFloorStats(
  floor: WfFloor,
  data: Pick<WorkflowData, 'flats' | 'rooms' | 'captures' | 'tours' | 'floorPlans'>,
) {
  const plan = getFloorPlanByFloor(data.floorPlans, floor.towerId, floor.id);
  const flats = getFlatsByFloor(data.flats, floor.id);
  const floorRooms = getRoomsByFloor(data.rooms, floor.id);
  const roomCount = plan?.rooms.length ?? floorRooms.length;
  const capturesOnFloor = data.captures.filter(c =>
    floorRooms.some(r => r.id === c.roomId)
  );
  const toursOnFloor = data.tours.filter(t =>
    floorRooms.some(r => r.id === t.roomId)
  );
  const mapped = plan
    ? plan.rooms.filter(r => r.status !== 'not_started').length
    : capturesOnFloor.filter(c => c.status === 'processed').length;

  return { plan, flatCount: flats.length, roomCount, mapped, tourCount: toursOnFloor.length, capturesOnFloor };
}
