/// <reference types="vite/client" />
/**
 * Centralized runtime configuration — the SINGLE source of truth for the API
 * base URL and other VITE_* build-time values.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time. If VITE_API_BASE_URL is
 * not provided for a production build, the bundle would otherwise silently ship
 * a `localhost` URL and every API/auth/upload call would fail in production with
 * confusing CORS/network errors. To make that failure obvious instead of silent,
 * we throw during module init in production when the var is missing.
 */

const RAW_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;

function resolveBaseUrl(): string {
  // When opened via a LAN IP/hostname (not localhost), point the API at the same
  // host on port 8002 so teammates don't hit *their* localhost.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:8002`;
    }
  }

  if (RAW_BASE_URL && RAW_BASE_URL.trim()) {
    // Strip any trailing slash so callers can safely append `/api/v1`.
    return RAW_BASE_URL.trim().replace(/\/+$/, '');
  }

  // No base URL configured.
  if (import.meta.env.PROD) {
    // Fail loudly — a prod bundle pointing at localhost is never correct.
    throw new Error(
      '[config] VITE_API_BASE_URL is not set for this production build. ' +
        'Set it (e.g. https://your-api.onrender.com) in the deploy environment ' +
        'before building, or all API calls will fail.'
    );
  }

  // Development fallback (local browser on this machine).
  // eslint-disable-next-line no-console
  console.warn('[config] VITE_API_BASE_URL not set — falling back to http://localhost:8002');
  return 'http://localhost:8002';
}

/** Base origin of the backend, e.g. "https://sitevision-api.onrender.com" (no trailing slash). */
export const API_BASE_URL = resolveBaseUrl();

/** Full API v1 prefix, e.g. "https://sitevision-api.onrender.com/api/v1". */
export const API_V1_URL = `${API_BASE_URL}/api/v1`;
