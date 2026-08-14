import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { drishtiService } from '@/services/drishtiService';

export const DRISHTI_KEYS = {
  projects: ['drishti', 'projects'] as const,
  suggested: (projectId: string) => ['drishti', 'suggested', projectId] as const,
  conversations: (projectId: string) => ['drishti', 'conversations', projectId] as const,
  conversation: (id: string) => ['drishti', 'conversation', id] as const,
};

export function useDrishtiProjects() {
  return useQuery({
    queryKey: DRISHTI_KEYS.projects,
    queryFn: () => drishtiService.listProjects(),
  });
}

export function useSuggestedQuestions(projectId: string | undefined) {
  return useQuery({
    queryKey: DRISHTI_KEYS.suggested(projectId ?? ''),
    queryFn: () => drishtiService.getSuggestedQuestions(projectId as string),
    enabled: !!projectId,
  });
}

export function useDrishtiConversations(projectId: string | undefined) {
  return useQuery({
    queryKey: DRISHTI_KEYS.conversations(projectId ?? ''),
    queryFn: () => drishtiService.listConversations(projectId as string),
    enabled: !!projectId,
  });
}

export function useDrishtiConversation(conversationId: string | undefined) {
  return useQuery({
    queryKey: DRISHTI_KEYS.conversation(conversationId ?? ''),
    queryFn: () => drishtiService.getConversation(conversationId as string),
    enabled: !!conversationId,
  });
}

export function useAskDrishti(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ question, conversationId }: { question: string; conversationId?: string }) =>
      drishtiService.ask(projectId, question, conversationId),
    onSuccess: (data) => {
      // Refresh sidebar titles/order after every turn.
      qc.invalidateQueries({ queryKey: DRISHTI_KEYS.conversations(projectId) });
      // Keep the open thread cache in sync so a refresh/reselect shows full history.
      qc.invalidateQueries({ queryKey: DRISHTI_KEYS.conversation(data.conversationId) });
    },
  });
}

export function useDeleteDrishtiConversation(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => drishtiService.deleteConversation(conversationId),
    onSuccess: (_data, conversationId) => {
      qc.invalidateQueries({ queryKey: DRISHTI_KEYS.conversations(projectId) });
      qc.removeQueries({ queryKey: DRISHTI_KEYS.conversation(conversationId) });
    },
  });
}
