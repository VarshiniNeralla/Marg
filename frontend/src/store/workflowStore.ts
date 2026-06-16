import { create } from 'zustand';
import {
  mockProjects, mockTowers, mockCaptures, mockTours, getFloors, getRooms,
  type MockProject, type MockTower, type MockCapture, type MockTour,
} from '@/data/mockData';

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

export interface WfFloor {
  id: string;
  towerId: string;
  number: number;
  label: string;
  floorPlanId?: string;
}

export interface WfRoom {
  id: string;
  floorId: string;
  towerId: string;
  projectId: string;
  name: string;
  type: 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'balcony' | 'utility';
  floorPlanId?: string;
}

export type ProjectArchived = MockProject & { archived?: boolean };

function uid(prefix: string): string {
  // No Math.random in some sandboxes; derive from a monotonic counter + len.
  counter += 1;
  return `${prefix}${counter}`;
}
let counter = Date.now() % 100000;

// ── Seed from mockData ──────────────────────────────────────────────────────────
function seedFloors(): WfFloor[] {
  const out: WfFloor[] = [];
  for (const t of mockTowers) {
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
    for (const r of getRooms(f.id, f.towerId, tower.projectId)) {
      out.push({ id: r.id, floorId: f.id, towerId: f.towerId, projectId: tower.projectId, name: r.name, type: r.type });
    }
  }
  return out;
}

interface WorkflowState {
  projects: ProjectArchived[];
  towers: MockTower[];
  floors: WfFloor[];
  rooms: WfRoom[];
  captures: MockCapture[];
  tours: MockTour[];

  // ── Projects ──
  createProject: (p: Partial<MockProject> & { name: string }) => string;
  updateProject: (id: string, patch: Partial<MockProject>) => void;
  archiveProject: (id: string) => void;

  // ── Towers ──
  createTower: (projectId: string, name: string) => string;
  updateTower: (id: string, patch: Partial<MockTower>) => void;
  deleteTower: (id: string) => void;

  // ── Floors ──
  createFloor: (towerId: string, number: number) => string;
  updateFloor: (id: string, patch: Partial<WfFloor>) => void;
  deleteFloor: (id: string) => void;

  // ── Rooms ──
  createRoom: (floorId: string, name: string, type: WfRoom['type']) => string;
  updateRoom: (id: string, patch: Partial<WfRoom>) => void;
  deleteRoom: (id: string) => void;
  assignFloorPlan: (roomId: string, floorPlanId: string) => void;

  // ── Captures ──
  uploadCapture: (roomId: string, fileCount: number) => string;
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
}

const GRADIENTS = [
  'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)',
  'linear-gradient(135deg, #1a3a2a 0%, #0f2318 100%)',
  'linear-gradient(135deg, #2d1b4e 0%, #1a0f2e 100%)',
  'linear-gradient(135deg, #3a1f1a 0%, #221008 100%)',
];

const initialFloors = seedFloors();
const initialRooms = seedRooms(initialFloors);

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  projects: mockProjects.map(p => ({ ...p })),
  towers: mockTowers.map(t => ({ ...t })),
  floors: initialFloors,
  rooms: initialRooms,
  captures: mockCaptures.map(c => ({ ...c })),
  tours: mockTours.map(t => ({ ...t })),

  // ── Projects ──────────────────────────────────────────────────────────────
  createProject(p) {
    const id = uid('p');
    const project: ProjectArchived = {
      id, name: p.name,
      location: p.location ?? `${p.city ?? 'Hyderabad'}, ${p.state ?? 'Telangana'}`,
      city: p.city ?? 'Hyderabad', state: p.state ?? 'Telangana',
      client: p.client ?? 'My Home Constructions', description: p.description ?? '',
      status: p.status ?? 'active', progress: 0,
      towers: 0, floors: 0, rooms: 0, captures: 0, totalRooms: 0,
      startDate: p.startDate ?? '', endDate: p.endDate ?? '',
      gradient: GRADIENTS[get().projects.length % GRADIENTS.length], accent: '#2563eb',
      lastUpdated: 'Just now', thumbnail: null, teamSize: 1,
    };
    set(s => ({ projects: [...s.projects, project] }));
    return id;
  },
  updateProject(id, patch) {
    set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, ...patch, lastUpdated: 'Just now' } : p) }));
  },
  archiveProject(id) {
    set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, archived: !p.archived, status: p.archived ? 'active' : 'draft' } : p) }));
  },

  // ── Towers ────────────────────────────────────────────────────────────────
  createTower(projectId, name) {
    const id = uid('t');
    set(s => ({
      towers: [...s.towers, { id, projectId, name, floors: 0, rooms: 0, captures: 0, progress: 0, description: '', status: 'pending' }],
      projects: s.projects.map(p => p.id === projectId ? { ...p, towers: p.towers + 1, lastUpdated: 'Just now' } : p),
    }));
    return id;
  },
  updateTower(id, patch) {
    set(s => ({ towers: s.towers.map(t => t.id === id ? { ...t, ...patch } : t) }));
  },
  deleteTower(id) {
    const tower = get().towers.find(t => t.id === id);
    set(s => ({
      towers: s.towers.filter(t => t.id !== id),
      floors: s.floors.filter(f => f.towerId !== id),
      rooms: s.rooms.filter(r => r.towerId !== id),
      captures: s.captures.filter(c => c.towerId !== id),
      tours: s.tours.filter(t => t.towerId !== id),
      projects: tower ? s.projects.map(p => p.id === tower.projectId ? { ...p, towers: Math.max(0, p.towers - 1) } : p) : s.projects,
    }));
  },

  // ── Floors ────────────────────────────────────────────────────────────────
  createFloor(towerId, number) {
    const id = uid('f');
    const floor: WfFloor = { id: `${towerId}-f${number}-${id}`, towerId, number, label: `Floor ${number}` };
    const tower = get().towers.find(t => t.id === towerId);
    set(s => ({
      floors: [...s.floors, floor],
      towers: s.towers.map(t => t.id === towerId ? { ...t, floors: t.floors + 1 } : t),
      projects: tower ? s.projects.map(p => p.id === tower.projectId ? { ...p, floors: p.floors + 1, lastUpdated: 'Just now' } : p) : s.projects,
    }));
    return floor.id;
  },
  updateFloor(id, patch) {
    set(s => ({ floors: s.floors.map(f => f.id === id ? { ...f, ...patch } : f) }));
  },
  deleteFloor(id) {
    const floor = get().floors.find(f => f.id === id);
    set(s => ({
      floors: s.floors.filter(f => f.id !== id),
      rooms: s.rooms.filter(r => r.floorId !== id),
      towers: floor ? s.towers.map(t => t.id === floor.towerId ? { ...t, floors: Math.max(0, t.floors - 1) } : t) : s.towers,
    }));
  },

  // ── Rooms ─────────────────────────────────────────────────────────────────
  createRoom(floorId, name, type) {
    const id = uid('r');
    const floor = get().floors.find(f => f.id === floorId);
    if (!floor) return id;
    const room: WfRoom = { id: `${floorId}-${id}`, floorId, towerId: floor.towerId, projectId: get().towers.find(t => t.id === floor.towerId)?.projectId ?? '', name, type };
    const tower = get().towers.find(t => t.id === floor.towerId);
    set(s => ({
      rooms: [...s.rooms, room],
      towers: s.towers.map(t => t.id === floor.towerId ? { ...t, rooms: t.rooms + 1 } : t),
      projects: tower ? s.projects.map(p => p.id === tower.projectId ? { ...p, rooms: p.rooms + 1, totalRooms: p.totalRooms + 1, lastUpdated: 'Just now' } : p) : s.projects,
    }));
    return room.id;
  },
  updateRoom(id, patch) {
    set(s => ({ rooms: s.rooms.map(r => r.id === id ? { ...r, ...patch } : r) }));
  },
  deleteRoom(id) {
    const room = get().rooms.find(r => r.id === id);
    set(s => ({
      rooms: s.rooms.filter(r => r.id !== id),
      captures: s.captures.filter(c => c.roomId !== id),
      towers: room ? s.towers.map(t => t.id === room.towerId ? { ...t, rooms: Math.max(0, t.rooms - 1) } : t) : s.towers,
    }));
  },
  assignFloorPlan(roomId, floorPlanId) {
    set(s => ({ rooms: s.rooms.map(r => r.id === roomId ? { ...r, floorPlanId } : r) }));
  },

  // ── Captures ────────────────────────────────────────────────────────────────
  uploadCapture(roomId, fileCount) {
    const id = uid('c');
    const room = get().rooms.find(r => r.id === roomId);
    if (!room) return id;
    const project = get().projects.find(p => p.id === room.projectId);
    const tower = get().towers.find(t => t.id === room.towerId);
    const floor = get().floors.find(f => f.id === room.floorId);
    const capture: MockCapture = {
      id, roomId, roomName: room.name,
      projectId: room.projectId, projectName: project?.name ?? '',
      towerId: room.towerId, towerName: tower?.name ?? '',
      floorLabel: floor?.label ?? '',
      status: 'review', reviewStatus: 'uploaded',
      uploadedBy: 'You', uploadedAt: 'Just now',
      reviewedBy: null, reviewNotes: null, assignedTo: null,
      fileCount, sizeMb: fileCount * 4,
      gradient: project?.gradient ?? GRADIENTS[0],
    };
    set(s => ({
      captures: [capture, ...s.captures],
      towers: s.towers.map(t => t.id === room.towerId ? { ...t, captures: t.captures + 1 } : t),
      projects: project ? s.projects.map(p => p.id === project.id ? { ...p, captures: p.captures + 1, lastUpdated: 'Just now' } : p) : s.projects,
    }));
    return id;
  },
  deleteCapture(id) {
    const cap = get().captures.find(c => c.id === id);
    set(s => ({
      captures: s.captures.filter(c => c.id !== id),
      tours: s.tours.filter(t => t.captureId !== id),
      towers: cap ? s.towers.map(t => t.id === cap.towerId ? { ...t, captures: Math.max(0, t.captures - 1) } : t) : s.towers,
    }));
  },
  replaceCapture(id, fileCount) {
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, fileCount, sizeMb: fileCount * 4, status: 'review', reviewStatus: 'uploaded', uploadedAt: 'Just now', reviewNotes: null } : c) }));
  },

  // ── Review ──────────────────────────────────────────────────────────────────
  reviewCapture(id, action, notes) {
    set(s => ({
      captures: s.captures.map(c => {
        if (c.id !== id) return c;
        if (action === 'approve') return { ...c, status: 'processed', reviewStatus: 'approved', reviewedBy: 'You', reviewNotes: notes ?? c.reviewNotes };
        if (action === 'reject') return { ...c, status: 'rejected', reviewStatus: 'changes_requested', reviewedBy: 'You', reviewNotes: notes ?? 'Rejected' };
        return { ...c, status: 'review', reviewStatus: 'reviewing', reviewNotes: notes ?? 'Changes requested' };
      }),
    }));
  },
  assignReviewer(id, reviewerName) {
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, assignedTo: reviewerName, reviewStatus: c.reviewStatus === 'uploaded' ? 'assigned' : c.reviewStatus } : c) }));
  },

  // ── Publish ───────────────────────────────────────────────────────────────
  publishCapture(id) {
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, reviewStatus: 'published', status: 'processed' } : c) }));
  },
  unpublishCapture(id) {
    set(s => ({ captures: s.captures.map(c => c.id === id ? { ...c, reviewStatus: 'approved' } : c) }));
  },

  // ── Tours ─────────────────────────────────────────────────────────────────
  generateTour(captureId) {
    const id = uid('tour');
    const cap = get().captures.find(c => c.id === captureId);
    if (!cap) return id;
    const existing = get().tours.find(t => t.captureId === captureId);
    if (existing) return existing.id;
    const tour: MockTour = {
      id, captureId, roomId: cap.roomId, roomName: cap.roomName,
      projectId: cap.projectId, projectName: cap.projectName,
      towerId: cap.towerId, towerName: cap.towerName, floorLabel: cap.floorLabel,
      status: 'processing', captures: cap.fileCount, lastCapture: 'Just now',
      gradient: cap.gradient, viewCount: 0,
    };
    set(s => ({ tours: [tour, ...s.tours] }));
    return id;
  },
  publishTour(id) {
    set(s => ({ tours: s.tours.map(t => t.id === id ? { ...t, status: 'published' } : t) }));
  },
  updateTour(id, patch) {
    set(s => ({ tours: s.tours.map(t => t.id === id ? { ...t, ...patch } : t) }));
  },
}));
