import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { LEGACY_KEYS, SETTINGS_STORE_KEY, STORE_VERSION, safeParseJson } from './persistence';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TeamMember {
  name: string;
  email: string;
  role: string;
  status: string;
}

export interface SettingsState {
  account: {
    name: string;
    email: string;
    phone: string;
    designation: string;
  };
  organization: {
    name: string;
    website: string;
    address: string;
  };
  notifications: Record<string, boolean>;
  appearance: {
    theme: string;
    density: string;
  };
  security: {
    twoFactorEnabled: boolean;
  };
  profile: {
    name: string;
    designation: string;
    phone: string;
    bio: string;
    avatarUrl: string;
  };
  teamMembers: TeamMember[];
  recentSearches: string[];

  patchAccount: (patch: Partial<SettingsState['account']>) => void;
  patchOrganization: (patch: Partial<SettingsState['organization']>) => void;
  patchNotifications: (patch: Record<string, boolean>) => void;
  patchAppearance: (patch: Partial<SettingsState['appearance']>) => void;
  patchSecurity: (patch: Partial<SettingsState['security']>) => void;
  patchProfile: (patch: Partial<SettingsState['profile']>) => void;
  setTeamMembers: (members: TeamMember[]) => void;
  addRecentSearch: (query: string) => void;
  resetToDefaults: () => void;
}

export const NOTIF_PREF_KEYS = [
  'capture_upload', 'capture_review', 'tour_published',
  'project_update', 'team_invite', 'weekly_digest',
] as const;

export const NOTIF_PREF_DEFAULTS: Record<string, boolean> = {
  capture_upload: true,
  capture_review: true,
  tour_published: false,
  project_update: true,
  team_invite: true,
  weekly_digest: false,
};

const DEFAULT_TEAM: TeamMember[] = [
  { name: 'Ravi Kumar', email: 'ravi@demo.com', role: 'Admin', status: 'Active' },
  { name: 'Anil P', email: 'anil@demo.com', role: 'Reviewer', status: 'Active' },
  { name: 'Kiran Desai', email: 'kiran@demo.com', role: 'Member', status: 'Active' },
  { name: 'Meena R', email: 'meena@demo.com', role: 'Member', status: 'Invited' },
];

export function buildDefaultSettings(): Omit<SettingsState, keyof Pick<SettingsState,
  'patchAccount' | 'patchOrganization' | 'patchNotifications' | 'patchAppearance' |
  'patchSecurity' | 'patchProfile' | 'setTeamMembers' | 'addRecentSearch' | 'resetToDefaults'
>> {
  return {
    account: {
      name: 'Ravi Kumar',
      email: 'admin@demo.com',
      phone: '+91 98765 43210',
      designation: 'Site Manager',
    },
    organization: {
      name: 'My Home Constructions',
      website: 'https://myhomeconstructions.com',
      address: 'Hyderabad, Telangana, India',
    },
    notifications: { ...NOTIF_PREF_DEFAULTS },
    appearance: { theme: 'light', density: 'comfortable' },
    security: { twoFactorEnabled: false },
    profile: {
      name: 'Ravi Kumar',
      designation: 'Site Manager',
      phone: '+91 98765 43210',
      bio: 'Site manager at My Home Constructions with 8+ years of experience in residential construction documentation.',
      avatarUrl: '',
    },
    teamMembers: DEFAULT_TEAM.map(m => ({ ...m })),
    recentSearches: [],
  };
}

/** Merge legacy flat localStorage keys into settings shape (one-time migration). */
function migrateLegacySettings(persisted: Partial<SettingsState> | null): Partial<SettingsState> {
  const out: Partial<SettingsState> = { ...(persisted ?? {}) };
  const legacy = safeParseJson<Record<string, unknown>>(localStorage.getItem(LEGACY_KEYS[1]));
  const legacyProfile = safeParseJson<Record<string, string>>(localStorage.getItem(LEGACY_KEYS[2]));
  const legacySearch = safeParseJson<string[]>(localStorage.getItem(LEGACY_KEYS[3]));

  if (legacy) {
    out.account = {
      ...buildDefaultSettings().account,
      ...out.account,
      name: (legacy.account_name as string) ?? out.account?.name,
      email: (legacy.account_email as string) ?? out.account?.email,
      phone: (legacy.account_phone as string) ?? out.account?.phone,
      designation: (legacy.account_designation as string) ?? out.account?.designation,
    };
    out.organization = {
      ...buildDefaultSettings().organization,
      ...out.organization,
      name: (legacy.org_name as string) ?? out.organization?.name,
      website: (legacy.org_website as string) ?? out.organization?.website,
      address: (legacy.org_address as string) ?? out.organization?.address,
    };
    out.appearance = {
      ...buildDefaultSettings().appearance,
      ...out.appearance,
      theme: (legacy.appearance_theme as string) ?? out.appearance?.theme ?? 'light',
      density: (legacy.appearance_density as string) ?? out.appearance?.density ?? 'comfortable',
    };
    const notifs: Record<string, boolean> = { ...NOTIF_PREF_DEFAULTS, ...out.notifications };
    for (const key of NOTIF_PREF_KEYS) {
      const legacyKey = `notif_${key}`;
      if (legacy[legacyKey] !== undefined) notifs[key] = legacy[legacyKey] as boolean;
    }
    out.notifications = notifs;
  }

  if (legacyProfile) {
    out.profile = {
      ...buildDefaultSettings().profile,
      ...out.profile,
      name: legacyProfile.name ?? out.profile?.name,
      designation: legacyProfile.designation ?? out.profile?.designation,
      phone: legacyProfile.phone ?? out.profile?.phone,
      bio: legacyProfile.bio ?? out.profile?.bio,
      avatarUrl: legacyProfile.avatarUrl ?? out.profile?.avatarUrl ?? '',
    };
  }

  if (legacySearch?.length) {
    out.recentSearches = legacySearch;
  }

  return out;
}

type PersistedSettings = Pick<SettingsState,
  'account' | 'organization' | 'notifications' | 'appearance' |
  'security' | 'profile' | 'teamMembers' | 'recentSearches'
>;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...buildDefaultSettings(),

      patchAccount(patch) {
        set(s => ({ account: { ...s.account, ...patch } }));
      },
      patchOrganization(patch) {
        set(s => ({ organization: { ...s.organization, ...patch } }));
      },
      patchNotifications(patch) {
        set(s => ({ notifications: { ...s.notifications, ...patch } }));
      },
      patchAppearance(patch) {
        set(s => ({ appearance: { ...s.appearance, ...patch } }));
      },
      patchSecurity(patch) {
        set(s => ({ security: { ...s.security, ...patch } }));
      },
      patchProfile(patch) {
        set(s => ({ profile: { ...s.profile, ...patch } }));
      },
      setTeamMembers(members) {
        set({ teamMembers: members });
      },
      addRecentSearch(query) {
        const q = query.trim();
        if (q.length < 2) return;
        set(s => {
          const recent = [q, ...s.recentSearches.filter(x => x !== q)].slice(0, 8);
          return { recentSearches: recent };
        });
      },
      resetToDefaults() {
        set(buildDefaultSettings());
      },
    }),
    {
      name: SETTINGS_STORE_KEY,
      version: STORE_VERSION.settings,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): PersistedSettings => ({
        account: s.account,
        organization: s.organization,
        notifications: s.notifications,
        appearance: s.appearance,
        security: s.security,
        profile: s.profile,
        teamMembers: s.teamMembers,
        recentSearches: s.recentSearches,
      }),
      migrate: (persisted, version) => {
        const defaults = buildDefaultSettings();
        const merged = migrateLegacySettings(persisted as Partial<SettingsState> | null);
        if (!merged || version === 0) {
          return {
            account: { ...defaults.account, ...merged?.account },
            organization: { ...defaults.organization, ...merged?.organization },
            notifications: { ...defaults.notifications, ...merged?.notifications },
            appearance: { ...defaults.appearance, ...merged?.appearance },
            security: { ...defaults.security, ...merged?.security },
            profile: { ...defaults.profile, ...merged?.profile },
            teamMembers: merged?.teamMembers?.length ? merged.teamMembers : defaults.teamMembers,
            recentSearches: merged?.recentSearches ?? defaults.recentSearches,
          };
        }
        return {
          account: { ...defaults.account, ...merged.account },
          organization: { ...defaults.organization, ...merged.organization },
          notifications: { ...defaults.notifications, ...merged.notifications },
          appearance: { ...defaults.appearance, ...merged.appearance },
          security: { ...defaults.security, ...merged.security },
          profile: { ...defaults.profile, ...merged.profile },
          teamMembers: merged.teamMembers?.length ? merged.teamMembers : defaults.teamMembers,
          recentSearches: merged.recentSearches ?? defaults.recentSearches,
        };
      },
    },
  ),
);
