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
import { Capacitor } from '@capacitor/core';

const RAW_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;

function resolveBaseUrl(): string {
  // Explicit env always wins — required for cloudflared quick tunnels and for
  // Capacitor builds that must not guess from the WebView origin.
  if (RAW_BASE_URL && RAW_BASE_URL.trim()) {
    return RAW_BASE_URL.trim().replace(/\/+$/, '');
  }

  // Capacitor's Android/iOS WebView always loads from a fixed origin
  // (https://localhost by default) regardless of which network the device is
  // actually on, so the browser-only "LAN hostname" heuristic below is
  // meaningless here — `localhost` would resolve to the device itself, not
  // the dev machine running the backend. Native builds must always be given
  // an explicit VITE_API_BASE_URL (the backend's real/LAN address) at build
  // time; fail loudly rather than silently pointing at the device's own
  // loopback interface.
  if (Capacitor.isNativePlatform()) {
    throw new Error(
      '[config] VITE_API_BASE_URL is not set for this native (Capacitor) build. ' +
        "The WebView's own \"localhost\" is the device itself, not your backend — " +
        'set VITE_API_BASE_URL to the backend\'s LAN IP or real host before building.'
    );
  }

  // When opened via a LAN IP/hostname (not localhost), point the API at the same
  // host on port 8002 so teammates don't hit *their* localhost. Skip Cloudflare
  // quick-tunnel hostnames — those are not the API host:port pair.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (
      host
      && host !== 'localhost'
      && host !== '127.0.0.1'
      && !host.endsWith('.trycloudflare.com')
    ) {
      return `http://${host}:8002`;
    }
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
