import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  mockProjects, mockTowers, mockCaptures, mockTours, getFloors, getRooms,
  mockFloorPlans, mockDefects, mockNotifications, mockAuditLogs, mockUsers,
  type MockProject, type MockTower, type MockCapture, type MockTour, type TourStep,
  type MockFloorPlan, type MockDefect, type MockNotification, type MockAuditLog,
  type MockUser, type NotifType, type AuditEventType,
} from '@/data/mockData';
import { workflowApiService } from '@/services/workflowApiService';
import type { UploadedFileResponse } from '@/services/uploadService';
import { STORE_VERSION, WORKFLOW_STORE_KEY } from './persistence';

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
  hydrateFromApi: (data: Partial<WorkflowDataState>) => void;

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

  // ── Capture Pins ──
  createCapturePin: (args: { floorPlanId: string; floorId: string; towerId: string; projectId: string; x: number; y: number; createdBy?: string }) => string;
  attachCaptureToPin: (pinId: string, fileCount: number, mediaAssets?: UploadedFileResponse[]) => string;
  deleteCapturePin: (id: string) => void;
  publishFloorPlanTour: (floorPlanId: string) => string[];

  // ── Captures ──
  uploadCapture: (roomId: string, fileCount: number, mediaAssets?: UploadedFileResponse[]) => string;
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

  return keepPrimaryProjectData({
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
  });
}

function mirrorApi<T>(job: Promise<T>) {
  void job.catch(error => {
    console.error('[workflow-api]', error);
  });
}

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
  mirrorApi(workflowApiService.createNotification(notification));
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
  const auditLog = {
      id, actorId: 'u1', actorName: 'You', eventType, entityType,
      entityId, entityName, projectId, description, createdAt: 'Just now',
    };
  set(s => ({
    auditLogs: [auditLog, ...s.auditLogs],
  }));
  mirrorApi(workflowApiService.createAuditLog(auditLog));
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

      hydrateFromApi(data) {
        const migrated = ensureFlatHierarchy(data);

        // Merge helper: local entries fill gaps the API doesn't have (e.g. a capture
        // that was written locally but whose mirrorApi call got a 401). API wins on
        // same id so backend is always the source of truth for existing records.
        const mergeById = <T extends { id: string }>(api: T[] | undefined, local: T[]): T[] => {
          const map = new Map<string, T>();
          for (const item of local) map.set(item.id, item);
          for (const item of (api ?? [])) map.set(item.id, item);
          return [...map.values()];
        };

        // Use a single consistent source for pins throughout this function:
        // API pins if the API returned them, otherwise keep local state.
        const apiPins = migrated.capturePins;
        const localPins = get().capturePins;
        const basePins = apiPins ?? localPins;
        const cleanPins = basePins.map(p => ({
          ...p,
          captureIds: [...new Set(p.captureIds)],
        }));

        set(s => ({
          ...s,
          ...migrated,
          uidCounter: s.uidCounter,
          projects:      migrated.projects      ?? s.projects,
          towers:        migrated.towers        ?? s.towers,
          floors:        migrated.floors        ?? s.floors,
          flats:         migrated.flats         ?? s.flats,
          rooms:         migrated.rooms         ?? s.rooms,
          tours:         migrated.tours         ?? s.tours,
          floorPlans:    migrated.floorPlans    ?? s.floorPlans,
          defects:       migrated.defects       ?? s.defects,
          notifications: migrated.notifications ?? s.notifications,
          auditLogs:     migrated.auditLogs     ?? s.auditLogs,
          users:         migrated.users         ?? s.users,
          // Captures: merge so locally-created captures that failed to sync
          // (401 before token refresh) are not lost on the next page load.
          captures: mergeById(migrated.captures, s.captures),
          capturePins: cleanPins,
        }));

        // Back-fill: re-sync anything that exists locally but not on the backend.
        const apiCaptureIds = new Set((migrated.captures ?? []).map(c => c.id));
        for (const cap of get().captures) {
          if (!apiCaptureIds.has(cap.id)) {
            mirrorApi(workflowApiService.createCapture(cap as MockCapture));
          }
        }

        // Pin back-fill: use the same `apiPins` source so the check is consistent.
        const apiPinIds = new Set((apiPins ?? []).map(p => p.id));
        for (const pin of cleanPins) {
          if (!apiPinIds.has(pin.id)) {
            mirrorApi(workflowApiService.createCapturePin(pin));
          } else {
            const apiPin = (apiPins ?? []).find(p => p.id === pin.id);
            if (apiPin && pin.captureIds.length !== (apiPin.captureIds?.length ?? 0)) {
              mirrorApi(workflowApiService.updateCapturePin(pin.id, { captureIds: pin.captureIds }));
            }
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
    mirrorApi(workflowApiService.createProject(project));
    pushAudit(set, 'project_created', 'project', id, p.name, id, `Created project "${p.name}"`);
    return id;
  },
  updateProject(id, patch) {
    const proj = get().projects.find(p => p.id === id);
    set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, ...patch, lastUpdated: 'Just now' } : p) }));
    mirrorApi(workflowApiService.updateProject(id, { ...patch, lastUpdated: 'Just now' }));
    if (proj) pushAudit(set, 'project_updated', 'project', id, proj.name, id, `Updated project "${proj.name}"`);
  },
  archiveProject(id) {
    set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, archived: !p.archived, status: p.archived ? 'active' : 'draft' } : p) }));
    const updated = get().projects.find(p => p.id === id);
    if (updated) mirrorApi(workflowApiService.updateProject(id, updated));
  },

  // ── Towers ────────────────────────────────────────────────────────────────
  createTower(projectId, name, floorCount = 0) {
    const id = get().nextId('t');
    set(s => ({
      towers: [...s.towers, { id, projectId, name, floors: floorCount, rooms: 0, captures: 0, progress: 0, description: '', status: 'pending' }],
      projects: s.projects.map(p => p.id === projectId ? { ...p, towers: p.towers + 1, lastUpdated: 'Just now' } : p),
    }));
    const tower = get().towers.find(t => t.id === id);
    if (tower) mirrorApi(workflowApiService.createTower(tower));
    return id;
  },
  updateTower(id, patch) {
    set(s => ({ towers: s.towers.map(t => t.id === id ? { ...t, ...patch } : t) }));
    mirrorApi(workflowApiService.updateTower(id, patch));
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
    mirrorApi(workflowApiService.deleteTower(id));
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
    mirrorApi(workflowApiService.createFloor(floor));
    return floor.id;
  },
  updateFloor(id, patch) {
    set(s => ({ floors: s.floors.map(f => f.id === id ? { ...f, ...patch } : f) }));
    mirrorApi(workflowApiService.updateFloor(id, patch));
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
    mirrorApi(workflowApiService.deleteFloor(id));
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
    mirrorApi(workflowApiService.createFlat(flat));
    get().generateStandardRooms(id);
    pushAudit(set, 'project_updated', 'project', flat.projectId, flat.number, flat.projectId, `Created ${flat.number} (${flat.type})`);
    return id;
  },
  updateFlat(id, patch) {
    set(s => ({ flats: s.flats.map(f => f.id === id ? { ...f, ...patch } : f) }));
    mirrorApi(workflowApiService.updateFlat(id, patch));
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
    mirrorApi(workflowApiService.deleteFlat(id));
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
    newRooms.forEach(room => mirrorApi(workflowApiService.createRoom(room)));
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
    if (!get().flats.some(f => f.id === parentFlat.id)) {
      set(s => ({ flats: [...s.flats, parentFlat] }));
    }
    const room: WfRoom = { id: `${parentFlat.id}-${id}`, flatId: parentFlat.id, floorId: parentFlat.floorId, towerId: parentFlat.towerId, projectId: parentFlat.projectId, name, type };
    const tower = get().towers.find(t => t.id === floor.towerId);
    set(s => ({
      rooms: [...s.rooms, room],
      towers: s.towers.map(t => t.id === floor.towerId ? { ...t, rooms: t.rooms + 1 } : t),
      projects: tower ? s.projects.map(p => p.id === tower.projectId ? { ...p, rooms: p.rooms + 1, totalRooms: p.totalRooms + 1, lastUpdated: 'Just now' } : p) : s.projects,
    }));
    mirrorApi(workflowApiService.createRoom(room));
    return room.id;
  },
  updateRoom(id, patch) {
    set(s => ({ rooms: s.rooms.map(r => r.id === id ? { ...r, ...patch } : r) }));
    mirrorApi(workflowApiService.updateRoom(id, patch));
  },
  deleteRoom(id) {
    const room = get().rooms.find(r => r.id === id);
    set(s => ({
      rooms: s.rooms.filter(r => r.id !== id),
      captures: s.captures.filter(c => c.roomId !== id),
      towers: room ? s.towers.map(t => t.id === room.towerId ? { ...t, rooms: Math.max(0, t.rooms - 1) } : t) : s.towers,
    }));
    mirrorApi(workflowApiService.deleteRoom(id));
  },
  assignFloorPlan(roomId, floorPlanId) {
    set(s => ({ rooms: s.rooms.map(r => r.id === roomId ? { ...r, floorPlanId } : r) }));
    mirrorApi(workflowApiService.updateRoom(roomId, { floorPlanId }));
  },

  // ── Captures ────────────────────────────────────────────────────────────────
  uploadCapture(roomId, fileCount, mediaAssets = []) {
    const id = get().nextId('c');
    const room = get().rooms.find(r => r.id === roomId);
    if (!room) return id;
    const project = get().projects.find(p => p.id === room.projectId);
    const tower = get().towers.find(t => t.id === room.towerId);
    const floor = get().floors.find(f => f.id === room.floorId);
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
      projectId: room.projectId, projectName: project?.name ?? '',
      towerId: room.towerId, towerName: tower?.name ?? '',
      floorLabel: floor?.label ?? '',
      status: 'review', reviewStatus: 'uploaded',
      uploadedBy: 'You', uploadedAt: uploadedAtLabel, capturedAt, captured_at: capturedAt,
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
    } as MockCapture & Record<string, unknown>;
    set(s => ({
      // Deduplicate by id so a double-call (camera double-fire, double-tap race) never
      // produces two store entries with the same key, which would cause React key warnings.
      captures: [capture, ...s.captures.filter(c => c.id !== id)],
      towers: s.towers.map(t => t.id === room.towerId ? { ...t, captures: t.captures + 1 } : t),
      projects: project ? s.projects.map(p => p.id === project.id ? { ...p, captures: p.captures + 1, lastUpdated: 'Just now' } : p) : s.projects,
    }));
    mirrorApi(workflowApiService.createCapture(capture));
    pushNotif(set, 'capture_uploaded', 'New capture uploaded', `Uploaded ${fileCount} files for ${flat?.number ?? 'Flat A'} · ${room.name}`, `/captures/${id}`);
    pushAudit(set, 'capture_uploaded', 'capture', id, capture.roomName, room.projectId, `Uploaded ${fileCount} images for ${flat?.number ?? 'Flat A'} · ${capture.roomName}`);
    return id;
  },
  deleteCapture(id) {
    const cap = get().captures.find(c => c.id === id);
    // Pins that referenced this capture in their timeline — unlink it.
    const affectedPins = get().capturePins.filter(p => p.captureIds.includes(id));
    set(s => ({
      captures: s.captures.filter(c => c.id !== id),
      tours: s.tours.filter(t => t.captureId !== id),
      capturePins: s.capturePins.map(p =>
        p.captureIds.includes(id) ? { ...p, captureIds: p.captureIds.filter(cid => cid !== id) } : p
      ),
      towers: cap ? s.towers.map(t => t.id === cap.towerId ? { ...t, captures: Math.max(0, t.captures - 1) } : t) : s.towers,
    }));
    mirrorApi(workflowApiService.deleteCapture(id));
    // Mirror the unlink on each affected pin so the backend timeline stays in sync.
    affectedPins.forEach(p => {
      const remaining = p.captureIds.filter(cid => cid !== id);
      mirrorApi(workflowApiService.updateCapturePin(p.id, { captureIds: remaining }));
    });
  },
  replaceCapture(id, fileCount) {
    const patch = { fileCount, sizeMb: fileCount * 4, status: 'review' as const, reviewStatus: 'uploaded' as const, uploadedAt: 'Just now', reviewNotes: null, processingStatus: 'uploaded', processing_status: 'uploaded' };
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, ...patch } : c) }));
    mirrorApi(workflowApiService.updateCaptureReview(id, patch));
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
    if (updated) mirrorApi(workflowApiService.updateCaptureReview(id, updated));
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
    if (updated) mirrorApi(workflowApiService.updateCaptureReview(id, updated));
    if (cap) {
      pushNotif(set, 'review_requested', 'Review requested', `${cap.roomName} assigned to ${reviewerName}`, `/captures/${id}`);
      pushAudit(set, 'review_assigned', 'capture', id, cap.roomName, cap.projectId, `Assigned to ${reviewerName}`);
    }
  },

  // ── Publish ───────────────────────────────────────────────────────────────
  publishCapture(id) {
    const patch = { reviewStatus: 'published' as const, status: 'processed' as const, processingStatus: 'published', processing_status: 'published' } as Partial<MockCapture> & Record<string, unknown>;
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, ...patch } : c) }));
    mirrorApi(workflowApiService.updateCapturePublish(id, patch));
  },
  unpublishCapture(id) {
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, reviewStatus: 'approved' } : c) }));
    mirrorApi(workflowApiService.updateCapturePublish(id, { reviewStatus: 'approved' }));
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
    mirrorApi(workflowApiService.createTour(tour));
    return id;
  },
  publishTour(id) {
    const tour = get().tours.find(t => t.id === id);
    set(s => ({ tours: s.tours.map(t => t.id === id ? { ...t, status: 'published' } : t) }));
    mirrorApi(workflowApiService.updateTour(id, { status: 'published' }));
    if (tour) {
      pushNotif(set, 'tour_published', 'Tour published', `Virtual tour for ${tour.roomName} is live`, `/tours/${id}`);
      pushAudit(set, 'tour_published', 'tour', id, tour.roomName, tour.projectId, `Published tour for ${tour.roomName}`);
    }
  },
  updateTour(id, patch) {
    set(s => ({ tours: s.tours.map(t => t.id === id ? { ...t, ...patch } : t) }));
    mirrorApi(workflowApiService.updateTour(id, patch));
  },
  deleteTour(id) {
    const tour = get().tours.find(t => t.id === id);
    set(s => ({ tours: s.tours.filter(t => t.id !== id) }));
    mirrorApi(workflowApiService.deleteTour(id));
    if (tour) {
      pushAudit(set, 'tour_deleted', 'tour', id, tour.roomName, tour.projectId, `Deleted tour for ${tour.roomName}`);
    }
  },

  uploadFloorPlan(payload) {
    const id = get().nextId('fp');
    const mediaAssets = payload.mediaAssets ?? [];
    const firstAsset = mediaAssets[0];
    const plan = {
      ...payload,
      id,
      uploadedAt: 'Just now',
      uploadedBy: payload.uploadedBy ?? 'You',
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
    } as MockFloorPlan & Record<string, unknown>;
    set(s => ({
      floorPlans: [...s.floorPlans.filter(fp => !(fp.towerId === payload.towerId && fp.floorId === payload.floorId)), plan],
      floors: s.floors.map(f => f.id === payload.floorId ? { ...f, floorPlanId: id } : f),
    }));
    mirrorApi(workflowApiService.createFloorPlan(plan));
    const project = get().projects.find(p => p.id === payload.projectId);
    pushNotif(set, 'floor_plan_uploaded', 'Floor plan uploaded', `${payload.floorLabel} uploaded for ${project?.name ?? 'project'}`, `/floor-plans/${payload.projectId}/${payload.towerId}/${payload.floorId}`);
    pushAudit(set, 'floor_plan_uploaded', 'floor_plan', id, payload.floorLabel, payload.projectId, `Uploaded floor plan for ${payload.floorLabel}`);
    return id;
  },

  // ── Capture Pins ────────────────────────────────────────────────────────────
  createCapturePin({ floorPlanId, floorId, towerId, projectId, x, y, createdBy }) {
    const id = get().nextId('pin');
    // Sequence number is scoped to the floor plan and always the next available.
    const existingOnPlan = get().capturePins.filter(p => p.floorPlanId === floorPlanId);
    const sequenceNumber = existingOnPlan.length
      ? Math.max(...existingOnPlan.map(p => p.sequenceNumber)) + 1
      : 1;

    // Each pin owns a backing room so the existing capture → review → tour
    // pipeline works unchanged. The room is an implementation detail — its name
    // ("Pin N") is never surfaced as a separate concept to the engineer.
    const roomId = get().createRoom(defaultFlatId(floorId), `Pin ${sequenceNumber}`, 'custom');

    const pin: WfCapturePin = {
      id, floorPlanId, floorId, towerId, projectId, roomId,
      sequenceNumber, x, y,
      createdBy: createdBy ?? 'You',
      createdAt: 'Just now',
      captureIds: [],
    };
    set(s => ({ capturePins: [...s.capturePins, pin] }));
    mirrorApi(workflowApiService.createCapturePin(pin));
    pushAudit(set, 'floor_plan_uploaded', 'floor_plan', id, `Pin ${sequenceNumber}`, projectId, `Placed capture pin ${sequenceNumber}`);
    return id;
  },
  attachCaptureToPin(pinId, fileCount, mediaAssets = []) {
    const pin = get().capturePins.find(p => p.id === pinId);
    if (!pin) return '';
    // Reuse the existing capture pipeline entirely — upload, review, publish all
    // operate on this capture exactly as before. We only record its id on the pin.
    const captureId = get().uploadCapture(pin.roomId, fileCount, mediaAssets);
    set(s => ({
      capturePins: s.capturePins.map(p =>
        // Deduplicate captureIds — guard against a double-fire attaching the same id twice.
        p.id === pinId && !p.captureIds.includes(captureId)
          ? { ...p, captureIds: [...p.captureIds, captureId] }
          : p
      ),
    }));
    const updated = get().capturePins.find(p => p.id === pinId);
    if (updated) mirrorApi(workflowApiService.updateCapturePin(pinId, { captureIds: updated.captureIds }));
    return captureId;
  },
  publishFloorPlanTour(floorPlanId) {
    // Build ONE sequential walkthrough tour for the whole floor: each pin's latest
    // capture becomes a step, ordered by pin sequence (1 → 2 → 3 …). The viewer
    // steps through these with prev/next arrows. Re-publishing replaces the
    // existing walkthrough for this floor plan rather than duplicating it.
    const pins = get().capturePins
      .filter(p => p.floorPlanId === floorPlanId)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const steps: TourStep[] = [];
    for (const pin of pins) {
      const latestCaptureId = pin.captureIds[pin.captureIds.length - 1];
      if (!latestCaptureId) continue; // pin still waiting for a capture
      const cap = get().captures.find(c => c.id === latestCaptureId) as (MockCapture & Record<string, unknown>) | undefined;
      if (!cap) continue;
      const mediaAssets = (cap.mediaAssets as UploadedFileResponse[] | undefined) ?? [];
      const panoramaUrl = firstMediaUrl(mediaAssets) ?? (cap.processedPanoramaUrl as string | undefined) ?? null;
      steps.push({
        pinId: pin.id,
        captureId: latestCaptureId,
        sequenceNumber: pin.sequenceNumber,
        label: `Pin ${pin.sequenceNumber}`,
        panoramaUrl,
        thumbnailUrl: (mediaAssets[0]?.thumbnail_url ?? (cap.thumbnailUrl as string | undefined)) ?? null,
      });
    }
    if (!steps.length) return [];

    const floor = get().floors.find(f => f.id === pins[0].floorId);
    const tower = get().towers.find(t => t.id === pins[0].towerId);
    const project = get().projects.find(p => p.id === pins[0].projectId);
    const first = steps[0];
    const panoramaUrls = steps.map(s => s.panoramaUrl).filter((u): u is string => !!u);

    // One stable tour per floor plan — reuse the existing record if present.
    const existing = get().tours.find(t => (t as MockTour & { floorPlanId?: string }).floorPlanId === floorPlanId);
    const id = existing?.id ?? get().nextId('tour');

    const tour = {
      id,
      floorPlanId,
      captureId: first.captureId,
      roomId: pins[0].roomId,
      roomName: `${floor?.label ?? 'Floor'} Walkthrough`,
      projectId: pins[0].projectId, projectName: project?.name ?? '',
      towerId: pins[0].towerId, towerName: tower?.name ?? '',
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
    mirrorApi(existing ? workflowApiService.updateTour(id, tour) : workflowApiService.createTour(tour));
    pushNotif(set, 'tour_published', 'Walkthrough published', `${tour.roomName} · ${steps.length} stops is live`, `/tours/${id}`);
    pushAudit(set, 'tour_published', 'tour', id, tour.roomName, tour.projectId, `Published walkthrough (${steps.length} pins) for ${tour.floorLabel}`);
    return [id];
  },
  deleteCapturePin(id) {
    const pin = get().capturePins.find(p => p.id === id);
    if (!pin) return;
    // Remove the pin, its backing room (cascades captures via deleteRoom), then
    // resequence the remaining pins on the same floor plan so numbering stays 1..N.
    get().deleteRoom(pin.roomId);
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
      return { capturePins: resequenced };
    });
    mirrorApi(workflowApiService.deleteCapturePin(id));
    // Mirror any sequence changes for pins on the same plan.
    get().capturePins
      .filter(p => p.floorPlanId === pin.floorPlanId)
      .forEach(p => mirrorApi(workflowApiService.updateCapturePin(p.id, { sequenceNumber: p.sequenceNumber })));
  },

  createDefect(d) {
    const id = get().nextId('d');
    const defect: MockDefect = { ...d, id, createdAt: 'Just now', updatedAt: 'Just now' };
    set(s => ({ defects: [defect, ...s.defects] }));
    mirrorApi(workflowApiService.createDefect(defect));
    pushNotif(set, 'defect_assigned', 'Defect assigned', `"${d.title}" assigned to ${d.assignedTo}`, '/defects');
    pushAudit(set, 'defect_created', 'defect', id, d.title, d.projectId, `Created defect "${d.title}"`);
    return id;
  },

  updateDefect(id, patch) {
    const defect = get().defects.find(d => d.id === id);
    set(s => ({
      defects: s.defects.map(d => d.id === id ? { ...d, ...patch, updatedAt: 'Just now' } : d),
    }));
    mirrorApi(workflowApiService.updateDefect(id, { ...patch, updatedAt: 'Just now' }));
    if (defect && patch.status === 'resolved') {
      pushAudit(set, 'defect_resolved', 'defect', id, defect.title, defect.projectId, `Resolved defect "${defect.title}"`);
    }
  },

  markNotificationRead(id) {
    set(s => ({ notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n) }));
    mirrorApi(workflowApiService.markNotificationRead(id));
  },
  markAllNotificationsRead() {
    set(s => ({ notifications: s.notifications.map(n => ({ ...n, read: true })) }));
    mirrorApi(workflowApiService.markAllNotificationsRead());
  },
  deleteNotification(id) {
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }));
    mirrorApi(workflowApiService.deleteNotification(id));
  },
  restoreNotification(n, index) {
    set(s => {
      const list = [...s.notifications];
      list.splice(Math.min(index, list.length), 0, n);
      return { notifications: list };
    });
    mirrorApi(workflowApiService.createNotification(n));
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
      storage: createJSONStorage(() => localStorage),
      partialize: (s): WorkflowDataState => ({
        projects: s.projects,
        towers: s.towers,
        floors: s.floors,
        flats: s.flats,
        rooms: s.rooms,
        captures: s.captures,
        tours: s.tours,
        floorPlans: s.floorPlans,
        capturePins: s.capturePins,
        defects: s.defects,
        notifications: s.notifications,
        auditLogs: s.auditLogs,
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
        return base;
      },
    },
  ),
);
