import apiClient from './apiClient';
import type {
  ApiResponse,
  FloorPlanResponse,
  RoomMarkerDTO,
} from '@/types/dto';

export const floorPlanService = {
  async getFloorPlan(floorPlanId: string): Promise<FloorPlanResponse> {
    const { data } = await apiClient.get<ApiResponse<FloorPlanResponse>>(`/floor-plans/${floorPlanId}`);
    return data.data!;
  },

  async getFloorPlanByFloor(towerId: string, floorId: string): Promise<FloorPlanResponse | null> {
    try {
      const { data } = await apiClient.get<ApiResponse<FloorPlanResponse>>(`/floor-plans/by-floor/${towerId}/${floorId}`);
      return data.data ?? null;
    } catch {
      return null;
    }
  },

  async createFloorPlan(payload: {
    project_id: string;
    tower_id: string;
    floor_id: string;
    floor_label: string;
    file_name: string;
    file_type: 'pdf' | 'png' | 'jpg';
    file_size_mb: number;
    cloudinary_public_id?: string;
    secure_url?: string;
  }): Promise<FloorPlanResponse> {
    const { data } = await apiClient.post<ApiResponse<FloorPlanResponse>>('/floor-plans', payload);
    return data.data!;
  },

  async updateRoomMarkers(floorPlanId: string, rooms: RoomMarkerDTO[]): Promise<FloorPlanResponse> {
    const { data } = await apiClient.put<ApiResponse<FloorPlanResponse>>(`/floor-plans/${floorPlanId}/rooms`, { rooms });
    return data.data!;
  },
};
