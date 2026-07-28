/// <reference types="vite/client" />
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@store/authStore';
import { API_V1_URL } from '@/config/env';
import { restoreSessionFromCookie } from '@/services/sessionRefresh';

// ── Main client ───────────────────────────────────────────────────────────────

export const apiClient = axios.create({
  baseURL: API_V1_URL,
  withCredentials: true,   // sends the httpOnly refresh-token cookie
  // A raw Insta360 capture upload (~12-15MB multipart body) over a slow
  // mobile connection or a free trycloudflare.com quick tunnel can stall
  // indefinitely with NO axios default timeout — the request neither
  // succeeds nor fails, it just hangs, so fileUploadQueue.ts's entry sits at
  // 'uploading' forever with no error to react/retry on (confirmed: backend
  // logs show the CORS preflight OPTIONS succeeding but the actual POST body
  // never arriving at all). A generous but finite timeout turns that silent
  // hang into a real, retryable failure (axios reports it as `ECONNABORTED`,
  // which normaliseError below maps to status 0 — the same "unreachable"
  // class fileUploadQueue.ts already retries indefinitely without burning
  // MAX_ATTEMPTS).
  timeout: 180_000,
  headers: {
    'Content-Type': 'application/json',
    // Only relevant when API_V1_URL points at a free-tier ngrok tunnel (mobile
    // device testing without a deployed backend): ngrok's free plan serves an
    // HTML "you're about to visit an ngrok site" interstitial to any request
    // it doesn't recognize as an ordinary browser navigation — including XHR/
    // fetch, so every API call came back as that HTML page instead of JSON,
    // which the browser then reported as a misleading generic CORS error
    // (the HTML response has no CORS headers). Harmless no-op against a real
    // deployed backend (the header is simply ignored).
    'ngrok-skip-browser-warning': 'true',
  },
});

// ── Request interceptor — attach access token ─────────────────────────────────

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor — refresh token on 401 ───────────────────────────────

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Only attempt refresh once per request and only on 401.
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(normaliseError(error));
    }

    // Don't refresh on the auth endpoints themselves.
    const url = original.url ?? '';
    if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
      return Promise.reject(normaliseError(error));
    }

    original._retry = true;

    const outcome = await restoreSessionFromCookie();

    if (outcome === 'offline') {
      // Backend unreachable — the persisted session is still presumed valid,
      // it just couldn't be confirmed right now. Signing the user out here
      // (as this code used to) is a dead end for a field app: they'd be sent
      // to a login screen they also cannot reach without connectivity, and
      // every offline-queued capture tied to that session becomes invisible.
      // Reject this ONE request; the token stays as-is and the same request
      // (or the durable write/file queues) can retry once online.
      return Promise.reject(normaliseError(error));
    }

    if (outcome === 'no-session') {
      // The server was actually reached and confirmed there is no valid
      // session (expired/revoked cookie, or no persisted session at all) —
      // this is the one case that legitimately means "log out".
      useAuthStore.getState().clearAuth();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.replace('/login');
      }
      return Promise.reject(normaliseError(error));
    }

    const newToken = useAuthStore.getState().accessToken;
    if (!newToken) {
      return Promise.reject(normaliseError(error));
    }

    original.headers.Authorization = `Bearer ${newToken}`;
    return apiClient(original);
  }
);

// ── Error normaliser ──────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  message: string;
  detail?: unknown;
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'message' in error
  );
}

export function normaliseError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    const body = error.response?.data as {
      detail?: string | { msg?: string }[];
      message?: string;
    } | undefined;

    let message = 'Something went wrong. Please try again.';
    if (body?.message) {
      message = body.message;
    } else if (typeof body?.detail === 'string') {
      message = body.detail;
    } else if (Array.isArray(body?.detail) && body.detail[0]?.msg) {
      message = body.detail[0].msg;
    } else if (status === 401) {
      message = 'Your session has expired. Please log in again.';
    } else if (status === 403) {
      message = 'You do not have permission to perform this action.';
    } else if (status === 429) {
      message = 'Too many requests. Please slow down.';
    } else if (status >= 500) {
      message = 'A server error occurred. Please try again later.';
    }

    return { status, message, detail: body?.detail };
  }
  return { status: 0, message: 'Network error. Check your connection.' };
}

export default apiClient;
