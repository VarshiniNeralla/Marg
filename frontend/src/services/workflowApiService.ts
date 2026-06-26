import apiClient from './apiClient';
import type { ApiResponse, PaginatedResponse } from '@/types/dto';
import type { WorkflowDataState } from '@store/workflowStore';
import type {
  MockAuditLog,
  MockCapture,
  MockDefect,
  MockFloorPlan,
  MockNotification,
  MockProject,
  MockTour,
  MockTower,
} from '@/data/mockData';
import type { WfCapturePin, WfFlat, WfFloor, WfRoom } from '@store/workflowStore';

type Snapshot = Omit<WorkflowDataState, 'uidCounter' | 'users'>;

async function getData<T>(request: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const { data } = await request;
  return data.data as T;
}

export const workflowApiService = {
  async snapshot(): Promise<Partial<WorkflowDataState>> {
    return getData<Snapshot>(apiClient.get('/workflow/snapshot'));
  },

  async createProject(project: MockProject): Promise<MockProject> {
    return getData<MockProject>(apiClient.post('/projects', project));
  },

  async updateProject(id: string, patch: Partial<MockProject>): Promise<MockProject> {
    return getData<MockProject>(apiClient.put(`/projects/${id}`, patch));
  },

  async deleteProject(id: string): Promise<void> {
    await apiClient.delete(`/projects/${id}`);
  },

  async listProjects(): Promise<PaginatedResponse<MockProject>> {
    return getData<PaginatedResponse<MockProject>>(apiClient.get('/projects'));
  },

  async createTower(tower: MockTower): Promise<MockTower> {
    return getData<MockTower>(apiClient.post(`/projects/${tower.projectId}/towers`, tower));
  },

  async updateTower(id: string, patch: Partial<MockTower>): Promise<MockTower> {
    return getData<MockTower>(apiClient.put(`/towers/${id}`, patch));
  },

  async deleteTower(id: string): Promise<void> {
    await apiClient.delete(`/towers/${id}`);
  },

  async createFloor(floor: WfFloor): Promise<WfFloor> {
    return getData<WfFloor>(apiClient.post(`/towers/${floor.towerId}/floors`, floor));
  },

  async updateFloor(id: string, patch: Partial<WfFloor>): Promise<WfFloor> {
    return getData<WfFloor>(apiClient.put(`/floors/${id}`, patch));
  },

  async deleteFloor(id: string): Promise<void> {
    await apiClient.delete(`/floors/${id}`);
  },

  async createFlat(flat: WfFlat): Promise<WfFlat> {
    return getData<WfFlat>(apiClient.post(`/floors/${flat.floorId}/flats`, flat));
  },

  async updateFlat(id: string, patch: Partial<WfFlat>): Promise<WfFlat> {
    return getData<WfFlat>(apiClient.put(`/flats/${id}`, patch));
  },

  async deleteFlat(id: string): Promise<void> {
    await apiClient.delete(`/flats/${id}`);
  },

  async createRoom(room: WfRoom): Promise<WfRoom> {
    return getData<WfRoom>(apiClient.post(`/flats/${room.flatId}/rooms`, room));
  },

  async updateRoom(id: string, patch: Partial<WfRoom>): Promise<WfRoom> {
    return getData<WfRoom>(apiClient.put(`/rooms/${id}`, patch));
  },

  async deleteRoom(id: string): Promise<void> {
    await apiClient.delete(`/rooms/${id}`);
  },

  async createCapture(capture: MockCapture): Promise<MockCapture> {
    return getData<MockCapture>(apiClient.post('/captures', capture));
  },

  async updateCaptureReview(id: string, patch: Partial<MockCapture>): Promise<MockCapture> {
    return getData<MockCapture>(apiClient.put(`/captures/${id}/review`, patch));
  },

  async updateCapturePublish(id: string, patch: Partial<MockCapture>): Promise<MockCapture> {
    return getData<MockCapture>(apiClient.put(`/captures/${id}/publish`, patch));
  },

  async deleteCapture(id: string): Promise<void> {
    await apiClient.delete(`/captures/${id}`);
  },

  async createTour(tour: MockTour): Promise<MockTour> {
    return getData<MockTour>(apiClient.post('/tours', tour));
  },

  async updateTour(id: string, patch: Partial<MockTour>): Promise<MockTour> {
    return getData<MockTour>(apiClient.put(`/tours/${id}/status`, patch));
  },

  async deleteTour(id: string): Promise<void> {
    await apiClient.delete(`/tours/${id}`);
  },

  async createFloorPlan(floorPlan: MockFloorPlan): Promise<MockFloorPlan> {
    return getData<MockFloorPlan>(apiClient.post('/floor-plans', floorPlan));
  },

  // ── Capture Pins ──
  async createCapturePin(pin: WfCapturePin): Promise<WfCapturePin> {
    return getData<WfCapturePin>(apiClient.post(`/floor-plans/${pin.floorPlanId}/pins`, pin));
  },

  async updateCapturePin(id: string, patch: Partial<WfCapturePin>): Promise<WfCapturePin> {
    return getData<WfCapturePin>(apiClient.put(`/pins/${id}`, patch));
  },

  async deleteCapturePin(id: string): Promise<void> {
    await apiClient.delete(`/pins/${id}`);
  },

  async createDefect(defect: MockDefect): Promise<MockDefect> {
    return getData<MockDefect>(apiClient.post('/defects', defect));
  },

  async updateDefect(id: string, patch: Partial<MockDefect>): Promise<MockDefect> {
    return getData<MockDefect>(apiClient.put(`/defects/${id}`, patch));
  },

  async markNotificationRead(id: string): Promise<MockNotification> {
    return getData<MockNotification>(apiClient.put(`/notifications/${id}/read`, {}));
  },

  async markAllNotificationsRead(): Promise<void> {
    await apiClient.put('/notifications/read-all', {});
  },

  async deleteNotification(id: string): Promise<void> {
    await apiClient.delete(`/notifications/${id}`);
  },

  async createNotification(notification: MockNotification): Promise<MockNotification> {
    return getData<MockNotification>(apiClient.post('/notifications', notification));
  },

  async createAuditLog(auditLog: MockAuditLog): Promise<MockAuditLog> {
    return getData<MockAuditLog>(apiClient.post('/audit-logs', auditLog));
  },
};
