import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AUTH_STORE_KEY, STORE_VERSION, safeParseJson } from './persistence';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'user';
  org_id: string;
  org_name: string;
  org_slug: string;
  avatar_url?: string | null;
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
  if (persisted?.user) return persisted;
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
