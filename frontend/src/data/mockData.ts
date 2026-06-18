// Centralized mock data — all screens consume from here

export type ProjectStatus = 'active' | 'review' | 'done' | 'draft';
export type CaptureStatus = 'processed' | 'review' | 'rejected' | 'uploading';
export type TourStatus = 'draft' | 'processing' | 'in_review' | 'published';
export type UserRole = 'super_admin' | 'admin' | 'manager' | 'reviewer' | 'viewer';
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

export const mockProjects: MockProject[] = [
  {
    id: '1', name: 'My Home Udyan', location: 'Kokapet, Hyderabad', city: 'Hyderabad', state: 'Telangana',
    client: 'My Home Constructions',
    description: 'Premium residential towers with 360° virtual tour integration for all units. Targeting luxury segment buyers with immersive pre-handover experience.',
    status: 'active', progress: 68, towers: 3, floors: 42, rooms: 126, captures: 89, totalRooms: 131,
    startDate: '2024-01-15', endDate: '2025-06-30',
    gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)', accent: '#2563eb',
    lastUpdated: '2 hours ago', thumbnail: null, teamSize: 6,
  },
];

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

export const mockTowers: MockTower[] = [
  { id: 't1', projectId: '1', name: 'Tower A', floors: 14, rooms: 42, captures: 38, progress: 90, description: 'North-facing premium tower', status: 'active' },
  { id: 't2', projectId: '1', name: 'Tower B', floors: 14, rooms: 42, captures: 31, progress: 74, description: 'South-facing tower with park view', status: 'active' },
  { id: 't3', projectId: '1', name: 'Tower C', floors: 14, rooms: 42, captures: 20, progress: 48, description: 'West-facing tower — in progress', status: 'active' },
];

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

export function getFloors(towerId: string): MockFloor[] {
  const tower = mockTowers.find(t => t.id === towerId);
  if (!tower) return [];
  return Array.from({ length: tower.floors }, (_, i) => {
    const floorNum = tower.floors - i;
    const mapped = floorNum <= 4 ? 3 : floorNum <= 8 ? 2 : floorNum <= 11 ? 1 : 0;
    const rooms = 3;
    return {
      id: `${towerId}-f${floorNum}`,
      towerId,
      number: floorNum,
      label: `Floor ${floorNum}`,
      rooms,
      mapped: Math.min(mapped, rooms),
      status: mapped >= rooms ? 'complete' : mapped > 0 ? 'partial' : 'pending',
      floorPlanId: floorNum <= 8 ? `fp-${towerId}-f${floorNum}` : undefined,
    };
  });
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

export function getRooms(floorId: string, towerId: string, projectId: string): MockRoom[] {
  const floor = getFloors(towerId).find(f => f.id === floorId);
  if (!floor) return [];
  const types: MockRoom['type'][] = ['living', 'bedroom', 'kitchen', 'bathroom', 'balcony', 'utility'];
  const captureCountsSeed = [12, 9, 7, 5, 8, 6];
  return Array.from({ length: floor.rooms }, (_, i) => {
    const captured = i < floor.mapped;
    return {
      id: `${floorId}-r${i + 1}`,
      floorId,
      towerId,
      projectId,
      name: `Room ${String(floor.number).padStart(2, '0')}0${i + 1}`,
      type: types[i % types.length],
      captureCount: captured ? captureCountsSeed[i % captureCountsSeed.length] : 0,
      status: captured ? 'captured' : 'pending',
      lastCaptured: captured ? '2 days ago' : null,
    };
  });
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
  reviewedBy: string | null;
  reviewNotes: string | null;
  assignedTo: string | null;
  fileCount: number;
  sizeMb: number;
  gradient: string;
}

export const mockCaptures: MockCapture[] = [
  { id: 'c1', roomId: 't1-f14-r1', roomName: 'A-F14-Room 1401', projectId: '1', projectName: 'My Home Udyan', towerId: 't1', towerName: 'Tower A', floorLabel: 'Floor 14', status: 'processed', reviewStatus: 'approved', uploadedBy: 'Ravi Kumar', uploadedAt: '12 min ago', reviewedBy: 'Priya Sharma', reviewNotes: null, assignedTo: 'Priya Sharma', fileCount: 12, sizeMb: 48, gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)' },
  { id: 'c2', roomId: 't1-f14-r2', roomName: 'A-F14-Room 1402', projectId: '1', projectName: 'My Home Udyan', towerId: 't1', towerName: 'Tower A', floorLabel: 'Floor 14', status: 'processed', reviewStatus: 'published', uploadedBy: 'Ravi Kumar', uploadedAt: '1h ago', reviewedBy: 'Priya Sharma', reviewNotes: null, assignedTo: 'Priya Sharma', fileCount: 10, sizeMb: 38, gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)' },
  { id: 'c5', roomId: 't2-f22-r1', roomName: 'B-F22-Room 2207', projectId: '1', projectName: 'My Home Udyan', towerId: 't2', towerName: 'Tower B', floorLabel: 'Floor 22', status: 'rejected', reviewStatus: 'changes_requested', uploadedBy: 'Ravi Kumar', uploadedAt: '2d ago', reviewedBy: 'Arjun Mehta', reviewNotes: 'Insufficient coverage — retake rooms 3 and 4', assignedTo: 'Arjun Mehta', fileCount: 5, sizeMb: 18, gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)' },
  { id: 'c6', roomId: 't2-f18-r1', roomName: 'B-F18-Room 1803', projectId: '1', projectName: 'My Home Udyan', towerId: 't2', towerName: 'Tower B', floorLabel: 'Floor 18', status: 'review', reviewStatus: 'assigned', uploadedBy: 'Kiran Desai', uploadedAt: '5h ago', reviewedBy: null, reviewNotes: null, assignedTo: 'Arjun Mehta', fileCount: 9, sizeMb: 36, gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)' },
  { id: 'c7', roomId: 't1-f11-r1', roomName: 'A-F11-Room 1104', projectId: '1', projectName: 'My Home Udyan', towerId: 't1', towerName: 'Tower A', floorLabel: 'Floor 11', status: 'review', reviewStatus: 'uploaded', uploadedBy: 'Ravi Kumar', uploadedAt: '1d ago', reviewedBy: null, reviewNotes: null, assignedTo: null, fileCount: 8, sizeMb: 32, gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)' },
];

// ── Tours ─────────────────────────────────────────────────────────────────────
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
}

export const mockTours: MockTour[] = [
  { id: 'tour1', captureId: 'c1', roomId: 't1-f14-r1', roomName: 'A-F14-Room 1401', projectId: '1', projectName: 'My Home Udyan', towerId: 't1', towerName: 'Tower A', floorLabel: 'Floor 14', status: 'published', captures: 12, lastCapture: '2 hours ago', gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)', viewCount: 34 },
  { id: 'tour2', captureId: 'c2', roomId: 't1-f14-r2', roomName: 'A-F14-Room 1402', projectId: '1', projectName: 'My Home Udyan', towerId: 't1', towerName: 'Tower A', floorLabel: 'Floor 14', status: 'published', captures: 10, lastCapture: '1 day ago', gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)', viewCount: 27 },
  { id: 'tour5', captureId: 'c6', roomId: 't2-f18-r1', roomName: 'B-F18-Room 1803', projectId: '1', projectName: 'My Home Udyan', towerId: 't2', towerName: 'Tower B', floorLabel: 'Floor 18', status: 'processing', captures: 9, lastCapture: '5 hours ago', gradient: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)', viewCount: 0 },
];

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

export const mockFloorPlans: MockFloorPlan[] = [
  {
    id: 'fp-t1-f14',
    projectId: '1',
    towerId: 't1',
    floorId: 't1-f14',
    floorLabel: 'Floor 14',
    uploadedBy: 'Ravi Kumar',
    uploadedAt: '3 days ago',
    fileType: 'png',
    fileName: 'Tower_A_Floor_14.png',
    fileSizeMb: 2.4,
    rooms: [
      { id: 'rm-1401', name: 'Living Room', number: '1401', type: 'living', x: 8, y: 10, width: 28, height: 32, status: 'published', captureId: 'c1', tourId: 'tour1' },
      { id: 'rm-1402', name: 'Master Bedroom', number: '1402', type: 'bedroom', x: 40, y: 10, width: 25, height: 28, status: 'published', captureId: 'c2', tourId: 'tour2' },
      { id: 'rm-1403', name: 'Kitchen', number: '1403', type: 'kitchen', x: 8, y: 46, width: 22, height: 22, status: 'reviewed' },
      { id: 'rm-1404', name: 'Bedroom 2', number: '1404', type: 'bedroom', x: 35, y: 42, width: 22, height: 26, status: 'in_progress' },
      { id: 'rm-1405', name: 'Bathroom', number: '1405', type: 'bathroom', x: 69, y: 10, width: 14, height: 16, status: 'not_started' },
      { id: 'rm-1406', name: 'Balcony', number: '1406', type: 'balcony', x: 69, y: 30, width: 14, height: 20, status: 'not_started' },
    ],
  },
  {
    id: 'fp-t1-f11',
    projectId: '1',
    towerId: 't1',
    floorId: 't1-f11',
    floorLabel: 'Floor 11',
    uploadedBy: 'Kiran Desai',
    uploadedAt: '1 week ago',
    fileType: 'pdf',
    fileName: 'Tower_A_Floor_11.pdf',
    fileSizeMb: 1.8,
    rooms: [
      { id: 'rm-1101', name: 'Living Room', number: '1101', type: 'living', x: 10, y: 12, width: 26, height: 30, status: 'in_progress', captureId: 'c7' },
      { id: 'rm-1102', name: 'Bedroom 1', number: '1102', type: 'bedroom', x: 40, y: 12, width: 22, height: 26, status: 'not_started' },
      { id: 'rm-1103', name: 'Kitchen', number: '1103', type: 'kitchen', x: 10, y: 46, width: 20, height: 22, status: 'not_started' },
    ],
  },
];

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

export const mockDefects: MockDefect[] = [
  { id: 'd1', title: 'Poor lighting in living room capture', description: 'Capture c1 shows significant shadowing in the north corner. Panorama seam is visible.', severity: 'medium', status: 'in_progress', projectId: '1', projectName: 'My Home Udyan', towerId: 't1', towerName: 'Tower A', floorLabel: 'Floor 14', roomName: 'A-F14-Room 1401', captureId: 'c1', assignedTo: 'Ravi Kumar', createdBy: 'Arjun Mehta', createdAt: '2 days ago', updatedAt: '1 day ago' },
  { id: 'd2', title: 'Missing room in floor plan coverage', description: 'Floor 14 map missing Bathroom 1405. No capture scheduled for this room yet.', severity: 'high', status: 'open', projectId: '1', projectName: 'My Home Udyan', towerId: 't1', towerName: 'Tower A', floorLabel: 'Floor 14', roomName: 'Room 1405', captureId: undefined, assignedTo: 'Kiran Desai', createdBy: 'Priya Sharma', createdAt: '3 days ago', updatedAt: '3 days ago' },
  { id: 'd5', title: 'Critical: Floor plan dimensions mismatch', description: 'Uploaded floor plan for Floor 11 does not match structural drawings. Scale is off by ~8%.', severity: 'critical', status: 'open', projectId: '1', projectName: 'My Home Udyan', towerId: 't1', towerName: 'Tower A', floorLabel: 'Floor 11', roomName: undefined, captureId: undefined, assignedTo: 'Priya Sharma', createdBy: 'Ravi Kumar', createdAt: '4 hours ago', updatedAt: '4 hours ago' },
  { id: 'd6', title: 'Upload stuck at 87% — timeout error', description: 'Capture upload for c7 timed out during processing. File integrity unknown.', severity: 'medium', status: 'in_progress', projectId: '1', projectName: 'My Home Udyan', towerId: 't1', towerName: 'Tower A', floorLabel: 'Floor 11', roomName: 'A-F11-Room 1104', captureId: 'c7', assignedTo: 'Kiran Desai', createdBy: 'Ravi Kumar', createdAt: '1 day ago', updatedAt: '12 hours ago' },
];

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

export const mockNotifications: MockNotification[] = [
  { id: 'n1', type: 'review_requested', title: 'Review requested', body: 'Capture c6 (B-F18-Room 1803) has been assigned to you for review.', link: '/captures/c6', read: false, createdAt: '5 min ago' },
  { id: 'n2', type: 'capture_uploaded', title: 'New capture uploaded', body: 'Ravi Kumar uploaded 9 files for Room 1803 in Tower B.', link: '/captures/c6', read: false, createdAt: '22 min ago' },
  { id: 'n3', type: 'defect_assigned', title: 'Defect assigned to you', body: 'Priya Sharma assigned defect "Floor plan dimensions mismatch" to you.', link: '/defects', read: false, createdAt: '4 hours ago' },
  { id: 'n4', type: 'tour_published', title: 'Tour published', body: 'Virtual tour for A-F14-Room 1402 has been published successfully.', link: '/tours/tour2', read: true, createdAt: '1 day ago' },
  { id: 'n5', type: 'review_approved', title: 'Capture approved', body: 'Your capture for A-F14-Room 1401 was approved by Priya Sharma.', link: '/captures/c1', read: true, createdAt: '2 days ago' },
  { id: 'n6', type: 'review_rejected', title: 'Re-upload requested', body: 'Arjun Mehta requested re-upload for B-F22-Room 2207 — coverage insufficient.', link: '/captures/c5', read: true, createdAt: '2 days ago' },
  { id: 'n7', type: 'floor_plan_uploaded', title: 'Floor plan uploaded', body: 'Kiran Desai uploaded floor plan for Tower A, Floor 11.', link: '/floor-plans/1/t1/t1-f11', read: true, createdAt: '1 week ago' },
];

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

export const mockUsers: MockUser[] = [
  { id: 'u1', name: 'Priya Sharma',   email: 'priya@myhomeconstructions.com',  role: 'admin',    avatar: null, designation: 'Project Lead',        phone: '+91 98765 43210', joinedAt: '2023-06-01', lastActive: '2 min ago',    projectIds: ['1','2','3','4'] },
  { id: 'u2', name: 'Ravi Kumar',     email: 'ravi@myhomeconstructions.com',   role: 'manager',  avatar: null, designation: 'Site Manager',         phone: '+91 98765 43211', joinedAt: '2023-08-15', lastActive: '1h ago',       projectIds: ['1','3'] },
  { id: 'u3', name: 'Anil Prakash',   email: 'anil@myhomeconstructions.com',   role: 'reviewer', avatar: null, designation: 'QA Reviewer',          phone: '+91 98765 43212', joinedAt: '2024-01-10', lastActive: '3h ago',       projectIds: ['3','4'] },
  { id: 'u4', name: 'Sunita Rao',     email: 'sunita@myhomeconstructions.com', role: 'viewer',   avatar: null, designation: 'Client Liaison',       phone: '+91 98765 43213', joinedAt: '2024-02-20', lastActive: 'Yesterday',    projectIds: ['2'] },
  { id: 'u5', name: 'Arjun Mehta',    email: 'arjun@myhomeconstructions.com',  role: 'reviewer', avatar: null, designation: 'Senior Reviewer',      phone: '+91 98765 43214', joinedAt: '2023-11-05', lastActive: '2 days ago',   projectIds: ['1','2','3'] },
  { id: 'u6', name: 'Meena Reddy',    email: 'meena@myhomeconstructions.com',  role: 'viewer',   avatar: null, designation: 'Documentation Exec',   phone: '+91 98765 43215', joinedAt: '2024-03-01', lastActive: '1 week ago',   projectIds: ['4'] },
  { id: 'u7', name: 'Kiran Desai',    email: 'kiran@myhomeconstructions.com',  role: 'manager',  avatar: null, designation: 'Field Coordinator',    phone: '+91 98765 43216', joinedAt: '2024-04-15', lastActive: '30 min ago',   projectIds: ['1'] },
];

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

export const mockAuditLogs: MockAuditLog[] = [
  { id: 'al1',  actorId: 'u5', actorName: 'Arjun Mehta',   eventType: 'capture_approved',     entityType: 'capture',    entityId: 'c1',    entityName: 'A-F14-Room 1401',      projectId: '1', description: 'Approved capture c1 — all 12 images pass QC',                      createdAt: '2 hours ago' },
  { id: 'al2',  actorId: 'u1', actorName: 'Priya Sharma',  eventType: 'tour_published',        entityType: 'tour',       entityId: 'tour2', entityName: 'A-F14-Room 1402',      projectId: '1', description: 'Published virtual tour for Room 1402, Tower A, Floor 14',         createdAt: '1 day ago' },
  { id: 'al3',  actorId: 'u2', actorName: 'Ravi Kumar',    eventType: 'capture_uploaded',      entityType: 'capture',    entityId: 'c7',    entityName: 'A-F11-Room 1104',      projectId: '1', description: 'Uploaded 8 panoramic images (32 MB) for Room 1104, Floor 11',     createdAt: '1 day ago' },
  { id: 'al4',  actorId: 'u5', actorName: 'Arjun Mehta',   eventType: 'capture_rejected',      entityType: 'capture',    entityId: 'c5',    entityName: 'B-F22-Room 2207',      projectId: '1', description: 'Requested re-upload — insufficient coverage in rooms 3 and 4',     createdAt: '2 days ago' },
  { id: 'al5',  actorId: 'u7', actorName: 'Kiran Desai',   eventType: 'floor_plan_uploaded',   entityType: 'floor_plan', entityId: 'fp-t1-f11', entityName: 'Tower A — Floor 11', projectId: '1', description: 'Uploaded floor plan (PDF, 1.8 MB) for Tower A, Floor 11',       createdAt: '1 week ago' },
  { id: 'al6',  actorId: 'u1', actorName: 'Priya Sharma',  eventType: 'review_assigned',       entityType: 'capture',    entityId: 'c6',    entityName: 'B-F18-Room 1803',      projectId: '1', description: 'Assigned capture c6 to Arjun Mehta for review',                   createdAt: '5 hours ago' },
  { id: 'al8',  actorId: 'u1', actorName: 'Priya Sharma',  eventType: 'defect_created',        entityType: 'defect',     entityId: 'd5',    entityName: 'Floor plan dimensions mismatch', projectId: '1', description: 'Logged critical defect — Floor 11 floor plan scale is off by ~8%', createdAt: '4 hours ago' },
  { id: 'al11', actorId: 'u1', actorName: 'Priya Sharma',  eventType: 'project_updated',       entityType: 'project',    entityId: '1',     entityName: 'My Home Udyan',        projectId: '1', description: 'Updated project progress to 68%',                                 createdAt: '2 hours ago' },
];
