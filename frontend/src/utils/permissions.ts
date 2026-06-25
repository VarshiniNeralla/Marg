import type { AppRole, AuthUser } from '@store/authStore';

// ── Permission Matrix ──────────────────────────────────────────────────────────
// Single source of truth for what each role can do.

type Action = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'reject' | 'publish' | 'upload' | 'assign';

type Module =
  | 'users'
  | 'projects'
  | 'towers'
  | 'floors'
  | 'flats'
  | 'rooms'
  | 'captures'
  | 'tours'
  | 'floorPlans'
  | 'defects'
  | 'analytics'
  | 'settings'
  | 'organizations'
  | 'auditLogs'
  | 'notifications';

type PermissionMap = Partial<Record<Module, Action[]>>;

const PERMISSIONS: Record<AppRole, PermissionMap> = {
  super_admin: {
    users:         ['view', 'create', 'edit', 'delete', 'assign'],
    projects:      ['view', 'create', 'edit', 'delete', 'assign'],
    towers:        ['view', 'create', 'edit', 'delete'],
    floors:        ['view', 'create', 'edit', 'delete'],
    flats:         ['view', 'create', 'edit', 'delete'],
    rooms:         ['view', 'create', 'edit', 'delete'],
    captures:      ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'upload'],
    tours:         ['view', 'create', 'edit', 'delete', 'publish'],
    floorPlans:    ['view', 'create', 'edit', 'delete', 'upload'],
    defects:       ['view', 'create', 'edit', 'delete'],
    analytics:     ['view'],
    settings:      ['view', 'edit'],
    organizations: ['view', 'edit'],
    auditLogs:     ['view'],
    notifications: ['view'],
  },
  admin: {
    users:         ['view', 'create', 'edit', 'delete', 'assign'],
    projects:      ['view', 'create', 'edit', 'delete', 'assign'],
    towers:        ['view', 'create', 'edit', 'delete'],
    floors:        ['view', 'create', 'edit', 'delete'],
    flats:         ['view', 'create', 'edit', 'delete'],
    rooms:         ['view', 'create', 'edit', 'delete'],
    captures:      ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'upload'],
    tours:         ['view', 'create', 'edit', 'delete', 'publish'],
    floorPlans:    ['view', 'create', 'edit', 'delete', 'upload'],
    defects:       ['view', 'create', 'edit', 'delete'],
    analytics:     ['view'],
    settings:      ['view', 'edit'],
    organizations: ['view', 'edit'],
    auditLogs:     ['view'],
    notifications: ['view'],
  },
  manager: {
    projects:      ['view'],
    towers:        ['view'],
    floors:        ['view'],
    flats:         ['view'],
    rooms:         ['view'],
    captures:      ['view', 'approve', 'reject'],
    tours:         ['view', 'publish'],
    floorPlans:    ['view'],
    defects:       ['view', 'create', 'edit'],
    analytics:     ['view'],
    notifications: ['view'],
    users:         [],
    settings:      [],
    organizations: [],
    auditLogs:     [],
  },
  field_engineer: {
    projects:      ['view'],
    towers:        ['view'],
    floors:        ['view'],
    flats:         ['view'],
    rooms:         ['view'],
    captures:      ['view', 'upload', 'create'],
    floorPlans:    ['view'],
    defects:       ['view'],
    notifications: ['view'],
    tours:         [],
    analytics:     [],
    users:         [],
    settings:      [],
    organizations: [],
    auditLogs:     [],
  },
};

// ── can() helper ───────────────────────────────────────────────────────────────

export function can(user: AuthUser | null, module: Module, action: Action): boolean {
  if (!user) return false;
  const allowed = PERMISSIONS[user.role]?.[module] ?? [];
  return allowed.includes(action);
}

// ── Convenience booleans ───────────────────────────────────────────────────────

export function canManageUsers(user: AuthUser | null): boolean {
  return can(user, 'users', 'create');
}

export function canReviewCaptures(user: AuthUser | null): boolean {
  return can(user, 'captures', 'approve');
}

export function canUploadCaptures(user: AuthUser | null): boolean {
  return can(user, 'captures', 'upload');
}

export function canPublishTours(user: AuthUser | null): boolean {
  return can(user, 'tours', 'publish');
}

export function canViewAnalytics(user: AuthUser | null): boolean {
  return can(user, 'analytics', 'view');
}

export function canAccessSettings(user: AuthUser | null): boolean {
  return can(user, 'settings', 'view');
}

export function canCreateProjects(user: AuthUser | null): boolean {
  return can(user, 'projects', 'create');
}

export { type Module, type Action };
