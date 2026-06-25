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

interface AuthState {
  // Access token lives in memory only — never persisted to localStorage.
  accessToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;

  setAuth: (token: string, user: AuthUser) => void;
  setAccessToken: (token: string) => void;
  updateUser: (partial: Partial<AuthUser>) => void;
  clearAuth: () => void;
}

type PersistedAuth = Pick<AuthState, 'user' | 'isAuthenticated'>;

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

      setAuth(token, user) {
        set({ accessToken: token, user, isAuthenticated: true });
      },

      setAccessToken(token) {
        set({ accessToken: token, isAuthenticated: true });
      },

      updateUser(partial) {
        set((s) => ({ user: s.user ? { ...s.user, ...partial } : null }));
      },

      clearAuth() {
        set({ accessToken: null, user: null, isAuthenticated: false });
      },
    }),
    {
      name: AUTH_STORE_KEY,
      version: STORE_VERSION.auth,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): PersistedAuth => ({ user: s.user, isAuthenticated: s.isAuthenticated }),
      migrate: (persisted) => {
        const migrated = migrateLegacyAuth(persisted as PersistedAuth | null);
        if (!migrated?.user || typeof migrated.isAuthenticated !== 'boolean') {
          return { user: null, isAuthenticated: false };
        }
        return migrated;
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
