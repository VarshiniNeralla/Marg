import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  // User profile is persisted so the UI can render instantly on page load.
  user: AuthUser | null;
  isAuthenticated: boolean;

  // Actions
  setAuth: (token: string, user: AuthUser) => void;
  setAccessToken: (token: string) => void;
  updateUser: (partial: Partial<AuthUser>) => void;
  clearAuth: () => void;
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
      name: 'auth',
      // Only persist the user profile — never persist the access token.
      partialize: (s) => ({ user: s.user, isAuthenticated: s.isAuthenticated }),
    }
  )
);
