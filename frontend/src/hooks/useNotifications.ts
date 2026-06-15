import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '@/services/notificationService';

export const NOTIF_KEYS = {
  all: ['notifications'] as const,
  list: (params?: object) => ['notifications', 'list', params] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
};

export function useNotifications(params?: { skip?: number; limit?: number; read?: boolean }) {
  return useQuery({
    queryKey: NOTIF_KEYS.list(params),
    queryFn: () => notificationService.listNotifications(params),
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: NOTIF_KEYS.unreadCount,
    queryFn: () => notificationService.getUnreadCount(),
    refetchInterval: 30_000, // poll every 30s
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => notificationService.markRead(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOTIF_KEYS.all });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NOTIF_KEYS.all });
    },
  });
}
