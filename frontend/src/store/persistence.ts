// Central persistence keys and reset utilities for Phase 10.

export const AUTH_STORE_KEY = 'sitesurelabs-auth';
export const WORKFLOW_STORE_KEY = 'sitesurelabs-workflow';
export const SETTINGS_STORE_KEY = 'sitesurelabs-settings';
export const USER_STORE_KEY = 'sitesurelabs-user';

/** Legacy keys migrated on first load — cleared on reset. */
export const LEGACY_KEYS = [
  'auth',
  'sitesurelabs_settings',
  'sitesurelabs_profile',
  'sitesurelabs_recent_searches',
  'sitesurelabs_onboarded',
] as const;

export const STORE_VERSION = {
  auth: 1,
  workflow: 2,
  settings: 1,
  user: 1,
} as const;

/** Safely parse persisted JSON; returns null on corruption. */
export function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Remove every persisted key (Zustand + legacy). */
export function clearAllPersistedStorage(): void {
  localStorage.removeItem(AUTH_STORE_KEY);
  localStorage.removeItem(WORKFLOW_STORE_KEY);
  localStorage.removeItem(SETTINGS_STORE_KEY);
  localStorage.removeItem(USER_STORE_KEY);
  for (const key of LEGACY_KEYS) {
    localStorage.removeItem(key);
  }
}
