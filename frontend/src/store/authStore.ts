import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AUTH_STORE_KEY, STORE_VERSION, safeParseJson } from './persistence';

// Three primary application roles.
// 'super_admin' kept for backward compat with existing backend tokens.
export type AppRole = 'admin' | 'manager' | 'field_engineer' | 'super_admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  org_id: string;
  org_name: string;
  org_slug: string;
  avatar_url?: string | null;
  // Projects the user is explicitly assigned to (used by manager & field_engineer)
  assignedProjectIds?: string[];
}

export type SessionKind = 'live' | 'mock';

interface AuthState {
  // Access token lives in memory only — never persisted to localStorage.
  accessToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** Whether the session was established via the real backend (refresh cookie) or offline mock login. */
  sessionKind: SessionKind | null;

  setAuth: (token: string, user: AuthUser, sessionKind?: SessionKind) => void;
  setAccessToken: (token: string) => void;
  updateUser: (partial: Partial<AuthUser>) => void;
  clearAuth: () => void;
}

type PersistedAuth = Pick<AuthState, 'user' | 'sessionKind'>;

function migrateLegacyAuth(persisted: PersistedAuth | null): PersistedAuth | null {
  if (persisted?.user) {
    // Migrate old 'user' system role → 'field_engineer'
    const u = persisted.user as AuthUser & { role: string };
    if ((u.role as string) === 'user') u.role = 'field_engineer';
    return persisted;
  }
  const legacy = safeParseJson<{ state?: PersistedAuth }>(localStorage.getItem('auth'));
  if (legacy?.state?.user) return legacy.state;
  return persisted;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      sessionKind: null,

      setAuth(token, user, sessionKind = 'live') {
        set({ accessToken: token, user, isAuthenticated: true, sessionKind });
      },

      setAccessToken(token) {
        set({ accessToken: token, isAuthenticated: true });
      },

      updateUser(partial) {
        set((s) => ({ user: s.user ? { ...s.user, ...partial } : null }));
      },

      clearAuth() {
        set({ accessToken: null, user: null, isAuthenticated: false, sessionKind: null });
      },
    }),
    {
      name: AUTH_STORE_KEY,
      version: STORE_VERSION.auth,
      storage: createJSONStorage(() => localStorage),
      // Never persist isAuthenticated — it must only become true after a fresh
      // login or a successful refresh-cookie exchange. Persisting the flag
      // without a valid cookie caused spurious /auth/refresh 401s on every load.
      partialize: (s): PersistedAuth => ({
        user: s.sessionKind === 'live' ? s.user : null,
        sessionKind: s.sessionKind === 'live' ? 'live' : null,
      }),
      migrate: (persisted) => {
        const raw = persisted as (PersistedAuth & { isAuthenticated?: boolean }) | null;
        const migrated = migrateLegacyAuth(raw);
        if (!migrated?.user) {
          return { user: null, sessionKind: null };
        }
        // Legacy stores persisted isAuthenticated without sessionKind — treat as
        // a live session and let restoreSessionFromCookie validate the cookie.
        return {
          user: migrated.user,
          sessionKind: raw?.sessionKind === 'mock' ? null : ('live' as const),
        };
      },
    },
  ),
);

// ── Role helpers ───────────────────────────────────────────────────────────────

export function isAdmin(user: AuthUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

export function isManager(user: AuthUser | null): boolean {
  return user?.role === 'manager';
}

export function isFieldEngineer(user: AuthUser | null): boolean {
  return user?.role === 'field_engineer';
}

export function getRoleLabel(role: AppRole | undefined): string {
  switch (role) {
    case 'admin':
    case 'super_admin': return 'Admin';
    case 'manager':     return 'Manager';
    case 'field_engineer': return 'Field Engineer';
    default: return 'User';
  }
}

export function getRoleLandingPath(role: AppRole | undefined): string {
  switch (role) {
    case 'admin':
    case 'super_admin': return '/dashboard/admin';
    case 'manager':     return '/dashboard/manager';
    case 'field_engineer': return '/dashboard/engineer';
    default: return '/dashboard/admin';
  }
}
