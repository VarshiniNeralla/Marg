import apiClient from './apiClient';
import type { ApiResponse } from '@/types/dto';
import type {
  DrishtiProjectListItem,
  DrishtiConversationSummary,
  DrishtiConversationDetail,
  AskDrishtiResponse,
} from '@/types/drishti';

async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const { data } = await promise;
  return data.data as T;
}

export const drishtiService = {
  listProjects(): Promise<DrishtiProjectListItem[]> {
    return unwrap(apiClient.get('/drishti/projects'));
  },

  ask(projectId: string, question: string, conversationId?: string): Promise<AskDrishtiResponse> {
    // Two LLM round trips happen server-side (classify, then answer) — a
    // longer budget than the shared apiClient default, but far shorter than
    // the vision-analysis endpoint's 900s since these are text-only calls.
    return unwrap(
      apiClient.post(
        `/drishti/projects/${projectId}/ask`,
        { question, conversationId },
        { timeout: 120_000 },
      ),
    );
  },

  getSuggestedQuestions(projectId: string): Promise<{ questions: string[] }> {
    return unwrap(apiClient.get(`/drishti/projects/${projectId}/suggested-questions`));
  },

  listConversations(projectId: string): Promise<DrishtiConversationSummary[]> {
    return unwrap(apiClient.get(`/drishti/projects/${projectId}/conversations`));
  },

  getConversation(conversationId: string): Promise<DrishtiConversationDetail> {
    return unwrap(apiClient.get(`/drishti/conversations/${conversationId}`));
  },

  deleteConversation(conversationId: string): Promise<{ deleted: boolean }> {
    return unwrap(apiClient.delete(`/drishti/conversations/${conversationId}`));
  },
};
