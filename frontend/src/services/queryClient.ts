import { QueryClient } from '@tanstack/react-query';

/**
 * The app-wide React Query cache. It lives in its own module so the sign-in/sign-out code can empty it:
 * cached answers (project lists, the organization record, Drishti data) belong to ONE signed-in user, and must
 * never be shown to the next person who signs in on the same browser or tablet, possibly from the other company.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min
      retry: 1,
    },
  },
});
