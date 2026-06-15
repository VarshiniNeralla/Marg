/// <reference types="vite/client" />
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@store/authStore';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

// ── Main client ───────────────────────────────────────────────────────────────

export const apiClient = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
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

let _isRefreshing = false;
let _waitQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function drainQueue(token: string | null, error?: unknown) {
  _waitQueue.forEach(({ resolve, reject }) =>
    token ? resolve(token) : reject(error)
  );
  _waitQueue = [];
}

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

    if (_isRefreshing) {
      // Queue this request until the in-flight refresh resolves.
      return new Promise<string>((resolve, reject) => {
        _waitQueue.push({ resolve, reject });
      }).then((newToken) => {
        original.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(original);
      });
    }

    original._retry = true;
    _isRefreshing = true;

    try {
      const { data } = await axios.post<{ data: { access_token: string } }>(
        `${BASE_URL}/api/v1/auth/refresh`,
        {},
        { withCredentials: true }
      );
      const newToken = data.data.access_token;
      useAuthStore.getState().setAccessToken(newToken);
      drainQueue(newToken);
      original.headers.Authorization = `Bearer ${newToken}`;
      return apiClient(original);
    } catch (refreshError) {
      drainQueue(null, refreshError);
      useAuthStore.getState().clearAuth();
      window.location.replace('/login');
      return Promise.reject(refreshError);
    } finally {
      _isRefreshing = false;
    }
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
