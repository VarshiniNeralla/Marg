import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { organizationService } from '@/services/organizationService';
import type { UpdateOrganizationRequest } from '@/types/dto';

export const ORG_KEYS = {
  me: ['organization', 'me'] as const,
};

export function useMyOrg() {
  return useQuery({
    queryKey: ORG_KEYS.me,
    queryFn: () => organizationService.getMyOrg(),
  });
}

export function useUpdateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateOrganizationRequest) => organizationService.updateMyOrg(payload),
    onSuccess: (updated) => {
      qc.setQueryData(ORG_KEYS.me, (old: unknown) =>
        old ? { ...(old as object), ...updated } : updated
      );
    },
  });
}
