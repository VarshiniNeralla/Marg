import apiClient from './apiClient';
import type {
  ApiResponse,
  PaginatedResponse,
  NotificationResponse,
} from '@/types/dto';

export const notificationService = {
  async listNotifications(params: { skip?: number; limit?: number; read?: boolean } = {}): Promise<PaginatedResponse<NotificationResponse>> {
    const { data } = await apiClient.get<ApiResponse<PaginatedResponse<NotificationResponse>>>('/notifications', { params });
    return data.data!;
  },

  async markRead(notificationId: string): Promise<NotificationResponse> {
    const { data } = await apiClient.put<ApiResponse<NotificationResponse>>(`/notifications/${notificationId}/read`, {});
    return data.data!;
  },

  async markAllRead(): Promise<void> {
    await apiClient.put('/notifications/read-all', {});
  },

  async getUnreadCount(): Promise<number> {
    const { data } = await apiClient.get<ApiResponse<{ count: number }>>('/notifications/unread-count');
    return data.data!.count;
  },
};
