import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  mockProjects, mockTowers, mockCaptures, mockTours, getFloors, getRooms,
  mockFloorPlans, mockDefects, mockNotifications, mockAuditLogs, mockUsers,
  type MockProject, type MockTower, type MockCapture, type MockTour, type TourStep,
  type MockFloorPlan, type MockDefect, type MockNotification, type MockAuditLog,
  type MockUser, type NotifType, type AuditEventType,
} from '@/data/mockData';
import type { UploadedFileResponse } from '@/services/uploadService';
import { STORE_VERSION, WORKFLOW_STORE_KEY } from './persistence';
import { createSafeStorage } from './safeStorage';
import { addTombstones, tombstoneMap, tombstoneSet, clearTombstones } from './tombstones';
import { useAuthStore } from './authStore';
import { pendingUploadPins, removePendingUploadPin } from './pendingUploadRegistry';
import { enqueueWrite, isCreatePending, cancelWritesForEntityIds, cancelPendingDeletesForEntityIds, SYNC_ERROR_EVENT as WRITE_QUEUE_SYNC_ERROR_EVENT, type WriteOpName } from './writeQueue';
import { isLiveUploadedTour } from './tourFilters';
import { formatPinLocationLabel } from '@/utils/pinLabels';

/** Real signed-in name for capture / floor-plan attribution (never the placeholder "You"). */
function currentUploaderName(): string {
  const actor = useAuthStore.getState().user;
  const name = actor?.name?.trim() || actor?.email?.trim();
  return name || 'Unknown user';
}

// ─────────────────────────────────────────────────────────────────────────────
// Construction Workflow Store
//
// The app historically read static module arrays from mockData.ts, so writes
// never re-rendered other screens. This reactive Zustand store is the single
// source of truth for construction data (projects → towers → floors → rooms →
// captures → tours). Pages subscribe to it; the Workflow page mutates it; every
// subscriber updates live.
//
// It is SEEDED from mockData once at module load (floors/rooms were generated
// functions there, so we materialise them into real arrays we can edit).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True only if the server record carrying a tombstoned id really is the record
 * this client deleted — i.e. it was created BEFORE we tombstoned that id.
 *
 * Re-issuing a delete purely because an id matches a tombstone is unsafe. Ids
 * are minted from one monotonic counter persisted under the store's own
 * localStorage key, while tombstones live under a separate key, so the two can
 * drift apart (a quota-capped/failed persist, or store state reverting to an
 * older snapshot while tombstones survive). The counter then re-mints an id that
 * is still tombstoned, and an id-only match deletes a brand-new record that
 * merely reuses the name — which is exactly how two freshly-uploaded captures
 * were destroyed minutes after upload, leaving their pins dangling.
 *
 * Fails CLOSED: if the record carries no parseable creation time we skip the
 * delete. A skipped delete leaves a stale row (cosmetic, and the user can
 * delete it again); a wrong delete destroys a real photo.
 */
function recordCreatedAtMs(record: unknown): number | null {
  const r = record as Record<string, unknown> | undefined;
  const raw =
    (r?.createdAt as string | undefined) ??
    (r?.created_at as string | undefined) ??
    (r?.capturedAt as string | undefined) ??
    (r?.captured_at as string | undefined);
  const ms = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function isSameRecordAsTombstoned(
  id: string,
  record: unknown,
  deletedAtById: Record<string, number>,
): boolean {
  const deletedAt = deletedAtById[id];
  if (!deletedAt) return false;
  const createdAt = recordCreatedAtMs(record);
  if (createdAt === null) return false;
  return createdAt < deletedAt;
}

/**
 * True when the server's record provably POST-DATES the tombstone for its id —
 * meaning the id was re-minted for something new and the tombstone is simply
 * wrong.
 *
 * Also fails closed (an unparseable creation time keeps the tombstone), because
 * clearing one wrongly resurrects a genuinely deleted record.
 */
function tombstoneIsSuperseded(
  id: string,
  record: unknown,
  deletedAtById: Record<string, number>,
): boolean {
  const deletedAt = deletedAtById[id];
  if (!deletedAt) return false;
  const createdAt = recordCreatedAtMs(record);
  if (createdAt === null) return false;
  return createdAt > deletedAt;
}

/**
 * Whether a record the SERVER still returns should be hidden because this device
 * deleted it. Requires positive proof — the record must predate the tombstone.
 *
 * Hiding on an id match alone silently suppresses server data whenever a
 * timestamp is unreadable. Legacy records carry `createdAt: 'Just now'` (a
 * literal string, not a date), so `Date.parse` yields NaN and nothing can be
 * proven about them: a months-old tombstone then erased a live pin, which in turn
 * made its freshly-uploaded capture look unlinked and get dropped as well — one
 * photo short, with the photo itself perfectly intact on the server.
 *
 * Deliberately the opposite default from the delete path: DELETING without proof
 * destroys data, so it fails closed; HIDING without proof destroys the user's
 * trust in what they can see, so it fails open. A record we really did just
 * delete has real timestamps on both sides, so it is still provably hidden while
 * its delete converges.
 */
function hiddenByTombstone(
  id: string,
  record: unknown,
  deletedAtById: Record<string, number>,
): boolean {
  return id in deletedAtById && isSameRecordAsTombstoned(id, record, deletedAtById);
}

const PRIMARY_PROJECT_NAME = 'My Home Udyan';

export interface WfFloor {
  id: string;
  towerId: string;
  number: number;
  label: string;
  floorPlanId?: string;
}

export type FlatType = '1 BHK' | '2 BHK' | '3 BHK' | '4 BHK';

export interface WfFlat {
  id: string;
  floorId: string;
  towerId: string;
  projectId: string;
  number: string;
  type: FlatType;
}

export interface WfRoom {
  id: string;
  flatId: string;
  floorId: string;
  towerId: string;
  projectId: string;
  name: string;
  type: 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'balcony' | 'utility' | 'dining' | 'office' | 'lounge' | 'theatre' | 'prayer' | 'wardrobe' | 'terrace' | 'servant' | 'custom';
  floorPlanId?: string;
}

export type ProjectArchived = MockProject & { archived?: boolean };

// ── Capture Pin ───────────────────────────────────────────────────────────────
// A numbered marker placed directly on a floor plan. The sequenceNumber defines
// the walkthrough order of the published virtual tour and is permanent across
// site visits. Each pin references existing Capture records by id (captureIds)
// rather than duplicating any upload information. A pin owns one backing WfRoom
// (roomId) so the existing capture → review → tour pipeline works unchanged.
export interface WfCapturePin {
  id: string;
  floorPlanId: string;
  floorId: string;
  towerId: string;
  projectId: string;
  roomId: string;            // backing room — implementation detail, never shown
  sequenceNumber: number;    // walkthrough order, 1-based
  x: number;                 // % of floor-plan page width (0–100), zoom-invariant
  y: number;                 // % of floor-plan page height (0–100), zoom-invariant
  createdBy: string;
  createdAt: string;
  captureIds: string[];      // capture timeline, newest last
  /** Semantic location for progress (predefined / copied / nearest freeplace). */
  flatName?: string;
  roomName?: string;
  label?: string;
  source?: 'predefined' | 'copied' | 'freeplace';
  isPredefined?: boolean;
  inheritedFromPinId?: string;
}

export type WorkflowDataState = Pick<WorkflowState,
  'projects' | 'towers' | 'floors' | 'flats' | 'rooms' | 'captures' | 'tours' |
  'floorPlans' | 'capturePins' | 'defects' | 'notifications' | 'auditLogs' | 'users' | 'uidCounter'
>;

// ── Seed from mockData ──────────────────────────────────────────────────────────
function primaryProjectIds(projects: Pick<MockProject, 'id' | 'name'>[] = mockProjects) {
  return new Set(projects.filter(p => p.name === PRIMARY_PROJECT_NAME).map(p => p.id));
}

function seedFloors(): WfFloor[] {
  const out: WfFloor[] = [];
  const allowedProjects = primaryProjectIds();
  for (const t of mockTowers) {
    if (!allowedProjects.has(t.projectId)) continue;
    // Materialise the top 8 generated floors per tower (those with plans/rooms).
    for (const f of getFloors(t.id).slice(0, 8)) {
      out.push({ id: f.id, towerId: t.id, number: f.number, label: f.label, floorPlanId: f.floorPlanId });
    }
  }
  return out;
}

function seedRooms(floors: WfFloor[]): WfRoom[] {
  const out: WfRoom[] = [];
  for (const f of floors) {
    const tower = mockTowers.find(t => t.id === f.towerId);
    if (!tower) continue;
    const flatId = defaultFlatId(f.id);
    for (const r of getRooms(f.id, f.towerId, tower.projectId)) {
      out.push({ id: r.id, flatId, floorId: f.id, towerId: f.towerId, projectId: tower.projectId, name: r.name, type: r.type });
    }
  }
  return out;
}

function defaultFlatId(floorId: string) {
  return `${floorId}-flat-a`;
}

function seedFlats(floors: WfFloor[]): WfFlat[] {
  return floors.map(f => {
    const tower = mockTowers.find(t => t.id === f.towerId);
    return {
      id: defaultFlatId(f.id),
      floorId: f.id,
      towerId: f.towerId,
      projectId: tower?.projectId ?? '',
      number: 'Flat A',
      type: '1 BHK',
    };
  });
}

const ROOM_TEMPLATES: Record<FlatType, Array<{ name: string; type: WfRoom['type'] }>> = {
  '1 BHK': [
    { name: 'Living Room', type: 'living' },
    { name: 'Master Bedroom', type: 'bedroom' },
    { name: 'Kitchen', type: 'kitchen' },
    { name: 'Bathroom', type: 'bathroom' },
    { name: 'Balcony', type: 'balcony' },
  ],
  '2 BHK': [
    { name: 'Living Room', type: 'living' },
    { name: 'Master Bedroom', type: 'bedroom' },
    { name: 'Bedroom 1', type: 'bedroom' },
    { name: 'Kitchen', type: 'kitchen' },
    { name: 'Dining Area', type: 'dining' },
    { name: 'Bathroom', type: 'bathroom' },
    { name: 'Balcony', type: 'balcony' },
    { name: 'Utility Area', type: 'utility' },
  ],
  '3 BHK': [
    { name: 'Living Room', type: 'living' },
    { name: 'Master Bedroom', type: 'bedroom' },
    { name: 'Bedroom 1', type: 'bedroom' },
    { name: 'Bedroom 2', type: 'bedroom' },
    { name: 'Kitchen', type: 'kitchen' },
    { name: 'Dining Area', type: 'dining' },
    { name: 'Common Bathroom', type: 'bathroom' },
    { name: 'Attached Bathroom', type: 'bathroom' },
    { name: 'Balcony', type: 'balcony' },
    { name: 'Utility Area', type: 'utility' },
  ],
  '4 BHK': [
    { name: 'Living Room', type: 'living' },
    { name: 'Master Bedroom', type: 'bedroom' },
    { name: 'Bedroom 1', type: 'bedroom' },
    { name: 'Bedroom 2', type: 'bedroom' },
    { name: 'Bedroom 3', type: 'bedroom' },
    { name: 'Kitchen', type: 'kitchen' },
    { name: 'Dining Area', type: 'dining' },
    { name: 'Family Lounge', type: 'lounge' },
    { name: 'Home Office', type: 'office' },
    { name: 'Utility Area', type: 'utility' },
    { name: 'Multiple Bathrooms', type: 'bathroom' },
    { name: 'Balcony', type: 'balcony' },
  ],
};

interface WorkflowState {
  projects: ProjectArchived[];
  towers: MockTower[];
  floors: WfFloor[];
  flats: WfFlat[];
  rooms: WfRoom[];
  captures: MockCapture[];
  tours: MockTour[];
  floorPlans: MockFloorPlan[];
  capturePins: WfCapturePin[];
  defects: MockDefect[];
  notifications: MockNotification[];
  auditLogs: MockAuditLog[];
  users: MockUser[];
  uidCounter: number;

  nextId: (prefix: string) => string;
  resetToSeed: () => void;
  hydrateFromApi: (data: Partial<WorkflowDataState>, options?: { replace?: boolean }) => void;

  // ── Projects ──
  createProject: (p: Partial<MockProject> & { name: string }) => string;
  updateProject: (id: string, patch: Partial<MockProject>) => void;
  archiveProject: (id: string) => void;

  // ── Towers ──
  createTower: (projectId: string, name: string, floors?: number) => string;
  updateTower: (id: string, patch: Partial<MockTower>) => void;
  deleteTower: (id: string) => void;

  // ── Floors ──
  createFloor: (towerId: string, number: number) => string;
  updateFloor: (id: string, patch: Partial<WfFloor>) => void;
  deleteFloor: (id: string) => void;

  // ── Flats / Units ──
  createFlat: (floorId: string, number: string, type: FlatType) => string;
  updateFlat: (id: string, patch: Partial<WfFlat>) => void;
  deleteFlat: (id: string) => void;
  generateStandardRooms: (flatId: string) => void;

  // ── Rooms ──
  createRoom: (flatId: string, name: string, type: WfRoom['type']) => string;
  updateRoom: (id: string, patch: Partial<WfRoom>) => void;
  deleteRoom: (id: string) => void;
  assignFloorPlan: (roomId: string, floorPlanId: string) => void;

  // ── Floor Plans ──
  uploadFloorPlan: (payload: Omit<MockFloorPlan, 'id' | 'uploadedAt' | 'uploadedBy'> & { uploadedBy?: string; mediaAssets?: UploadedFileResponse[] }) => string;
  /** Remove a floor-plan drawing and its capture pins (admin/manager). */
  deleteFloorPlan: (id: string) => void;

  // ── Capture Pins ──
  createCapturePin: (args: {
    floorPlanId: string;
    floorId: string;
    towerId: string;
    projectId: string;
    x: number;
    y: number;
    createdBy?: string;
    flatName?: string;
    roomName?: string;
    label?: string;
    isPredefined?: boolean;
    source?: WfCapturePin['source'];
  }) => string;
  updateCapturePinLocal: (id: string, patch: Partial<WfCapturePin>) => void;
  copyPinsFromFloor: (args: {
    targetFloorId: string;
    sourceFloorId: string;
    targetFloorPlanId?: string;
    sourceFloorPlanId?: string;
  }) => Promise<number>;
  setFloorPlanPinsVisible: (floorPlanId: string, visible: boolean) => void;
  attachCaptureToPin: (pinId: string, fileCount: number, mediaAssets?: UploadedFileResponse[]) => string;
  /**
   * Drop a capture that was attached when upload was accepted (202) but whose
   * background stitch permanently failed (corrupt file). Unlinks from the pin
   * WITHOUT deleting the pin — the engineer must re-capture on the same pin.
   */
  discardStitchFailedCapture: (pinId: string, stitchJobId: string) => void;
  deleteCapturePin: (id: string) => void;
  /** Drop empty free-place pins on a floor (accidental plan taps), keep labeled layout. */
  pruneEmptyFreeplacePinsOnFloor: (floorId: string) => number;
  publishFloorPlanTour: (floorPlanId: string, pinIds?: string[], opts?: { silent?: boolean }) => string[];

  // ── Captures ──
  uploadCapture: (roomId: string, fileCount: number, mediaAssets?: UploadedFileResponse[]) => string;
  /** Replace an existing capture's placeholder media with the finished stitched asset. */
  finalizeCaptureMedia: (captureId: string, fileCount: number, mediaAssets?: UploadedFileResponse[]) => void;
  deleteCapture: (id: string) => void;
  replaceCapture: (id: string, fileCount: number) => void;

  // ── Review ──
  reviewCapture: (id: string, action: 'approve' | 'reject' | 'request_changes', notes?: string) => void;
  assignReviewer: (id: string, reviewerName: string) => void;

  // ── Publish ──
  publishCapture: (id: string) => void;
  unpublishCapture: (id: string) => void;

  // ── Tours ──
  generateTour: (captureId: string) => string;
  publishTour: (id: string) => void;
  updateTour: (id: string, patch: Partial<MockTour>) => void;
  deleteTour: (id: string) => void;

  // ── Defects ──
  createDefect: (d: Omit<MockDefect, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateDefect: (id: string, patch: Partial<MockDefect>) => void;

  // ── Notifications ──
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  deleteNotification: (id: string) => void;
  restoreNotification: (n: MockNotification, index: number) => void;

  // ── Team membership ──
  addUserToProject: (userId: string, projectId: string) => void;
  removeUserFromProject: (userId: string, projectId: string) => void;
}

const GRADIENTS = [
  'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)',
  'linear-gradient(135deg, #1a3a2a 0%, #0f2318 100%)',
  'linear-gradient(135deg, #2d1b4e 0%, #1a0f2e 100%)',
  'linear-gradient(135deg, #3a1f1a 0%, #221008 100%)',
];

function keepPrimaryProjectData(data: WorkflowDataState): WorkflowDataState {
  const projectIds = primaryProjectIds(data.projects);
  const towerIds = new Set(data.towers.filter(t => projectIds.has(t.projectId)).map(t => t.id));
  const floorIds = new Set(data.floors.filter(f => towerIds.has(f.towerId)).map(f => f.id));
  // Flats and rooms may have empty projectId when created as pin-backing rooms —
  // include them if their floor is in scope to avoid cascading false-drops.
  const flatIds = new Set(data.flats.filter(f => floorIds.has(f.floorId)).map(f => f.id));
  const roomIds = new Set(data.rooms.filter(r => flatIds.has(r.flatId) || floorIds.has(r.floorId)).map(r => r.id));
  return {
    ...data,
    projects: data.projects.filter(p => projectIds.has(p.id)),
    towers: data.towers.filter(t => projectIds.has(t.projectId)),
    floors: data.floors.filter(f => towerIds.has(f.towerId)),
    flats: data.flats.filter(f => floorIds.has(f.floorId)),
    rooms: data.rooms.filter(r => flatIds.has(r.flatId) || floorIds.has(r.floorId)),
    captures: data.captures.filter(c => projectIds.has(c.projectId) || roomIds.has(c.roomId)),
    // Tours are kept by projectId only — their roomId points to a pin-backing room
    // which may have an empty projectId on its parent flat (created via createRoom).
    // Filtering by roomId here would silently drop valid published tours.
    tours: data.tours.filter(t => projectIds.has(t.projectId)),
    floorPlans: data.floorPlans.filter(fp => projectIds.has(fp.projectId) && towerIds.has(fp.towerId) && floorIds.has(fp.floorId)),
    capturePins: (data.capturePins ?? []).filter(pin => projectIds.has(pin.projectId) && floorIds.has(pin.floorId)),
    defects: data.defects.filter(d => projectIds.has(d.projectId)),
    auditLogs: data.auditLogs.filter(a => !a.projectId || projectIds.has(a.projectId)),
  };
}

export function buildInitialWorkflowData(): WorkflowDataState {
  return {
    projects: [],
    towers: [],
    floors: [],
    flats: [],
    rooms: [],
    captures: [],
    tours: [],
    floorPlans: [],
    capturePins: [],
    defects: [],
    notifications: [],
    auditLogs: [],
    users: [],
    uidCounter: 1,
  };
}

function isValidWorkflowData(data: unknown): data is WorkflowDataState {
  if (!data || typeof data !== 'object') return false;
  const d = data as WorkflowDataState;
  return Array.isArray(d.projects) && Array.isArray(d.captures) && Array.isArray(d.tours);
}

function ensureFlatHierarchy(data: Partial<WorkflowDataState>): WorkflowDataState {
  const seed = buildInitialWorkflowData();
  const floors = data.floors ?? seed.floors;
  const towers = data.towers ?? seed.towers;
  let flats = data.flats ?? [];

  if (!Array.isArray(flats) || flats.length === 0) {
    flats = floors.map(f => {
      const tower = towers.find(t => t.id === f.towerId);
      return {
        id: defaultFlatId(f.id),
        floorId: f.id,
        towerId: f.towerId,
        projectId: tower?.projectId ?? '',
        number: 'Flat A',
        type: '1 BHK',
      };
    });
  }

  const rooms = (data.rooms ?? seed.rooms).map(room => {
    const existing = room as WfRoom;
    if (existing.flatId && flats.some(flat => flat.id === existing.flatId)) return existing;
    const flat = flats.find(f => f.floorId === existing.floorId);
    return { ...existing, flatId: flat?.id ?? defaultFlatId(existing.floorId) };
  });

  return {
    ...seed,
    ...data,
    floors,
    flats,
    rooms,
    towers,
    projects: data.projects ?? seed.projects,
    captures: data.captures ?? seed.captures,
    tours: data.tours ?? seed.tours,
    floorPlans: data.floorPlans ?? seed.floorPlans,
    capturePins: data.capturePins ?? seed.capturePins,
    defects: data.defects ?? seed.defects,
    notifications: data.notifications ?? seed.notifications,
    auditLogs: data.auditLogs ?? seed.auditLogs,
    users: data.users ?? seed.users,
    uidCounter: data.uidCounter ?? seed.uidCounter,
  };
}

/**
 * Event name for backend-sync failures; a global listener surfaces a toast.
 * Re-exported from the write queue so existing importers keep working.
 */
export const SYNC_ERROR_EVENT = WRITE_QUEUE_SYNC_ERROR_EVENT;

/**
 * Durable backend mirror. Replaces the old fire-and-forget
 * `promise.catch(console.error)`: instead of firing a one-shot request whose
 * failure left this device's localStorage permanently ahead of the server
 * (the desktop-writes / mobile-can't-see-it sync bug), it enqueues a
 * serialisable { op, args } descriptor that is persisted and retried until it
 * lands — across reloads, reconnects and token refreshes.
 *
 * `op` is a method name on `workflowApiService`; `args` are its arguments.
 */
const mirrorApi = enqueueWrite;

function firstMediaUrl(mediaAssets: UploadedFileResponse[] = []) {
  const first = mediaAssets[0];
  return first?.processed_panorama_url || first?.original_file_url || first?.original_url || null;
}

function pushNotif(
  set: (fn: (s: WorkflowState) => Partial<WorkflowState>) => void,
  type: NotifType,
  title: string,
  body: string,
  link: string,
) {
  const id = `n${Date.now()}`;
  const notification = { id, type, title, body, link, read: false, createdAt: 'Just now' };
  set(s => ({
    notifications: [notification, ...s.notifications],
  }));
  mirrorApi('createNotification', [notification]);
}

/**
 * Highest numeric suffix used by any id in the snapshot (`c265` -> 265).
 *
 * `nextId` mints ids by incrementing a single counter persisted in
 * localStorage, so that counter must never sit BELOW an id the server already
 * uses — otherwise the next upload is handed an id that already belongs to
 * another record. Confirmed in production with the counter reset to 1 while the
 * server held ids up to c265: re-minted ids collided with historical tombstones
 * (records silently hidden, then deleted by the reconcile) and made
 * `_upsert` replace live documents instead of inserting new ones.
 *
 * The counter can end up too low for several unrelated reasons — a persist that
 * never landed, a store version migration, cleared site data on one device while
 * another keeps uploading — so rather than chase each cause, the counter is
 * re-based against reality on every hydrate.
 */
function highestIdSuffix(data: Partial<WorkflowDataState>): number {
  const collections: Array<{ id: string }[] | undefined> = [
    data.projects, data.towers, data.floors, data.flats, data.rooms,
    data.captures, data.tours, data.floorPlans, data.capturePins, data.defects,
  ];
  let max = 0;
  for (const list of collections) {
    for (const item of list ?? []) {
      // Ids look like `<prefix><n>`, and room ids are `<flatId>-r<n>` — take the
      // trailing digit run in both cases.
      const m = /(\d+)$/.exec(item?.id ?? '');
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isSafeInteger(n) && n > max) max = n;
    }
  }
  return max;
}

function pushAudit(
  set: (fn: (s: WorkflowState) => Partial<WorkflowState>) => void,
  eventType: AuditEventType,
  entityType: MockAuditLog['entityType'],
  entityId: string,
  entityName: string,
  projectId: string | null,
  description: string,
) {
  const id = `al${Date.now()}`;
  // createdAt is a real ISO instant, and the actor is the signed-in user.
  // Previously this wrote createdAt: 'Just now' with a hardcoded actorId 'u1' /
  // actorName 'You', which made the whole trail unsortable and attributed every
  // event to nobody — useless exactly when it was needed to trace who removed a
  // record. The backend re-stamps identity and time authoritatively, so these
  // values are only the optimistic local copy.
  const actor = useAuthStore.getState().user;
  const auditLog = {
      id,
      actorId: actor?.id ?? 'unknown',
      actorName: currentUploaderName(),
      eventType, entityType,
      entityId, entityName, projectId, description,
      createdAt: new Date().toISOString(),
    };
  set(s => ({
    auditLogs: [auditLog, ...s.auditLogs],
  }));
  mirrorApi('createAuditLog', [auditLog]);
}

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => ({
      ...buildInitialWorkflowData(),

      nextId(prefix) {
        const uidCounter = get().uidCounter + 1;
        set({ uidCounter });
        return `${prefix}${uidCounter}`;
      },

      resetToSeed() {
        set(buildInitialWorkflowData());
      },

      hydrateFromApi(data, options) {
        const migrated = ensureFlatHierarchy(data);
        // `replace` mode is used for project-scoped loads (e.g. a field engineer
        // whose snapshot is filtered to their assigned projects). It treats the
        // API payload as authoritative — no merge with stale local data, and no
        // back-fill re-upload of records that belong to other projects.
        const replace = options?.replace ?? false;

        // One-time salvage: an earlier hydrate path tombstoned real published
        // walkthroughs that failed a strict media URL check (media often lives on
        // captures). Un-tombstone any that still exist server-side so favorites
        // and the Virtual Tours list can show them again.
        try {
          const salvageKey = 'sitesurelabs-clear-false-junk-tour-tombstones-v1';
          if (!localStorage.getItem(salvageKey)) {
            const salvageIds = (migrated.tours ?? [])
              .filter(t => isLiveUploadedTour(t))
              .map(t => t.id);
            if (salvageIds.length) clearTombstones(salvageIds);
            localStorage.setItem(salvageKey, '1');
          }
        } catch {
          /* localStorage unavailable — skip salvage */
        }

        // Records the client intentionally deleted. They must never be kept from
        // local state nor re-uploaded, even though the API snapshot omits them —
        // otherwise a delete is undone on the next reload (resurrection bug).
        const tombstones = tombstoneSet();
        // Deletion timestamps for the same ids, read once: the reconcile blocks
        // below need them to tell "our delete didn't land" apart from "this id
        // was re-minted for a new record" (see isSameRecordAsTombstoned).
        const tombstonedAt = tombstoneMap();

        // ── Self-heal stale tombstones ────────────────────────────────────────
        // Record ids come from one monotonic counter persisted under the store's
        // localStorage key, while tombstones live under a separate key, so the
        // two can drift (a quota-capped persist, or store state reverting to an
        // older snapshot while tombstones survive). The counter then re-mints an
        // id that is still tombstoned, and every tombstone check below — which
        // matches on id alone — treats a brand-new record as deleted: it gets
        // filtered out of local state, its pin then looks captureless and is
        // dropped too. Observed hiding 4 of 11 freshly-uploaded captures while
        // the server held all 13 intact.
        //
        // A tombstone for a record that provably post-dates it is wrong, so drop
        // it for good here. Doing it once, up front, makes every `tombstones.has`
        // check below correct without each having to re-derive the timestamps.
        const superseded = [
          ...(migrated.captures ?? []),
          ...(migrated.capturePins ?? []),
          ...(migrated.tours ?? []),
          ...(migrated.floorPlans ?? []),
          ...(get().captures ?? []),
          ...(get().capturePins ?? []),
          ...(get().tours ?? []),
          ...(get().floorPlans ?? []),
        ].reduce<string[]>((acc, rec) => {
          const id = (rec as { id?: string })?.id;
          if (id && tombstoneIsSuperseded(id, rec, tombstonedAt)) acc.push(id);
          return acc;
        }, []);
        if (superseded.length) {
          clearTombstones(superseded);
          for (const id of superseded) {
            tombstones.delete(id);
            delete tombstonedAt[id];
          }
        }

        // Merge helper: the API snapshot is authoritative for deletion — a hard
        // delete on ANY device makes the row physically absent from every future
        // snapshot, on every device, so "missing from the API" already means
        // "deleted" without needing a matching local tombstone (tombstones are
        // per-device localStorage and never sync across devices; trusting them
        // for this check is what let a delete on desktop go invisible on phone
        // and vice versa). A local-only item is kept ONLY if it's a genuinely
        // unsynced create (`createOp`/`isCreatePending`) still in this device's
        // own write queue — that's the one case where "missing from the API" means
        // "not yet uploaded" rather than "deleted elsewhere." Tombstoned ids are
        // still dropped outright (belt-and-suspenders for the reconcile logic
        // below, which re-issues deletes when a tombstoned id reappears).
        const mergeById = <T extends { id: string }>(
          api: T[] | undefined,
          local: T[],
          createOp?: WriteOpName,
        ): T[] => {
          const map = new Map<string, T>();
          if (api) {
            for (const item of local) {
              if (tombstones.has(item.id)) continue;
              if (createOp && isCreatePending(createOp, item.id)) map.set(item.id, item);
            }
          } else {
            // No API data at all for this collection (e.g. request failed) —
            // fall back to local so a transient error can't wipe the UI.
            for (const item of local) {
              if (!tombstones.has(item.id)) map.set(item.id, item);
            }
          }
          for (const item of (api ?? [])) {
            // Server-provided record: only suppress it if the tombstone provably
            // applies to THIS record (see hiddenByTombstone).
            if (!hiddenByTombstone(item.id, item, tombstonedAt)) map.set(item.id, item);
          }
          return [...map.values()];
        };

        // Use a single consistent source for pins throughout this function:
        // API pins if the API returned them, otherwise keep local state.
        const apiPins = migrated.capturePins;
        const localPins = get().capturePins;
        // Pins whose photo bytes are still in this device's durable upload queue
        // (offline, retrying, or awaiting a background stitch). Read from a leaf
        // module rather than fileUploadQueue directly, which imports this store.
        const pinsWithPendingUploads = pendingUploadPins();
        const keepLocalPins = replace
          ? (() => {
              // replace mode is authoritative for synced data, but must still
              // keep local pins whose create is in-flight OR whose photo bytes
              // are still on this device's upload queue — otherwise a snapshot
              // that races ahead of writeQueue / lags the capture POST drops
              // the pin mid-upload and the photo has nowhere to attach.
              const api = apiPins ?? [];
              const apiIds = new Set(api.map(p => p.id));
              return localPins.filter(
                p =>
                  !apiIds.has(p.id) &&
                  !tombstones.has(p.id) &&
                  (isCreatePending('createCapturePin', p.id) || pinsWithPendingUploads.has(p.id)),
              );
            })()
          : [];
        const basePinsRaw = (
          replace
            ? [...(apiPins ?? []), ...keepLocalPins]
            : mergeById(apiPins, localPins, 'createCapturePin')
        )
          // Belt-and-suspenders: mergeById already drops tombstoned/non-pending
          // local-only ids when apiPins is present; this also covers the rare
          // case apiPins is undefined (failed request) and falls back to raw
          // localPins.
          .filter(p => !hiddenByTombstone(p.id, p, tombstonedAt));
        // Union captureIds with local — API pin replace must not wipe older visits
        // when a stale short captureIds list wins the merge (Compare/timeline bug).
        const localPinById = new Map(localPins.map(p => [p.id, p]));
        const basePins = basePinsRaw.map(p => {
          const local = localPinById.get(p.id);
          if (!local?.captureIds?.length) return p;
          const captureIds = [...new Set([...(p.captureIds ?? []), ...local.captureIds])];
          return captureIds.length === (p.captureIds?.length ?? 0) ? p : { ...p, captureIds };
        });
        // Deduplicate captureIds within each pin.
        const deduped = basePins.map(p => ({
          ...p,
          captureIds: [...new Set(p.captureIds)],
        }));

        // Drop captureIds that have no corresponding capture record (dangling refs
        // from captures deleted server-side or from a mismatched sync). Also
        // RE-LINK captures that share the pin's backing roomId but are missing
        // from captureIds — that race (createCapture without updateCapturePin)
        // is what made "Pin 1" vanish from the plan while still showing in the
        // gallery, and left Images Analyzed one short.
        const capturesForHeal = (
          replace
            ? (migrated.captures ?? [])
            : [...(migrated.captures ?? []), ...get().captures]
        ).filter(c => !tombstones.has(c.id));
        const mergedCaptureIds = new Set(capturesForHeal.map(c => c.id));
        const captureIdsByRoom = new Map<string, string[]>();
        for (const c of capturesForHeal) {
          if (!c.roomId) continue;
          const list = captureIdsByRoom.get(c.roomId) ?? [];
          list.push(c.id);
          captureIdsByRoom.set(c.roomId, list);
        }

        const pinsToResync: WfCapturePin[] = [];
        const healedPins = deduped.map(p => {
          const fromIds = p.captureIds.filter(id => mergedCaptureIds.has(id));
          const fromRoom = (captureIdsByRoom.get(p.roomId) ?? []).filter(id => mergedCaptureIds.has(id));
          const captureIds = [...new Set([...fromIds, ...fromRoom])];
          if (fromRoom.some(id => !p.captureIds.includes(id))) {
            pinsToResync.push({ ...p, captureIds });
          }
          return { ...p, captureIds };
        });

        const cleanPins = healedPins
          .filter(p => {
            // Keep pins that still have captures OR have never had any (freshly placed, not yet captured).
            // Remove only those that had captures but all of them are now dangling —
            // and no room-owned capture exists either (after the heal above).
            const hadCaptures = basePins.find(bp => bp.id === p.id)!.captureIds.length > 0;
            if (!hadCaptures || p.captureIds.length > 0) return true;
            // Room still owns captures even if captureIds was stale — keep the pin.
            if ((captureIdsByRoom.get(p.roomId) ?? []).some(id => mergedCaptureIds.has(id))) return true;
            // Every captureId resolved to nothing — but that is only a deletion if
            // the work actually FINISHED. A pin whose photo bytes are still sitting
            // in this device's durable upload queue (offline, retrying, or being
            // stitched in the background) is mid-flight, not deleted: dropping it
            // would destroy the only copy of a capture the engineer has taken.
            //
            // This is why pins vanished on refresh right after a capture — the
            // createCapture write had already flushed (so isCreatePending was
            // false) while the server snapshot still lagged, so every captureId
            // looked dangling and the pin was deleted.
            if (pinsWithPendingUploads.has(p.id)) return true;
            const original = basePins.find(bp => bp.id === p.id)!;
            return original.captureIds.some(id => isCreatePending('createCapture', id));
          });

        // Persist healed links so the next snapshot / Construction Progress
        // analyze see the same pin.captureIds the gallery already implied.
        for (const pin of pinsToResync) {
          if (tombstones.has(pin.id)) continue;
          if (!cleanPins.some(p => p.id === pin.id)) continue;
          mirrorApi('updateCapturePin', [pin.id, { captureIds: pin.captureIds }], 'heal-pin-captures');
        }
        set(s => {
          const mergedCaptures = (
            replace
              ? (migrated.captures ?? [])
              : mergeById(migrated.captures, s.captures, 'createCapture')
          ).filter(c => !hiddenByTombstone(c.id, c, tombstonedAt));

          // Captures belonging to a pin whose upload is still pending on THIS
          // device must survive the merge even when the snapshot omits them: with
          // background stitching the capture doc's own create request can land
          // well after the photo bytes were accepted, so "absent from snapshot"
          // does not mean "deleted elsewhere" for these.
          //
          // Applies in replace mode too — a post-login snapshot must not wipe a
          // capture that was just attached locally while bytes are still
          // uploading or stitching on this device.
          //
          // Scoped strictly to pins with a live queue entry, so a genuine remote
          // delete of a finished capture still converges normally.
          if (pinsWithPendingUploads.size) {
            const pendingCaptureIds = new Set(
              s.capturePins
                .filter(p => pinsWithPendingUploads.has(p.id))
                .flatMap(p => p.captureIds),
            );
            for (const local of s.captures) {
              if (tombstones.has(local.id)) continue;
              if (!pendingCaptureIds.has(local.id)) continue;
              if (mergedCaptures.some(c => c.id === local.id)) continue;
              mergedCaptures.push(local);
            }
            // Restore captureIds stripped by the dangling-ref filter above when
            // the capture is still local and the pin's upload is in flight.
            for (const pin of cleanPins) {
              if (!pinsWithPendingUploads.has(pin.id)) continue;
              const localPin = s.capturePins.find(p => p.id === pin.id);
              if (!localPin) continue;
              for (const cid of localPin.captureIds) {
                if (!pin.captureIds.includes(cid) && mergedCaptures.some(c => c.id === cid)) {
                  pin.captureIds.push(cid);
                }
              }
            }
          }

          // NOTE: captures whose roomName looks like "Pin N" but which no pin
          // currently references used to be dropped from local state here, as
          // presumed leftovers from a pin delete that left Mongo rows behind.
          // That inference is unsafe — it cannot tell debris apart from a real
          // photo whose pin link is merely missing on THIS device. Observed: a
          // stale tombstone hid one legacy pin, so its freshly-uploaded capture
          // looked unreferenced and was deleted from state too, leaving the app
          // one capture short of the server (and of the same account in another
          // browser) while the photo sat intact in Cloudinary and Mongo.
          // Unlinked captures are now kept; the gallery shows them (see
          // isGalleryVisibleCapture) so they can be seen and dealt with.

          const apiToursRaw = replace
            ? (migrated.tours ?? [])
            : (migrated.tours ?? s.tours);
          // Catalog filter only — never delete Mongo records that fail the check.
          // Walkthrough media can live on linked captures (TourViewer derives it);
          // auto-deleting here permanently wiped real favorites/published tours.
          //
          // Deliberately NOT filtering by `tombstones` here: a tombstone only means
          // THIS device asked to delete the tour at some point — it's a per-device
          // localStorage set that never syncs to other devices. If the server
          // snapshot still contains the tour, either the delete hasn't landed yet
          // or (permanent 404/409/422) never will — either way the reconcile block
          // below keeps re-issuing the delete, but hiding it from THIS device's
          // list in the meantime just produces "desktop shows fewer tours than
          // phone" drift that never resolves. Showing the true server state here
          // lets the user see and retry a stuck delete instead of it silently
          // vanishing on one device forever while every other device still has it.
          const liveTours = apiToursRaw.filter(isLiveUploadedTour);

          // Keep backing rooms/flats for offline pins that survive replace mode.
          // Without this, uploadCapture sees no room, used to return a fake id,
          // and the file queue treated attach as success while no capture existed.
          let nextRooms = migrated.rooms ?? s.rooms;
          let nextFlats = migrated.flats ?? s.flats;
          if (replace && keepLocalPins.length) {
            const roomIds = new Set(nextRooms.map(r => r.id));
            const flatIds = new Set(nextFlats.map(f => f.id));
            for (const pin of keepLocalPins) {
              const localRoom = s.rooms.find(r => r.id === pin.roomId);
              if (localRoom && !roomIds.has(localRoom.id) && !tombstones.has(localRoom.id)) {
                nextRooms = [...nextRooms, localRoom];
                roomIds.add(localRoom.id);
              }
              const flatId = localRoom?.flatId;
              if (flatId) {
                const localFlat = s.flats.find(f => f.id === flatId);
                if (localFlat && !flatIds.has(localFlat.id) && !tombstones.has(localFlat.id)) {
                  nextFlats = [...nextFlats, localFlat];
                  flatIds.add(localFlat.id);
                }
              }
            }
          }

          return {
            ...s,
            ...migrated,
            // Never let the id counter sit below an id the server already uses —
            // see highestIdSuffix. Monotonic: only ever raised, so a device that
            // is already ahead keeps its value.
            uidCounter: Math.max(s.uidCounter, highestIdSuffix(migrated)),
            projects:      migrated.projects      ?? s.projects,
            towers:        migrated.towers        ?? s.towers,
            floors:        migrated.floors        ?? s.floors,
            flats:         nextFlats,
            rooms:         nextRooms,
            tours:         liveTours,
            // Trust the API snapshot directly for floor plans (same reasoning as
            // `liveTours` above): `migrated.floorPlans ?? s.floorPlans` already
            // means "server data wins whenever the API returned any," so a
            // remaining local-tombstone filter here would only hide a floor plan
            // the server still reports — i.e. per-device drift, not real deletion.
            floorPlans:    (migrated.floorPlans ?? s.floorPlans),
            defects:       migrated.defects       ?? s.defects,
            notifications: migrated.notifications ?? s.notifications,
            auditLogs:     migrated.auditLogs     ?? s.auditLogs,
            users:         migrated.users         ?? s.users,
            captures: mergedCaptures,
            capturePins: cleanPins,
          };
        });

        // Back-fill re-syncs local-only records to the backend. Skip it entirely
        // in replace mode — those records belong to projects outside this user's
        // scope and must not be re-uploaded.
        //
        // Exception: pins (and their backing room/flat) that still have photo
        // bytes on THIS device. replace skips normal backfill, so if writeQueue
        // previously dropped a create while offline, reconnect must re-issue
        // those creates or the upload can never attach.
        if (replace && pinsWithPendingUploads.size) {
          const apiPinIds = new Set((apiPins ?? []).map(p => p.id));
          const apiRoomIds = new Set((migrated.rooms ?? []).map(r => r.id));
          const apiFlatIds = new Set((migrated.flats ?? []).map(f => f.id));
          for (const pin of cleanPins) {
            if (!pinsWithPendingUploads.has(pin.id) || tombstones.has(pin.id)) continue;
            const room = get().rooms.find(r => r.id === pin.roomId);
            if (room && !apiRoomIds.has(room.id) && !tombstones.has(room.id) && !isCreatePending('createRoom', room.id)) {
              const flat = get().flats.find(f => f.id === room.flatId);
              if (flat && !apiFlatIds.has(flat.id) && !tombstones.has(flat.id) && !isCreatePending('createFlat', flat.id)) {
                mirrorApi('createFlat', [flat], 'reconnect-flat');
              }
              mirrorApi('createRoom', [room], 'reconnect-room');
            }
            if (!apiPinIds.has(pin.id) && !isCreatePending('createCapturePin', pin.id)) {
              mirrorApi('createCapturePin', [pin], 'reconnect-pin');
            }
          }
        }

        if (!replace) {
          const apiCaptureIds = new Set((migrated.captures ?? []).map(c => c.id));
          for (const cap of get().captures) {
            // Skip tombstoned ids — re-uploading a deleted capture would resurrect it.
            // Skip ids whose ORIGINAL create is still queued/unsent: the API
            // snapshot is stale exactly BECAUSE that write hasn't landed yet,
            // not because it was lost — re-enqueuing here would race the
            // pending write and create two backend records for one capture.
            if (!apiCaptureIds.has(cap.id) && !tombstones.has(cap.id) && !isCreatePending('createCapture', cap.id)) {
              mirrorApi('createCapture', [cap as MockCapture], 'backfill-capture');
            }
          }

          // Pin back-fill: use the same `apiPins` source so the check is consistent.
          const apiPinIds = new Set((apiPins ?? []).map(p => p.id));
          for (const pin of cleanPins) {
            if (tombstones.has(pin.id)) continue;
            if (!apiPinIds.has(pin.id)) {
              // Same race as captures above: a pin created offline allocates
              // its OWN backing room inline (createCapturePin → createRoom),
              // so re-sending the create here doesn't just risk a duplicate
              // pin document — the still-pending original write creates its
              // own room too, and the two rooms/pins can never converge back
              // into one (this was reproduced end-to-end: offline capture +
              // app kill + reconnect created 2 rooms + 2 pins for 1 capture).
              if (!isCreatePending('createCapturePin', pin.id)) {
                mirrorApi('createCapturePin', [pin], 'backfill-pin');
              }
            } else {
              const apiPin = (apiPins ?? []).find(p => p.id === pin.id);
              if (apiPin && pin.captureIds.length !== (apiPin.captureIds?.length ?? 0)) {
                mirrorApi('updateCapturePin', [pin.id, { captureIds: pin.captureIds }], 'sync-pin');
              }
            }
          }

          // Converged cleanup: if a tombstoned id REAPPEARS in the API snapshot,
          // the server still has it (our delete hasn't applied or was rejected) —
          // re-issue the delete so FE and BE converge instead of silently diverging.
          //
          // Guarded by `isSameRecordAsTombstoned`: a reappearing id is only the
          // record we deleted if the server's copy predates our tombstone. See
          // that helper for why an id-only match is not safe.
          const apiFloorPlanIds = new Set((migrated.floorPlans ?? []).map(fp => fp.id));
          const apiTourIds = new Set((migrated.tours ?? []).map(t => t.id));
          const recordById = new Map<string, unknown>();
          for (const r of [
            ...(migrated.captures ?? []),
            ...(apiPins ?? []),
            ...(migrated.tours ?? []),
            ...(migrated.floorPlans ?? []),
          ]) {
            if ((r as { id?: string })?.id) recordById.set((r as { id: string }).id, r);
          }
          const stillPresent = new Set<string>([
            ...apiCaptureIds,
            ...apiPinIds,
            ...apiTourIds,
            ...apiFloorPlanIds,
          ]);
          const reappeared = [...tombstones].filter(
            id => stillPresent.has(id) && isSameRecordAsTombstoned(id, recordById.get(id), tombstonedAt),
          );
          for (const id of reappeared) {
            // Audit AUTOMATED deletions too. When captures began vanishing, this
            // path was the culprit and left no trace at all — the trail only
            // recorded user-initiated events, so the deletion had to be inferred
            // from Cloudinary side effects. An unattended delete is exactly the
            // kind that most needs a record.
            const kind = apiCaptureIds.has(id)
              ? (['deleteCapture', 'capture_deleted', 'capture'] as const)
              : apiPinIds.has(id)
                ? (['deleteCapturePin', 'capture_pin_deleted', 'capture_pin'] as const)
                : apiFloorPlanIds.has(id)
                  ? (['deleteFloorPlan', 'floor_plan_deleted', 'floor_plan'] as const)
                  : (['deleteTour', 'tour_deleted', 'tour'] as const);
            const [op, eventType, entityType] = kind;
            mirrorApi(op, [id], `reconcile-delete-${entityType}`);
            pushAudit(
              set, eventType, entityType, id, id, null,
              `Automatic reconcile delete: id was tombstoned locally at ` +
                `${new Date(tombstonedAt[id]).toISOString()} but still present in the server ` +
                `snapshot, so the delete was re-issued (no user action).`,
            );
          }

          // NOTE: this used to also auto-delete server-side "orphan" captures
          // here — any capture whose (frozen, never-updated) roomName field
          // matched /^Pin \d+$/ and wasn't in a pin's CURRENT captureIds list.
          // That heuristic is unsafe: roomName is stamped once at capture
          // creation and never kept in sync with pin renumbering, and
          // `linkedAfter` reflects only this device's in-memory state at this
          // instant, not a confirmed server-side fact. It fired during normal
          // use (no delete tapped) and permanently destroyed 3 real, in-use
          // captures whose pins (pin155/158/160) still referenced them —
          // leaving those pins pointing at nothing. Orphan capture rows are
          // now left alone; clean them up manually/via a script if they pile up.
          // Stale tombstones are pruned by TTL in the tombstone module, not eagerly
          // here — clearing on first absence risks dropping one before the delete
          // round-trips, which would let the record resurrect.
          // (clearTombstones IS used — see the self-heal pass at the top of this
          // function, which drops tombstones an id-reuse has made wrong.)
        } else {
          // Replace mode still needs tombstone deletes to converge the scoped
          // snapshot without re-backfilling other projects. Orphan-heuristic
          // auto-delete was removed here too — see the (!replace) branch above
          // for why: it's a false-positive-prone client-side guess, not a
          // server-confirmed fact, and it destroyed real captures in production.
          const apiCaptureById = new Map((migrated.captures ?? []).map(c => [c.id, c]));
          const apiTourById = new Map((migrated.tours ?? []).map(t => [t.id, t]));
          const toDeleteCaptures = [...tombstones].filter(
            id => apiCaptureById.has(id) && isSameRecordAsTombstoned(id, apiCaptureById.get(id), tombstonedAt),
          );
          if (toDeleteCaptures.length) {
            addTombstones(...toDeleteCaptures);
            for (const id of toDeleteCaptures) {
              mirrorApi('deleteCapture', [id], 'reconcile-orphan-capture');
            }
          }
          // Re-issue deletes for tombstoned tours that still appear in the snapshot.
          for (const id of [...tombstones].filter(
            tid => apiTourById.has(tid) && isSameRecordAsTombstoned(tid, apiTourById.get(tid), tombstonedAt),
          )) {
            mirrorApi('deleteTour', [id], 'reconcile-delete-tour');
          }
        }
      },

  // ── Projects ──────────────────────────────────────────────────────────────
  createProject(p) {
    const id = get().nextId('p');
    const project: ProjectArchived = {
      id, name: p.name,
      location: p.location ?? `${p.city ?? 'Hyderabad'}, ${p.state ?? 'Telangana'}`,
      city: p.city ?? 'Hyderabad', state: p.state ?? 'Telangana',
      client: p.client ?? 'My Home Constructions', description: p.description ?? '',
      status: p.status ?? 'active', progress: 0,
      towers: 0, floors: 0, rooms: 0, captures: 0, totalRooms: 0,
      startDate: p.startDate ?? '', endDate: p.endDate ?? '',
      gradient: GRADIENTS[get().projects.length % GRADIENTS.length], accent: '#2563eb',
      lastUpdated: 'Just now', thumbnail: (p as any).thumbnailUrl ?? null, teamSize: 1,
    };
    set(s => ({ projects: [...s.projects, project] }));
    mirrorApi('createProject', [project]);
    pushAudit(set, 'project_created', 'project', id, p.name, id, `Created project "${p.name}"`);
    return id;
  },
  updateProject(id, patch) {
    const proj = get().projects.find(p => p.id === id);
    set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, ...patch, lastUpdated: 'Just now' } : p) }));
    mirrorApi('updateProject', [id, { ...patch, lastUpdated: 'Just now' }]);
    if (proj) pushAudit(set, 'project_updated', 'project', id, proj.name, id, `Updated project "${proj.name}"`);
  },
  archiveProject(id) {
    set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, archived: !p.archived, status: p.archived ? 'active' : 'draft' } : p) }));
    const updated = get().projects.find(p => p.id === id);
    if (updated) mirrorApi('updateProject', [id, updated]);
  },

  // ── Towers ────────────────────────────────────────────────────────────────
  createTower(projectId, name, floorCount = 0) {
    const id = get().nextId('t');
    set(s => ({
      towers: [...s.towers, { id, projectId, name, floors: floorCount, rooms: 0, captures: 0, progress: 0, description: '', status: 'pending' }],
      projects: s.projects.map(p => p.id === projectId ? { ...p, towers: p.towers + 1, lastUpdated: 'Just now' } : p),
    }));
    const tower = get().towers.find(t => t.id === id);
    if (tower) mirrorApi('createTower', [tower]);
    return id;
  },
  updateTower(id, patch) {
    set(s => ({ towers: s.towers.map(t => t.id === id ? { ...t, ...patch } : t) }));
    mirrorApi('updateTower', [id, patch]);
  },
  deleteTower(id) {
    const tower = get().towers.find(t => t.id === id);
    set(s => ({
      towers: s.towers.filter(t => t.id !== id),
      floors: s.floors.filter(f => f.towerId !== id),
      flats: s.flats.filter(f => f.towerId !== id),
      rooms: s.rooms.filter(r => r.towerId !== id),
      captures: s.captures.filter(c => c.towerId !== id),
      tours: s.tours.filter(t => t.towerId !== id),
      projects: tower ? s.projects.map(p => p.id === tower.projectId ? { ...p, towers: Math.max(0, p.towers - 1) } : p) : s.projects,
    }));
    mirrorApi('deleteTower', [id]);
  },

  // ── Floors ────────────────────────────────────────────────────────────────
  createFloor(towerId, number) {
    const id = get().nextId('f');
    const floor: WfFloor = { id: `${towerId}-f${number}-${id}`, towerId, number, label: `Floor ${number}` };
    const tower = get().towers.find(t => t.id === towerId);
    set(s => ({
      floors: [...s.floors, floor],
      towers: s.towers.map(t => t.id === towerId ? { ...t, floors: t.floors + 1 } : t),
      projects: tower ? s.projects.map(p => p.id === tower.projectId ? { ...p, floors: p.floors + 1, lastUpdated: 'Just now' } : p) : s.projects,
    }));
    mirrorApi('createFloor', [floor]);
    return floor.id;
  },
  updateFloor(id, patch) {
    set(s => ({ floors: s.floors.map(f => f.id === id ? { ...f, ...patch } : f) }));
    mirrorApi('updateFloor', [id, patch]);
  },
  deleteFloor(id) {
    const floor = get().floors.find(f => f.id === id);
    set(s => ({
      floors: s.floors.filter(f => f.id !== id),
      flats: s.flats.filter(f => f.floorId !== id),
      rooms: s.rooms.filter(r => r.floorId !== id),
      captures: s.captures.filter(c => !s.rooms.some(r => r.floorId === id && r.id === c.roomId)),
      tours: s.tours.filter(t => !s.rooms.some(r => r.floorId === id && r.id === t.roomId)),
      towers: floor ? s.towers.map(t => t.id === floor.towerId ? { ...t, floors: Math.max(0, t.floors - 1) } : t) : s.towers,
    }));
    mirrorApi('deleteFloor', [id]);
  },

  // ── Flats / Units ─────────────────────────────────────────────────────────
  createFlat(floorId, number, type) {
    const id = get().nextId('flat');
    const floor = get().floors.find(f => f.id === floorId);
    if (!floor) return id;
    const tower = get().towers.find(t => t.id === floor.towerId);
    const flat: WfFlat = {
      id,
      floorId,
      towerId: floor.towerId,
      projectId: tower?.projectId ?? '',
      number: number || `Flat ${get().flats.filter(f => f.floorId === floorId).length + 1}`,
      type,
    };
    set(s => ({ flats: [...s.flats, flat] }));
    mirrorApi('createFlat', [flat]);
    get().generateStandardRooms(id);
    pushAudit(set, 'project_updated', 'project', flat.projectId, flat.number, flat.projectId, `Created ${flat.number} (${flat.type})`);
    return id;
  },
  updateFlat(id, patch) {
    set(s => ({ flats: s.flats.map(f => f.id === id ? { ...f, ...patch } : f) }));
    mirrorApi('updateFlat', [id, patch]);
  },
  deleteFlat(id) {
    const flat = get().flats.find(f => f.id === id);
    const roomIds = new Set(get().rooms.filter(r => r.flatId === id).map(r => r.id));
    set(s => ({
      flats: s.flats.filter(f => f.id !== id),
      rooms: s.rooms.filter(r => r.flatId !== id),
      captures: s.captures.filter(c => !roomIds.has(c.roomId)),
      tours: s.tours.filter(t => !roomIds.has(t.roomId)),
    }));
    mirrorApi('deleteFlat', [id]);
    if (flat) pushAudit(set, 'project_updated', 'project', flat.projectId, flat.number, flat.projectId, `Deleted ${flat.number}`);
  },
  generateStandardRooms(flatId) {
    const flat = get().flats.find(f => f.id === flatId);
    if (!flat) return;
    const existingNames = new Set(get().rooms.filter(r => r.flatId === flatId).map(r => r.name.toLowerCase()));
    const templates = ROOM_TEMPLATES[flat.type] ?? [];
    const newRooms: WfRoom[] = templates
      .filter(room => !existingNames.has(room.name.toLowerCase()))
      .map((room, index) => ({
        id: `${flatId}-r${get().uidCounter + index + 1}`,
        flatId,
        floorId: flat.floorId,
        towerId: flat.towerId,
        projectId: flat.projectId,
        name: room.name,
        type: room.type,
      }));
    if (!newRooms.length) return;
    set(s => ({
      uidCounter: s.uidCounter + newRooms.length,
      rooms: [...s.rooms, ...newRooms],
      towers: s.towers.map(t => t.id === flat.towerId ? { ...t, rooms: t.rooms + newRooms.length } : t),
      projects: s.projects.map(p => p.id === flat.projectId ? { ...p, rooms: p.rooms + newRooms.length, totalRooms: p.totalRooms + newRooms.length, lastUpdated: 'Just now' } : p),
    }));
    newRooms.forEach(room => mirrorApi('createRoom', [room]));
  },

  // ── Rooms ─────────────────────────────────────────────────────────────────
  createRoom(flatId, name, type) {
    const id = get().nextId('r');
    const flat = get().flats.find(f => f.id === flatId) ?? get().flats.find(f => f.floorId === flatId);
    const floor = flat ? get().floors.find(f => f.id === flat.floorId) : get().floors.find(f => f.id === flatId);
    if (!floor) return id;
    const parentFlat = flat ?? {
      id: defaultFlatId(floor.id),
      floorId: floor.id,
      towerId: floor.towerId,
      projectId: get().towers.find(t => t.id === floor.towerId)?.projectId ?? '',
      number: 'Flat A',
      type: '1 BHK' as FlatType,
    };
    // The backing flat is created on demand when a pin is placed on a floor that
    // has no explicit flat yet. It must be mirrored to the backend too — otherwise
    // the flat exists only in this device's localStorage, leaving an incomplete
    // hierarchy on the server that a second device cannot reconstruct.
    if (!get().flats.some(f => f.id === parentFlat.id)) {
      set(s => ({ flats: [...s.flats, parentFlat] }));
      mirrorApi('createFlat', [parentFlat]);
    }
    const room: WfRoom = { id: `${parentFlat.id}-${id}`, flatId: parentFlat.id, floorId: parentFlat.floorId, towerId: parentFlat.towerId, projectId: parentFlat.projectId, name, type };
    const tower = get().towers.find(t => t.id === floor.towerId);
    set(s => ({
      rooms: [...s.rooms, room],
      towers: s.towers.map(t => t.id === floor.towerId ? { ...t, rooms: t.rooms + 1 } : t),
      projects: tower ? s.projects.map(p => p.id === tower.projectId ? { ...p, rooms: p.rooms + 1, totalRooms: p.totalRooms + 1, lastUpdated: 'Just now' } : p) : s.projects,
    }));
    mirrorApi('createRoom', [room]);
    return room.id;
  },
  updateRoom(id, patch) {
    set(s => ({ rooms: s.rooms.map(r => r.id === id ? { ...r, ...patch } : r) }));
    mirrorApi('updateRoom', [id, patch]);
  },
  deleteRoom(id) {
    const room = get().rooms.find(r => r.id === id);
    // Captures still on this room (e.g. pin delete before each capture was removed)
    // must be tombstoned + API-deleted. Otherwise hydrate merge resurrects them and
    // Media Library / galleries show "deleted" images again.
    const leftoverIds = get().captures.filter(c => c.roomId === id).map(c => c.id);
    const leftoverSet = new Set(leftoverIds);
    cancelWritesForEntityIds(id, ...leftoverIds);
    set(s => ({
      rooms: s.rooms.filter(r => r.id !== id),
      captures: s.captures.filter(c => c.roomId !== id),
      tours: s.tours.filter(t => !leftoverSet.has(t.captureId)),
      towers: room ? s.towers.map(t => t.id === room.towerId ? { ...t, rooms: Math.max(0, t.rooms - 1) } : t) : s.towers,
    }));
    if (leftoverIds.length) {
      addTombstones(...leftoverIds);
      leftoverIds.forEach(cid => mirrorApi('deleteCapture', [cid]));
    }
    mirrorApi('deleteRoom', [id]);
    if (room) {
      pushAudit(
        set, 'room_deleted', 'room', id, room.name, room.projectId,
        leftoverIds.length
          ? `Deleted room "${room.name}" and cascaded ${leftoverIds.length} capture(s): ${leftoverIds.join(', ')}`
          : `Deleted room "${room.name}"`,
      );
    }
  },
  assignFloorPlan(roomId, floorPlanId) {
    set(s => ({ rooms: s.rooms.map(r => r.id === roomId ? { ...r, floorPlanId } : r) }));
    mirrorApi('updateRoom', [roomId, { floorPlanId }]);
  },

  // ── Captures ────────────────────────────────────────────────────────────────
  uploadCapture(roomId, fileCount, mediaAssets = []) {
    const id = get().nextId('c');
    const room = get().rooms.find(r => r.id === roomId);
    // Missing room must NOT look like success — attachCaptureToPin treats any
    // non-empty id as "attached" and the file queue deletes local bytes.
    // Returning '' forces a retry (status 0) until hydrate restores the room.
    if (!room) return '';
    // Predefined-pin rooms historically lacked projectId/towerId. Prefer the
    // owning capture pin's hierarchy so Capture History never shows "· · Floor".
    const ownerPin = get().capturePins.find(p => p.roomId === roomId);
    const projectId = room.projectId || ownerPin?.projectId || '';
    const towerId = room.towerId || ownerPin?.towerId || '';
    const floorId = room.floorId || ownerPin?.floorId || '';
    const project = get().projects.find(p => p.id === projectId);
    const tower = get().towers.find(t => t.id === towerId);
    const floor = get().floors.find(f => f.id === floorId);
    if ((projectId && projectId !== room.projectId)
      || (towerId && towerId !== room.towerId)
      || (floorId && floorId !== room.floorId)) {
      set(s => ({
        rooms: s.rooms.map(r => r.id === roomId
          ? {
              ...r,
              projectId: projectId || r.projectId,
              towerId: towerId || r.towerId,
              floorId: floorId || r.floorId,
            }
          : r),
      }));
      mirrorApi('updateRoom', [roomId, {
        ...(projectId ? { projectId } : {}),
        ...(towerId ? { towerId } : {}),
        ...(floorId ? { floorId } : {}),
      }]);
    }
    const flat = get().flats.find(f => f.id === room.flatId);
    const firstAsset = mediaAssets[0];
    const now = new Date();
    const capturedAt = now.toISOString();
    const uploadedAtLabel = now.toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const capture = {
      id, roomId, roomName: room.name,
      flatId: room.flatId, flatNumber: flat?.number ?? 'Flat A', flatType: flat?.type ?? '1 BHK',
      flat_id: room.flatId, flat_number: flat?.number ?? 'Flat A', flat_type: flat?.type ?? '1 BHK',
      projectId, projectName: project?.name ?? '',
      towerId, towerName: tower?.name ?? '',
      floorLabel: floor?.label ?? '',
      status: 'review', reviewStatus: 'uploaded',
      uploadedBy: currentUploaderName(), uploadedAt: uploadedAtLabel, capturedAt, captured_at: capturedAt,
      reviewedBy: null, reviewNotes: null, assignedTo: null,
      fileCount,
      sizeMb: mediaAssets.length ? +(mediaAssets.reduce((sum, asset) => sum + (asset.size || 0), 0) / 1024 / 1024).toFixed(1) : fileCount * 4,
      gradient: project?.gradient ?? GRADIENTS[0],
      mediaAssets,
      media_assets: mediaAssets,
      processingStatus: firstAsset?.processing_status ?? 'uploaded',
      processing_status: firstAsset?.processing_status ?? 'uploaded',
      original_url: firstAsset?.original_url,
      thumbnail_url: firstAsset?.thumbnail_url,
      public_id: firstAsset?.public_id,
      format: firstAsset?.format,
      size: firstAsset?.size,
      originalFileUrl: firstAsset?.original_file_url ?? firstAsset?.original_url,
      processedPanoramaUrl: firstMediaUrl(mediaAssets),
      thumbnailUrl: firstAsset?.thumbnail_url,
      previewUrl: firstAsset?.preview_url ?? firstAsset?.thumbnail_url,
      // Carried so the completion callback can find and update THIS capture
      // instead of creating a second one for the same photo. Also lets the
      // backend reconcile the finished asset onto the right document.
      ...(firstAsset?.stitchJobId ? { stitchJobId: firstAsset.stitchJobId } : {}),
    } as MockCapture & Record<string, unknown>;
    set(s => ({
      // Deduplicate by id so a double-call (camera double-fire, double-tap race) never
      // produces two store entries with the same key, which would cause React key warnings.
      captures: [capture, ...s.captures.filter(c => c.id !== id)],
      towers: s.towers.map(t => t.id === towerId ? { ...t, captures: t.captures + 1 } : t),
      projects: project ? s.projects.map(p => p.id === project.id ? { ...p, captures: p.captures + 1, lastUpdated: 'Just now' } : p) : s.projects,
    }));
    mirrorApi('createCapture', [capture]);
    pushNotif(set, 'capture_uploaded', 'New capture uploaded', `Uploaded ${fileCount} files for ${flat?.number ?? 'Flat A'} · ${room.name}`, `/captures/${id}`);
    pushAudit(set, 'capture_uploaded', 'capture', id, capture.roomName, projectId, `Uploaded ${fileCount} images for ${flat?.number ?? 'Flat A'} · ${capture.roomName}`);
    return id;
  },
  finalizeCaptureMedia(captureId, fileCount, mediaAssets = []) {
    // Swap a pending capture's placeholder media for the finished, stitched asset.
    // Used when a background stitch job completes: the capture record already
    // exists (created when the upload was accepted), so this must UPDATE it —
    // creating a second record is what produced duplicate "2 captures" badges.
    const firstAsset = mediaAssets[0];
    if (!firstAsset) return;
    set(s => ({
      captures: s.captures.map(c => c.id !== captureId ? c : ({
        ...c,
        fileCount,
        mediaAssets,
        media_assets: mediaAssets,
        processingStatus: firstAsset.processing_status ?? 'converted',
        processing_status: firstAsset.processing_status ?? 'converted',
        original_url: firstAsset.original_url,
        thumbnail_url: firstAsset.thumbnail_url,
        public_id: firstAsset.public_id,
        format: firstAsset.format,
        size: firstAsset.size,
        sizeMb: +(((firstAsset.size ?? 0) / 1024 / 1024) || 0).toFixed(1) || c.sizeMb,
        originalFileUrl: firstAsset.original_file_url ?? firstAsset.original_url,
        processedPanoramaUrl: firstMediaUrl(mediaAssets),
        thumbnailUrl: firstAsset.thumbnail_url,
        previewUrl: firstAsset.preview_url ?? firstAsset.thumbnail_url,
      } as MockCapture & Record<string, unknown>)),
    }));
    const updated = get().captures.find(c => c.id === captureId);
    // Re-send the whole capture so the server's copy gains the real panorama too.
    // create_capture is an idempotent upsert keyed on this id, so this converges
    // rather than inserting a duplicate.
    if (updated) mirrorApi('createCapture', [updated as MockCapture]);
  },
  deleteCapture(id) {
    const cap = get().captures.find(c => c.id === id);
    // Pins that referenced this capture in their timeline — unlink it.
    const affectedPins = get().capturePins.filter(p => p.captureIds.includes(id));
    // Pins whose timeline becomes empty once this capture is removed are deleted
    // entirely (and their successors renumbered) below via deleteCapturePin.
    const emptiedPinIds = affectedPins
      .filter(p => p.captureIds.filter(cid => cid !== id).length === 0)
      .map(p => p.id);
    // Floor plans whose walkthrough may need rebuilding (pin timeline or tour.captureId).
    const floorPlansToRefresh = new Set<string>(
      affectedPins.map(p => p.floorPlanId).filter(Boolean),
    );
    for (const t of get().tours) {
      const rec = t as MockTour & { floorPlanId?: string; steps?: TourStep[] };
      if (!rec.floorPlanId) continue;
      if (t.captureId === id || (rec.steps ?? []).some(s => s.captureId === id)) {
        floorPlansToRefresh.add(rec.floorPlanId);
      }
    }
    set(s => ({
      captures: s.captures.filter(c => c.id !== id),
      // Keep floor-plan walkthroughs even when tour.captureId matched the deleted
      // visit — that field is only the first step's capture, not the tour itself.
      // Legacy single-capture tours (no floorPlanId) are still dropped.
      tours: s.tours.filter(t => {
        const fpId = (t as MockTour & { floorPlanId?: string }).floorPlanId;
        if (fpId) return true;
        return t.captureId !== id;
      }),
      capturePins: s.capturePins.map(p =>
        p.captureIds.includes(id) ? { ...p, captureIds: p.captureIds.filter(cid => cid !== id) } : p
      ),
      towers: cap ? s.towers.map(t => t.id === cap.towerId ? { ...t, captures: Math.max(0, t.captures - 1) } : t) : s.towers,
    }));
    // Tombstone the deleted capture so a later API snapshot that omits it does
    // not resurrect it via the hydrate back-fill.
    addTombstones(id);
    mirrorApi('deleteCapture', [id]);
    // Mirror the unlink on each affected pin so the backend timeline stays in sync,
    // but skip pins about to be deleted (deleteCapturePin handles their removal).
    affectedPins.forEach(p => {
      if (emptiedPinIds.includes(p.id)) return;
      const remaining = p.captureIds.filter(cid => cid !== id);
      mirrorApi('updateCapturePin', [p.id, { captureIds: remaining }]);
    });
    if (cap) {
      pushAudit(
        set, 'capture_deleted', 'capture', id, cap.roomName, cap.projectId,
        `Deleted capture ${id} (${cap.roomName})` +
          (affectedPins.length ? ` — unlinked from pin(s) ${affectedPins.map(p => p.id).join(', ')}` : ' — not linked to any pin'),
      );
    }
    // Remove any now-empty pins from the floor plan and resequence the rest to 1..N.
    emptiedPinIds.forEach(pinId => get().deleteCapturePin(pinId));

    // Rebuild (or remove) walkthroughs so captureId/steps stay valid after refresh.
    floorPlansToRefresh.forEach(fpId => {
      const existing = get().tours.find(
        t => (t as MockTour & { floorPlanId?: string }).floorPlanId === fpId,
      );
      if (!existing) return;
      const stillHasCaptures = get().capturePins.some(
        p => p.floorPlanId === fpId && p.captureIds.length > 0,
      );
      if (!stillHasCaptures) {
        get().deleteTour(existing.id);
      } else {
        get().publishFloorPlanTour(fpId, undefined, { silent: true });
      }
    });
  },
  replaceCapture(id, fileCount) {
    const patch = { fileCount, sizeMb: fileCount * 4, status: 'review' as const, reviewStatus: 'uploaded' as const, uploadedAt: 'Just now', reviewNotes: null, processingStatus: 'uploaded', processing_status: 'uploaded' };
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, ...patch } : c) }));
    mirrorApi('updateCaptureReview', [id, patch]);
  },

  // ── Review ──────────────────────────────────────────────────────────────────
  reviewCapture(id, action, notes) {
    const cap = get().captures.find(c => c.id === id);
    set(s => ({
      captures: s.captures.map(c => {
        if (c.id !== id) return c;
        if (action === 'approve') return { ...c, status: 'processed', reviewStatus: 'approved', reviewedBy: 'You', reviewNotes: notes ?? c.reviewNotes, processingStatus: 'reviewed', processing_status: 'reviewed' };
        if (action === 'reject') return { ...c, status: 'rejected', reviewStatus: 'changes_requested', reviewedBy: 'You', reviewNotes: notes ?? 'Rejected' };
        return { ...c, status: 'review', reviewStatus: 'reviewing', reviewNotes: notes ?? 'Changes requested' };
      }),
    }));
    const updated = get().captures.find(c => c.id === id);
    if (updated) mirrorApi('updateCaptureReview', [id, updated]);
    if (cap) {
      if (action === 'approve') {
        pushNotif(set, 'review_approved', 'Capture approved', `${cap.roomName} was approved`, `/captures/${id}`);
        pushAudit(set, 'capture_approved', 'capture', id, cap.roomName, cap.projectId, `Approved capture for ${cap.roomName}`);
      } else if (action === 'reject') {
        pushNotif(set, 'review_rejected', 'Re-upload requested', notes ?? `Changes requested for ${cap.roomName}`, `/captures/${id}`);
        pushAudit(set, 'capture_rejected', 'capture', id, cap.roomName, cap.projectId, notes ?? 'Rejected capture');
      }
    }
  },
  assignReviewer(id, reviewerName) {
    const cap = get().captures.find(c => c.id === id);
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, assignedTo: reviewerName, reviewStatus: c.reviewStatus === 'uploaded' ? 'assigned' : c.reviewStatus } : c) }));
    const updated = get().captures.find(c => c.id === id);
    if (updated) mirrorApi('updateCaptureReview', [id, updated]);
    if (cap) {
      pushNotif(set, 'review_requested', 'Review requested', `${cap.roomName} assigned to ${reviewerName}`, `/captures/${id}`);
      pushAudit(set, 'review_assigned', 'capture', id, cap.roomName, cap.projectId, `Assigned to ${reviewerName}`);
    }
  },

  // ── Publish ───────────────────────────────────────────────────────────────
  publishCapture(id) {
    const patch = { reviewStatus: 'published' as const, status: 'processed' as const, processingStatus: 'published', processing_status: 'published' } as Partial<MockCapture> & Record<string, unknown>;
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, ...patch } : c) }));
    mirrorApi('updateCapturePublish', [id, patch]);
  },
  unpublishCapture(id) {
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, reviewStatus: 'approved' } : c) }));
    mirrorApi('updateCapturePublish', [id, { reviewStatus: 'approved' }]);
  },

  // ── Tours ─────────────────────────────────────────────────────────────────
  generateTour(captureId) {
    const id = get().nextId('tour');
    const cap = get().captures.find(c => c.id === captureId);
    if (!cap) return id;
    const existing = get().tours.find(t => t.captureId === captureId);
    if (existing) return existing.id;
    const capRecord = cap as MockCapture & Record<string, unknown>;
    const mediaAssets = (capRecord.mediaAssets as UploadedFileResponse[] | undefined) ?? [];
    const panoramaUrl = firstMediaUrl(mediaAssets) ?? (capRecord.processedPanoramaUrl as string | undefined) ?? null;
    const tour = {
      id, captureId, roomId: cap.roomId, roomName: cap.roomName,
      flatId: capRecord.flatId, flatNumber: capRecord.flatNumber, flatType: capRecord.flatType,
      flat_id: capRecord.flat_id, flat_number: capRecord.flat_number, flat_type: capRecord.flat_type,
      projectId: cap.projectId, projectName: cap.projectName,
      towerId: cap.towerId, towerName: cap.towerName, floorLabel: cap.floorLabel,
      status: 'processing', captures: cap.fileCount, lastCapture: 'Just now',
      gradient: cap.gradient, viewCount: 0,
      panoramaUrls: panoramaUrl ? [panoramaUrl] : [],
      panorama_urls: panoramaUrl ? [panoramaUrl] : [],
      processedPanoramaUrl: panoramaUrl,
      processed_panorama_url: panoramaUrl,
      thumbnailUrl: (mediaAssets[0]?.thumbnail_url ?? capRecord.thumbnailUrl) as string | undefined,
      thumbnail_url: (mediaAssets[0]?.thumbnail_url ?? capRecord.thumbnailUrl) as string | undefined,
    } as MockTour & Record<string, unknown>;
    set(s => ({ tours: [tour, ...s.tours] }));
    // Do not persist generateTour stubs — only publishFloorPlanTour (engineer
    // pin walkthroughs) becomes a Virtual Tour for every role.
    return id;
  },
  publishTour(id) {
    const tour = get().tours.find(t => t.id === id);
    set(s => ({ tours: s.tours.map(t => t.id === id ? { ...t, status: 'published' } : t) }));
    mirrorApi('updateTour', [id, { status: 'published' }]);
    if (tour) {
      pushNotif(set, 'tour_published', 'Tour published', `Virtual tour for ${tour.roomName} is live`, `/tours/${id}`);
      pushAudit(set, 'tour_published', 'tour', id, tour.roomName, tour.projectId, `Published tour for ${tour.roomName}`);
    }
  },
  updateTour(id, patch) {
    set(s => ({ tours: s.tours.map(t => t.id === id ? { ...t, ...patch } : t) }));
    mirrorApi('updateTour', [id, patch]);
  },
  deleteTour(id) {
    const tour = get().tours.find(t => t.id === id);
    set(s => ({ tours: s.tours.filter(t => t.id !== id) }));
    addTombstones(id);
    mirrorApi('deleteTour', [id]);
    if (tour) {
      pushAudit(set, 'tour_deleted', 'tour', id, tour.roomName, tour.projectId, `Deleted tour for ${tour.roomName}`);
    }
  },

  uploadFloorPlan(payload) {
    const id = get().nextId('fp');
    const mediaAssets = payload.mediaAssets ?? [];
    const firstAsset = mediaAssets[0];
    // Capture superseded plans before creating the new one.
    const supersededPlanIds = get().floorPlans
      .filter(fp => fp.towerId === payload.towerId && fp.floorId === payload.floorId)
      .map(fp => fp.id);
    const superseded = new Set(supersededPlanIds);
    const isReplace = supersededPlanIds.length > 0;
    const plan = {
      ...payload,
      id,
      uploadedAt: 'Just now',
      uploadedBy: payload.uploadedBy?.trim() || currentUploaderName(),
      mediaAssets,
      media_assets: mediaAssets,
      file_url: firstAsset?.original_url,
      fileUrl: firstAsset?.original_url,
      thumbnail_url: firstAsset?.thumbnail_url,
      thumbnailUrl: firstAsset?.thumbnail_url,
      public_id: firstAsset?.public_id,
      format: firstAsset?.format,
      size: firstAsset?.size,
      page_count: firstAsset?.pages ?? 1,
      pageCount: firstAsset?.pages ?? 1,
      dimensions: firstAsset?.width && firstAsset?.height ? { width: firstAsset.width, height: firstAsset.height } : null,
      raw_pdf_url: firstAsset?.raw_pdf_url ?? null,
      rawPdfUrl: firstAsset?.raw_pdf_url ?? null,
      pinsVisible: true,
      pinLayoutStatus: 'draft' as const,
      needsReannotate: isReplace,
    } as MockFloorPlan & Record<string, unknown>;
    // Re-uploading a plan for a floor used to leave the OLD floor-plan record on
    // the backend (only local state dropped it), so a freshly-hydrated device saw
    // duplicate plans — and pins/tours stayed attached to the now-orphaned old id.
    // Capture those superseded ids so we can re-point pins onto the new plan and
    // delete the stale records, keeping exactly one canonical plan per floor.

    set(s => ({
      floorPlans: [...s.floorPlans.filter(fp => !(fp.towerId === payload.towerId && fp.floorId === payload.floorId)), plan],
      floors: s.floors.map(f => f.id === payload.floorId ? { ...f, floorPlanId: id } : f),
      // Move existing pins onto the new plan; strip labels when replacing the drawing
      // so admin must re-annotate (coords may no longer match rooms).
      capturePins: s.capturePins.map(p => {
        if (!superseded.has(p.floorPlanId)) return p;
        if (isReplace && p.captureIds.length === 0) {
          return {
            ...p,
            floorPlanId: id,
            flatName: undefined,
            roomName: undefined,
            label: undefined,
            isPredefined: false,
            source: 'freeplace' as const,
            inheritedFromPinId: undefined,
          };
        }
        return { ...p, floorPlanId: id };
      }),
      tours: s.tours.map(t => {
        const fpId = (t as MockTour & { floorPlanId?: string }).floorPlanId;
        return fpId && superseded.has(fpId) ? ({ ...t, floorPlanId: id } as MockTour) : t;
      }),
    }));
    mirrorApi('createFloorPlan', [plan]);
    // Mirror the pin re-points, then delete the superseded plan records.
    get().capturePins
      .filter(p => p.floorPlanId === id && supersededPlanIds.length > 0)
      .forEach(p => mirrorApi('updateCapturePin', [p.id, { floorPlanId: id }]));
    supersededPlanIds.forEach(oldId => {
      addTombstones(oldId);
      mirrorApi('deleteFloorPlan', [oldId]);
    });
    const project = get().projects.find(p => p.id === payload.projectId);
    pushNotif(set, 'floor_plan_uploaded', 'Floor plan uploaded', `${payload.floorLabel} uploaded for ${project?.name ?? 'project'}`, `/floor-plans/${payload.projectId}/${payload.towerId}/${payload.floorId}`);
    pushAudit(set, 'floor_plan_uploaded', 'floor_plan', id, payload.floorLabel, payload.projectId, `Uploaded floor plan for ${payload.floorLabel}`);
    return id;
  },

  deleteFloorPlan(id) {
    const plan = get().floorPlans.find(fp => fp.id === id);
    if (!plan) return;

    const pinsOnPlan = get().capturePins.filter(p => p.floorPlanId === id);
    // Remove pins first so resequence/API mirrors stay consistent.
    pinsOnPlan.forEach(p => get().deleteCapturePin(p.id));

    addTombstones(id);
    set(s => ({
      floorPlans: s.floorPlans.filter(fp => fp.id !== id),
      floors: s.floors.map(f =>
        f.id === plan.floorId || f.floorPlanId === id
          ? { ...f, floorPlanId: undefined }
          : f
      ),
    }));
    mirrorApi('deleteFloorPlan', [id]);
    pushAudit(
      set,
      'floor_plan_deleted',
      'floor_plan',
      id,
      plan.floorLabel,
      plan.projectId,
      `Deleted floor plan for ${plan.floorLabel}`,
    );
    pushNotif(
      set,
      'floor_plan_deleted',
      'Floor plan deleted',
      `${plan.floorLabel} plan removed`,
      `/floor-plans?project=${plan.projectId}&tower=${plan.towerId}`,
    );
  },

  // ── Capture Pins ────────────────────────────────────────────────────────────
  createCapturePin({ floorPlanId, floorId, towerId, projectId, x, y, createdBy, flatName, roomName, label, isPredefined, source }) {
    const id = get().nextId('pin');
    // Sequence number is scoped to the floor plan and always the next available.
    const existingOnPlan = get().capturePins.filter(p => p.floorPlanId === floorPlanId);
    const sequenceNumber = existingOnPlan.length
      ? Math.max(...existingOnPlan.map(p => p.sequenceNumber)) + 1
      : 1;

    // Inherit nearest labeled predefined point for free-place pins.
    let resolvedFlat = flatName?.trim() || '';
    let resolvedRoom = roomName?.trim() || '';
    let inheritedFromPinId: string | undefined;
    let resolvedSource: WfCapturePin['source'] = source;
    if (!resolvedFlat || !resolvedRoom) {
      const labeled = existingOnPlan.filter(p => p.flatName && p.roomName);
      let best: WfCapturePin | null = null;
      let bestD = Infinity;
      for (const p of labeled) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) {
        resolvedFlat = best.flatName!;
        resolvedRoom = best.roomName!;
        inheritedFromPinId = best.id;
        resolvedSource = 'freeplace';
      }
    } else if (isPredefined) {
      resolvedSource = source ?? 'predefined';
    }

    const displayName = resolvedRoom || `Pin ${sequenceNumber}`;
    const roomId = get().createRoom(defaultFlatId(floorId), displayName, 'custom');

    const pin: WfCapturePin = {
      id, floorPlanId, floorId, towerId, projectId, roomId,
      sequenceNumber, x, y,
      createdBy: createdBy ?? 'You',
      createdAt: 'Just now',
      captureIds: [],
      flatName: resolvedFlat || undefined,
      roomName: resolvedRoom || undefined,
      label: label || resolvedRoom || undefined,
      isPredefined: Boolean(isPredefined && resolvedFlat && resolvedRoom),
      source: resolvedSource,
      inheritedFromPinId,
    };
    set(s => ({ capturePins: [...s.capturePins, pin] }));
    mirrorApi('createCapturePin', [pin]);
    // Mark floor plan ready when predefined labels exist.
    if (pin.isPredefined) {
      set(s => ({
        floorPlans: s.floorPlans.map(fp =>
          fp.id === floorPlanId
            ? { ...fp, pinLayoutStatus: 'ready', needsReannotate: false }
            : fp
        ),
      }));
    }
    pushAudit(set, 'floor_plan_uploaded', 'floor_plan', id, displayName, projectId, `Placed capture pin ${sequenceNumber}`);
    return id;
  },

  updateCapturePinLocal(id, patch) {
    set(s => ({
      capturePins: s.capturePins.map(p => (p.id === id ? { ...p, ...patch } : p)),
    }));
    mirrorApi('updateCapturePin', [id, patch]);
  },

  async copyPinsFromFloor({ targetFloorId, sourceFloorId, targetFloorPlanId, sourceFloorPlanId }) {
    const { workflowApiService } = await import('@/services/workflowApiService');
    // Server copy-from deletes empty target pins. Drop any pending client deletes
    // for those pins so we don't spam DELETE → 404 after the import.
    const pendingIds = get().capturePins
      .filter(p =>
        p.floorId === targetFloorId
        && (p.captureIds?.length ?? 0) === 0
        && (p.isPredefined || (p.flatName && p.roomName)),
      )
      .map(p => p.id);
    if (pendingIds.length) cancelPendingDeletesForEntityIds(...pendingIds);

    const result = await workflowApiService.copyPinsFromFloor(targetFloorId, sourceFloorId, {
      targetFloorPlanId,
      sourceFloorPlanId,
    });
    const pins = (result?.pins ?? []) as WfCapturePin[];
    const copied = result?.copiedCount ?? pins.length;
    if (!copied || !pins.length) {
      throw new Error('No annotations were imported. The source floor may have no labeled points.');
    }

    // Always attach imported pins to the plan the viewer is showing when provided.
    const mergePlanId = targetFloorPlanId || result.targetFloorPlanId
      || get().floors.find(f => f.id === targetFloorId)?.floorPlanId
      || '';

    // Tombstone empty labeled pins we are about to replace so a laggy hydrate
    // cannot resurrect them beside the newly imported copies.
    const dropIds = get().capturePins
      .filter(p => {
        if ((p.captureIds?.length ?? 0) > 0) return false;
        if (mergePlanId && p.floorPlanId === mergePlanId && (p.isPredefined || (p.flatName && p.roomName))) {
          return true;
        }
        return p.floorId === targetFloorId && !!(p.isPredefined || (p.flatName && p.roomName));
      })
      .map(p => p.id);
    if (dropIds.length) addTombstones(...dropIds);

    set(s => {
      const withoutEmptyPredef = s.capturePins.filter(p => {
        // Drop empty labeled/predefined pins on the target plan/floor so import replaces them.
        if ((p.captureIds?.length ?? 0) > 0) return true;
        if (mergePlanId && p.floorPlanId === mergePlanId && (p.isPredefined || (p.flatName && p.roomName))) {
          return false;
        }
        if (p.floorId === targetFloorId && (p.isPredefined || (p.flatName && p.roomName))) {
          return false;
        }
        return true;
      });
      const targetFloor = s.floors.find(f => f.id === targetFloorId);
      const targetTower = targetFloor ? s.towers.find(t => t.id === targetFloor.towerId) : undefined;
      const mapped = pins.map((p, index) => ({
        ...p,
        id: p.id,
        floorPlanId: mergePlanId || p.floorPlanId || result.targetFloorPlanId || '',
        floorId: p.floorId || targetFloorId,
        towerId: p.towerId || targetFloor?.towerId || '',
        projectId: p.projectId || targetTower?.projectId || '',
        captureIds: p.captureIds ?? [],
        sequenceNumber: p.sequenceNumber ?? index + 1,
        flatName: p.flatName,
        roomName: p.roomName,
        label: p.label || p.roomName,
        isPredefined: true as const,
        source: (p.source as WfCapturePin['source']) || 'copied',
        createdBy: p.createdBy ?? 'You',
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : 'Just now',
      }));
      const byId = new Map<string, WfCapturePin>();
      for (const p of withoutEmptyPredef) byId.set(p.id, p);
      for (const p of mapped) {
        const prev = byId.get(p.id);
        if (prev && (prev.captureIds?.length ?? 0) > 0) {
          // Keep the live timeline; refresh layout fields from the import payload.
          byId.set(p.id, { ...p, captureIds: prev.captureIds });
        } else {
          byId.set(p.id, p);
        }
      }
      return {
        capturePins: [...byId.values()],
        floorPlans: s.floorPlans.map(fp =>
          (mergePlanId && fp.id === mergePlanId) || fp.floorId === targetFloorId
            ? {
                ...fp,
                pinLayoutStatus: 'ready' as const,
                needsReannotate: false,
                pinsVisible: true,
                copiedFromFloorPlanId: result.sourceFloorPlanId,
              }
            : fp
        ),
      };
    });
    return copied;
  },

  setFloorPlanPinsVisible(floorPlanId, visible) {
    set(s => ({
      floorPlans: s.floorPlans.map(fp =>
        fp.id === floorPlanId ? { ...fp, pinsVisible: visible } : fp
      ),
    }));
    // Go through the write queue (not fire-and-forget) so this runs AFTER any
    // pending createFloorPlan for the same id — otherwise PATCH races and 422s.
    mirrorApi('setPinsVisibility', [floorPlanId, visible]);
  },
  attachCaptureToPin(pinId, fileCount, mediaAssets = []) {
    const pin = get().capturePins.find(p => p.id === pinId);
    if (!pin) return '';

    // Background stitching means this runs TWICE for one photo: once when the
    // server accepts the bytes (202, panorama not ready) and again when the
    // stitch job finishes with the real asset. Both calls carry the same
    // stitchJobId, so the second must UPDATE the in-flight capture rather than
    // create another one — otherwise a single photo produces two capture records
    // and the pin shows a bogus "2 captures" badge.
    //
    // Only match an *in-flight* placeholder (no panorama URL yet / still
    // processing). A finished capture that shares a stitchJobId — e.g. content-
    // hash dedup when the user intentionally re-captures with the same file —
    // must become a new timeline entry on the pin.
    const incomingJobId = (mediaAssets[0] as { stitchJobId?: string } | undefined)?.stitchJobId;
    const existingId = pin.captureIds.find(id => {
      const c = get().captures.find(x => x.id === id) as (MockCapture & {
        stitchJobId?: string;
        mediaAssets?: UploadedFileResponse[];
        processedPanoramaUrl?: string;
        processingStatus?: string;
      }) | undefined;
      if (!c || !incomingJobId || c.stitchJobId !== incomingJobId) return false;
      // Prefer the stitched panorama — pending 202 assets often have original_url
      // set while processed_panorama_url is still null.
      const panorama =
        c.mediaAssets?.[0]?.processed_panorama_url
        || c.processedPanoramaUrl
        || null;
      const status = (c.processingStatus ?? '').toLowerCase();
      const stillProcessing =
        !panorama
        || status === 'processing'
        || status === 'pending'
        || status === 'queued';
      return stillProcessing;
    });
    if (existingId) {
      get().finalizeCaptureMedia(existingId, fileCount, mediaAssets);
      return existingId;
    }

    // Reuse the existing capture pipeline entirely — upload, review, publish all
    // operate on this capture exactly as before. We only record its id on the pin.
    const captureId = get().uploadCapture(pin.roomId, fileCount, mediaAssets);
    if (!captureId) return '';
    set(s => ({
      capturePins: s.capturePins.map(p =>
        // Deduplicate captureIds — guard against a double-fire attaching the same id twice.
        p.id === pinId && !p.captureIds.includes(captureId)
          ? { ...p, captureIds: [...p.captureIds, captureId] }
          : p
      ),
    }));
    const updated = get().capturePins.find(p => p.id === pinId);
    if (updated) mirrorApi('updateCapturePin', [pinId, { captureIds: updated.captureIds }]);
    return captureId;
  },
  discardStitchFailedCapture(pinId, stitchJobId) {
    const pin = get().capturePins.find(p => p.id === pinId);
    if (!pin || !stitchJobId) return;

    const captureId = pin.captureIds.find(id => {
      const c = get().captures.find(x => x.id === id) as (MockCapture & { stitchJobId?: string }) | undefined;
      return !!c && c.stitchJobId === stitchJobId;
    });
    if (!captureId) return;

    const cap = get().captures.find(c => c.id === captureId);
    const remaining = pin.captureIds.filter(cid => cid !== captureId);
    set(s => ({
      captures: s.captures.filter(c => c.id !== captureId),
      capturePins: s.capturePins.map(p =>
        p.id === pinId ? { ...p, captureIds: p.captureIds.filter(cid => cid !== captureId) } : p
      ),
      towers: cap
        ? s.towers.map(t => t.id === cap.towerId ? { ...t, captures: Math.max(0, t.captures - 1) } : t)
        : s.towers,
    }));
    addTombstones(captureId);
    mirrorApi('deleteCapture', [captureId]);
    mirrorApi('updateCapturePin', [pinId, { captureIds: remaining }]);
  },
  publishFloorPlanTour(floorPlanId, pinIds, opts) {
    // Build ONE sequential walkthrough tour for the whole floor: each pin's latest
    // capture becomes a step, ordered by pin sequence (1 → 2 → 3 …). The viewer
    // steps through these with prev/next arrows. Re-publishing replaces the
    // existing walkthrough for this floor plan rather than duplicating it.
    // When `pinIds` is provided, those pins win (even if floorPlanId drifted after
    // a plan re-upload). Otherwise collect every pin on this plan or its floor.
    const selected = pinIds ? new Set(pinIds) : null;
    const plan = get().floorPlans.find(fp => fp.id === floorPlanId);
    const floorId = plan?.floorId ?? '';
    const pins = (
      selected
        ? get().capturePins.filter(p => selected.has(p.id))
        : get().capturePins.filter(p =>
          p.floorPlanId === floorPlanId || (!!floorId && p.floorId === floorId),
        )
    ).sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const steps: TourStep[] = [];
    for (const pin of pins) {
      // Prefer the newest id that still has a live capture document.
      const latestCaptureId = [...pin.captureIds]
        .reverse()
        .find(id => get().captures.some(c => c.id === id));
      if (!latestCaptureId) continue; // pin still waiting for a capture
      const cap = get().captures.find(c => c.id === latestCaptureId) as (MockCapture & Record<string, unknown>) | undefined;
      if (!cap) continue;
      const mediaAssets = (cap.mediaAssets as UploadedFileResponse[] | undefined) ?? [];
      const panoramaUrl = firstMediaUrl(mediaAssets) ?? (cap.processedPanoramaUrl as string | undefined) ?? null;
      steps.push({
        pinId: pin.id,
        captureId: latestCaptureId,
        sequenceNumber: pin.sequenceNumber,
        label: formatPinLocationLabel(pin, `Stop ${pin.sequenceNumber}`),
        panoramaUrl,
        thumbnailUrl: (mediaAssets[0]?.thumbnail_url ?? (cap.thumbnailUrl as string | undefined)) ?? null,
      });
    }
    if (!steps.length) return [];

    const allFloorPins = get().capturePins.filter(
      p => p.floorPlanId === floorPlanId || (!!floorId && p.floorId === floorId),
    );
    const metaPin = pins[0] ?? allFloorPins[0];
    if (!metaPin) return [];

    const floor = get().floors.find(f => f.id === metaPin.floorId);
    const tower = get().towers.find(t => t.id === metaPin.towerId);
    const project = get().projects.find(p => p.id === metaPin.projectId);
    const first = steps[0];
    const panoramaUrls = steps.map(s => s.panoramaUrl).filter((u): u is string => !!u);

    // One stable tour per floor plan — reuse the existing record if present.
    const existing = get().tours.find(t => (t as MockTour & { floorPlanId?: string }).floorPlanId === floorPlanId);
    const id = existing?.id ?? get().nextId('tour');

    const tour = {
      id,
      floorPlanId,
      captureId: first.captureId,
      roomId: metaPin.roomId,
      roomName: `${floor?.label ?? 'Floor'} Walkthrough`,
      projectId: metaPin.projectId, projectName: project?.name ?? '',
      towerId: metaPin.towerId, towerName: tower?.name ?? '',
      floorLabel: floor?.label ?? '',
      status: 'published',
      captures: steps.length,
      lastCapture: 'Just now',
      gradient: project?.gradient ?? GRADIENTS[0],
      viewCount: existing?.viewCount ?? 0,
      steps,
      panoramaUrls,
      panorama_urls: panoramaUrls,
      processedPanoramaUrl: panoramaUrls[0] ?? null,
      processed_panorama_url: panoramaUrls[0] ?? null,
      thumbnailUrl: first.thumbnailUrl ?? undefined,
      thumbnail_url: first.thumbnailUrl ?? undefined,
    } as MockTour & Record<string, unknown>;

    set(s => ({ tours: [tour, ...s.tours.filter(t => t.id !== id)] }));
    if (existing) mirrorApi('updateTour', [id, tour]);
    else mirrorApi('createTour', [tour]);
    if (!opts?.silent) {
      pushNotif(set, 'tour_published', 'Walkthrough published', `${tour.roomName} · ${steps.length} stops is live`, `/tours/${id}`);
      pushAudit(set, 'tour_published', 'tour', id, tour.roomName, tour.projectId, `Published walkthrough (${steps.length} pins) for ${tour.floorLabel}`);
    }
    return [id];
  },
  deleteCapturePin(id) {
    const pin = get().capturePins.find(p => p.id === id);
    if (!pin) return;
    // Tombstone FIRST so any concurrent file-queue flush refuses to POST for
    // this pin (isTombstoned check). Then cancel leftover create/update writes
    // and drop the pending-upload registry entry synchronously.
    addTombstones(id, ...pin.captureIds);
    cancelWritesForEntityIds(id, pin.roomId);
    removePendingUploadPin(id);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('workflow:capture-pin-deleted', { detail: { pinId: id } }));
    }

    // Server DELETE /pins/{id} already cascades the backing room + resequences
    // the plan. Do NOT mirror updateRoom / updateCapturePin for every sibling
    // — that flooded the API with hundreds of PUTs (and wiped Flat · Room names).
    set(s => {
      const remaining = s.capturePins
        .filter(p => p.id !== id)
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      let seq = 0;
      const resequenced = remaining.map(p => {
        if (p.floorPlanId !== pin.floorPlanId) return p;
        seq += 1;
        return p.sequenceNumber === seq ? p : { ...p, sequenceNumber: seq };
      });
      return {
        capturePins: resequenced,
        rooms: s.rooms.filter(r => r.id !== pin.roomId),
        captures: s.captures.filter(c => c.roomId !== pin.roomId),
        tours: s.tours.filter(t => {
          const cap = s.captures.find(c => c.id === t.captureId);
          return !(cap && cap.roomId === pin.roomId);
        }),
      };
    });
    mirrorApi('deleteCapturePin', [id]);
    pushAudit(
      set, 'capture_pin_deleted', 'capture_pin', id, `Pin ${pin.sequenceNumber}`, pin.projectId ?? null,
      `Deleted pin ${pin.sequenceNumber} (${id}) on floor plan ${pin.floorPlanId}` +
        (pin.captureIds.length ? ` with capture(s) ${pin.captureIds.join(', ')}` : ' (no captures)'),
    );
  },

  pruneEmptyFreeplacePinsOnFloor(floorId) {
    const state = get();
    const onFloor = state.capturePins.filter(p => p.floorId === floorId);
    const hasLabeled = onFloor.some(
      p => p.flatName && p.roomName && p.source !== 'freeplace',
    );
    if (!hasLabeled) return 0;
    const accidents = onFloor.filter(
      p => p.source === 'freeplace' && (p.captureIds?.length ?? 0) === 0,
    );
    if (accidents.length === 0) return 0;

    const removeIds = new Set(accidents.map(p => p.id));
    const removeRoomIds = new Set(accidents.map(p => p.roomId));
    const planIds = new Set(accidents.map(p => p.floorPlanId));

    for (const p of accidents) {
      addTombstones(p.id);
      cancelWritesForEntityIds(p.id, p.roomId);
      removePendingUploadPin(p.id);
      // One DELETE per pin — server cascades room delete + resequence.
      // Do not also DELETE rooms (404 spam) or PUT every remaining pin.
      mirrorApi('deleteCapturePin', [p.id]);
    }

    set(s => {
      let pins = s.capturePins.filter(p => !removeIds.has(p.id));
      for (const planId of planIds) {
        const onPlan = pins
          .filter(p => p.floorPlanId === planId)
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
        const seqById = new Map(onPlan.map((p, i) => [p.id, i + 1]));
        pins = pins.map(p => {
          const next = seqById.get(p.id);
          return next != null && next !== p.sequenceNumber
            ? { ...p, sequenceNumber: next }
            : p;
        });
      }
      return {
        capturePins: pins,
        rooms: s.rooms.filter(r => !removeRoomIds.has(r.id)),
        captures: s.captures.filter(c => !removeRoomIds.has(c.roomId)),
      };
    });
    return accidents.length;
  },

  createDefect(d) {
    const id = get().nextId('d');
    const defect: MockDefect = { ...d, id, createdAt: 'Just now', updatedAt: 'Just now' };
    set(s => ({ defects: [defect, ...s.defects] }));
    mirrorApi('createDefect', [defect]);
    pushNotif(set, 'defect_assigned', 'Defect assigned', `"${d.title}" assigned to ${d.assignedTo}`, '/defects');
    pushAudit(set, 'defect_created', 'defect', id, d.title, d.projectId, `Created defect "${d.title}"`);
    return id;
  },

  updateDefect(id, patch) {
    const defect = get().defects.find(d => d.id === id);
    set(s => ({
      defects: s.defects.map(d => d.id === id ? { ...d, ...patch, updatedAt: 'Just now' } : d),
    }));
    mirrorApi('updateDefect', [id, { ...patch, updatedAt: 'Just now' }]);
    if (defect && patch.status === 'resolved') {
      pushAudit(set, 'defect_resolved', 'defect', id, defect.title, defect.projectId, `Resolved defect "${defect.title}"`);
    }
  },

  markNotificationRead(id) {
    set(s => ({ notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n) }));
    mirrorApi('markNotificationRead', [id]);
  },
  markAllNotificationsRead() {
    set(s => ({ notifications: s.notifications.map(n => ({ ...n, read: true })) }));
    mirrorApi('markAllNotificationsRead', []);
  },
  deleteNotification(id) {
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }));
    mirrorApi('deleteNotification', [id]);
  },
  restoreNotification(n, index) {
    set(s => {
      const list = [...s.notifications];
      list.splice(Math.min(index, list.length), 0, n);
      return { notifications: list };
    });
    mirrorApi('createNotification', [n]);
  },

  addUserToProject(userId, projectId) {
    set(s => ({
      users: s.users.map(u =>
        u.id === userId && !u.projectIds.includes(projectId)
          ? { ...u, projectIds: [...u.projectIds, projectId] }
          : u
      ),
    }));
  },
  removeUserFromProject(userId, projectId) {
    set(s => ({
      users: s.users.map(u =>
        u.id === userId
          ? { ...u, projectIds: u.projectIds.filter(id => id !== projectId) }
          : u
      ),
    }));
  },
    }),
    {
      name: WORKFLOW_STORE_KEY,
      version: STORE_VERSION.workflow,
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (s): WorkflowDataState => ({
        projects: s.projects,
        towers: s.towers,
        floors: s.floors,
        flats: s.flats,
        rooms: s.rooms,
        // Strip the heavy per-capture mediaAssets arrays before persisting —
        // they are the main cause of localStorage quota overflow and are
        // refilled from the API snapshot on load. The denormalized top-level
        // URLs (processedPanoramaUrl/thumbnailUrl/originalFileUrl) are kept, so
        // the viewer's fallback rendering still works offline.
        captures: s.captures.map(c => {
          const { mediaAssets: _ma, media_assets: _ms, ...rest } = c as MockCapture & {
            mediaAssets?: unknown; media_assets?: unknown;
          };
          return rest as MockCapture;
        }),
        tours: s.tours,
        floorPlans: s.floorPlans,
        capturePins: s.capturePins,
        defects: s.defects,
        // Cap unbounded, low-value collections to a recent window so they can't
        // grow without limit and blow the quota.
        notifications: s.notifications.slice(0, 100),
        auditLogs: s.auditLogs.slice(0, 200),
        users: s.users,
        uidCounter: s.uidCounter,
      }),
      migrate: (persisted, version) => {
        const base = !isValidWorkflowData(persisted) || version === 0
          ? ensureFlatHierarchy({ ...buildInitialWorkflowData(), ...(isValidWorkflowData(persisted) ? persisted : {}) })
          : ensureFlatHierarchy(persisted as Partial<WorkflowDataState>);
        // Scrub duplicate captureIds that may have been written by a double-fire
        // bug in a previous session — prevents stale badge counts on the floor plan.
        if (base.capturePins) {
          base.capturePins = base.capturePins.map(p => ({
            ...p,
            captureIds: [...new Set(p.captureIds)],
          }));
        }
        if (base.captures) {
          const seen = new Set<string>();
          base.captures = base.captures.filter(c => {
            if (seen.has(c.id)) return false;
            seen.add(c.id);
            return true;
          });
        }
        // A persisted counter can be older than the records persisted alongside
        // it (a write that never landed, or a version migration that fell back
        // to the seed value of 1). Re-base it here too, so ids minted before the
        // first API hydrate cannot collide either.
        base.uidCounter = Math.max(base.uidCounter ?? 1, highestIdSuffix(base));
        return base;
      },
    },
  ),
);
