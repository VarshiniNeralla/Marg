/// <reference types="vite/client" />
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@store/authStore';
import { API_V1_URL } from '@/config/env';
import { restoreSessionFromCookie } from '@/services/sessionRefresh';

// ── Main client ───────────────────────────────────────────────────────────────

export const apiClient = axios.create({
  baseURL: API_V1_URL,
  withCredentials: true,   // sends the httpOnly refresh-token cookie
  headers: {
    'Content-Type': 'application/json',
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

    const restored = await restoreSessionFromCookie();
    if (!restored) {
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
