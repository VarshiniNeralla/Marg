import { create } from 'zustand';

export interface OrgSettings {
  max_projects: number;
  max_users: number;
  storage_limit_gb: number;
}

export interface OrgStats {
  total_projects: number;
  total_users: number;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  logo_url?: string | null;
  settings: OrgSettings;
  stats?: OrgStats;
  created_at: string;
  updated_at: string;
}

interface OrganizationState {
  org: Organization | null;
  isLoading: boolean;
  error: string | null;

  setOrg: (org: Organization) => void;
  patchOrg: (patch: Partial<Organization>) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  clear: () => void;
}

export const useOrganizationStore = create<OrganizationState>((set) => ({
  org: null,
  isLoading: false,
  error: null,

  setOrg(org) {
    set({ org, error: null, isLoading: false });
  },

  patchOrg(patch) {
    set((s) => ({ org: s.org ? { ...s.org, ...patch } : null }));
  },

  setLoading(v) {
    set({ isLoading: v });
  },

  setError(msg) {
    set({ error: msg, isLoading: false });
  },

  clear() {
    set({ org: null, isLoading: false, error: null });
  },
}));
