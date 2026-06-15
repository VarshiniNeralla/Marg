import { create } from 'zustand';

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

export const useUserStore = create<UserState>((set) => ({
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
}));
