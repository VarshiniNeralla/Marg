import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userService } from '@/services/userService';
import { useAuthStore } from '@store/authStore';
import type { UpdateUserRequest } from '@/types/dto';

export const USER_KEYS = {
  me: ['user', 'me'] as const,
  detail: (id: string) => ['user', 'detail', id] as const,
  list: (params?: object) => ['users', 'list', params] as const,
};

export function useCurrentUser() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: USER_KEYS.me,
    queryFn: () => userService.getMe(),
    enabled: isAuthenticated,
  });
}

export function useUpdateCurrentUser() {
  const qc = useQueryClient();
  const updateAuthUser = useAuthStore((s) => s.updateUser);

  return useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: UpdateUserRequest }) =>
      userService.updateUser(userId, payload),
    onSuccess: (updated) => {
      qc.setQueryData(USER_KEYS.me, (old: unknown) =>
        old ? { ...(old as object), ...updated } : updated
      );
      // Keep auth store in sync
      if (updated.name) updateAuthUser({ name: updated.name });
      if (updated.avatar_url !== undefined) updateAuthUser({ avatar_url: updated.avatar_url });
    },
  });
}

export function useUsers(params?: { skip?: number; limit?: number; role?: string; is_active?: boolean }) {
  return useQuery({
    queryKey: USER_KEYS.list(params),
    queryFn: () => userService.listUsers(params),
  });
}
