/**
 * Single entry point for restoring an access token from the httpOnly refresh
 * cookie. Deduplicates concurrent callers (React Strict Mode double-mount,
 * StoreHydrationGate + apiClient interceptor) so /auth/refresh is only hit once.
 */
import axios from 'axios';
import { useAuthStore } from '@store/authStore';
import { API_BASE_URL } from '@/config/env';

let inFlight: Promise<boolean> | null = null;

function isNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return !error.response || error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED';
}

/**
 * Attempt to exchange the refresh cookie for a new access token.
 * Returns true when the session was restored, false when there is no valid
 * cookie (expected for guests / expired sessions — not an application error).
 */
export function restoreSessionFromCookie(): Promise<boolean> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { user, sessionKind, setAccessToken, clearAuth } = useAuthStore.getState();

    // Guests: no persisted live session — skip the network call entirely so the
    // browser console is not spammed with expected 401s on every page load.
    if (!user || sessionKind !== 'live') return false;

    try {
      const { data } = await axios.post<{ data: { access_token: string } }>(
        `${API_BASE_URL}/api/v1/auth/refresh`,
        {},
        { withCredentials: true },
      );
      setAccessToken(data.data.access_token);
      return true;
    } catch (error) {
      // Backend down / wrong port — keep the persisted session so a retry after
      // starting uvicorn does not force another login.
      if (isNetworkError(error)) return false;
      clearAuth();
      return false;
    }
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
