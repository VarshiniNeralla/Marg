/**
 * Single entry point for restoring an access token from the httpOnly refresh
 * cookie. Deduplicates concurrent callers (React Strict Mode double-mount,
 * StoreHydrationGate + apiClient interceptor) so /auth/refresh is only hit once.
 */
import axios from 'axios';
import { useAuthStore } from '@store/authStore';
import { API_BASE_URL } from '@/config/env';

let inFlight: Promise<RestoreOutcome> | null = null;

function isNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return !error.response || error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED';
}

/**
 * Result of a restore attempt. 'restored' — new token in hand, proceed.
 * 'no-session' — no persisted live session to restore (guest) or the server
 * genuinely rejected the cookie (expired/revoked) — the app SHOULD sign the
 * user out here. 'offline' — the refresh call never reached any server at
 * all (no network); the persisted session may still be perfectly valid, it
 * simply couldn't be confirmed right now. This case must NEVER be treated
 * the same as 'no-session': a field engineer reopening the app in a dead
 * zone was being logged out and redirected to a login screen they also
 * cannot reach offline — a complete dead end, and the direct cause of
 * offline-captured pins appearing to "vanish" (the UI has nothing to show
 * once isAuthenticated flips to false).
 */
export type RestoreOutcome = 'restored' | 'no-session' | 'offline';

/**
 * Attempt to exchange the refresh cookie for a new access token.
 */
export function restoreSessionFromCookie(): Promise<RestoreOutcome> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<RestoreOutcome> => {
    const { user, sessionKind, setAccessToken } = useAuthStore.getState();

    // Guests: no persisted live session — skip the network call entirely so the
    // browser console is not spammed with expected 401s on every page load.
    if (!user || sessionKind !== 'live') return 'no-session';

    try {
      const { data } = await axios.post<{ data: { access_token: string } }>(
        `${API_BASE_URL}/api/v1/auth/refresh`,
        {},
        {
          withCredentials: true,
          // See apiClient.ts — bypasses ngrok's free-tier browser-warning
          // interstitial when API_BASE_URL is a dev tunnel; no-op otherwise.
          headers: { 'ngrok-skip-browser-warning': 'true' },
        },
      );
      setAccessToken(data.data.access_token);
      return 'restored';
    } catch (error) {
      // Backend unreachable (offline, DNS failure, backend down) — keep the
      // persisted session; the SAME cookie will very likely still be valid
      // the next time there's connectivity. Do NOT clearAuth() here.
      if (isNetworkError(error)) return 'offline';
      // The server was reached and explicitly rejected the cookie (expired,
      // revoked, wrong signature) — this is a real, final "you are logged
      // out"; the caller clears auth for this case only.
      return 'no-session';
    }
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
