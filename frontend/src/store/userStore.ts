import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORE_VERSION, USER_STORE_KEY } from './persistence';

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  avatar_url?: string | null;
  last_login?: string | null;
  created_at: string;
}

interface UserState {
  users: UserListItem[];
  total: number;
  isLoading: boolean;
  error: string | null;

  setUsers: (users: UserListItem[], total: number) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  updateUserInList: (id: string, patch: Partial<UserListItem>) => void;
  clear: () => void;
}

type PersistedUser = Pick<UserState, 'users' | 'total'>;

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      users: [],
      total: 0,
      isLoading: false,
      error: null,

      setUsers(users, total) {
        set({ users, total, error: null });
      },

      setLoading(v) {
        set({ isLoading: v });
      },

      setError(msg) {
        set({ error: msg, isLoading: false });
      },

      updateUserInList(id, patch) {
        set((s) => ({
          users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
        }));
      },

      clear() {
        set({ users: [], total: 0, isLoading: false, error: null });
      },
    }),
    {
      name: USER_STORE_KEY,
      version: STORE_VERSION.user,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): PersistedUser => ({ users: s.users, total: s.total }),
      migrate: (persisted) => {
        const p = persisted as PersistedUser | null;
        if (!p || !Array.isArray(p.users)) {
          return { users: [], total: 0 };
        }
        return p;
      },
    },
  ),
);
