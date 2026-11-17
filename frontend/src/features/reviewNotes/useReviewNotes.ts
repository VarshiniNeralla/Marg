import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reviewNoteService, type NewReviewNote, type ReviewNote } from '@/services/reviewNoteService';

const key = (tourId: string) => ['review-notes', tourId] as const;

/** All review notes on a tour, plus the actions a manager can take. Notes are saved on the server, never only in the browser. */
export function useReviewNotes(tourId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: key(tourId ?? ''),
    queryFn: () => reviewNoteService.list(tourId!),
    enabled: !!tourId,
    staleTime: 15_000,
  });

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: key(tourId ?? '') }), [qc, tourId]);

  const create = useMutation({
    mutationFn: (payload: NewReviewNote) => reviewNoteService.create(tourId!, payload),
    onSuccess: (note) => {
      qc.setQueryData<ReviewNote[]>(key(tourId ?? ''), (old) => [...(old ?? []), note]);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; text?: string; resolved?: boolean }) => reviewNoteService.update(id, payload),
    onSuccess: (note) => {
      qc.setQueryData<ReviewNote[]>(key(tourId ?? ''), (old) => (old ?? []).map(n => (n.id === note.id ? note : n)));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => reviewNoteService.remove(id),
    onSuccess: (_r, id) => {
      qc.setQueryData<ReviewNote[]>(key(tourId ?? ''), (old) => (old ?? []).filter(n => n.id !== id));
    },
  });

  return { notes: query.data ?? [], isLoading: query.isLoading, isError: query.isError, refresh, create, update, remove };
}

/** Message to show for a failed save, from the API envelope when there is one. */
export function noteErrorMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
  return e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Could not save. Please try again.';
}
