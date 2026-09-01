/**
 * Frontend permission helpers mirroring backend/app/core/permissions.py
 * for UI gating. Server enforcement remains authoritative.
 */
import type { AppRole } from '@store/authStore';

type Action =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'upload'
  | 'approve'
  | 'reject'
  | 'publish'
  | 'assign';

const ADMIN_ACTIONS: Action[] = [
  'view', 'create', 'edit', 'delete', 'upload', 'approve', 'reject', 'publish', 'assign',
];

const MATRIX: Record<string, Partial<Record<AppRole, Action[]>>> = {
  users: {
    admin: ADMIN_ACTIONS,
    super_admin: ADMIN_ACTIONS,
    // Managers manage field engineers via dedicated endpoints (not this matrix alone).
    manager: ['view', 'edit', 'assign'],
  },
  projects: {
    admin: ADMIN_ACTIONS,
    super_admin: ADMIN_ACTIONS,
    manager: ['view'],
    field_engineer: ['view'],
  },
  towers: {
    admin: ADMIN_ACTIONS,
    super_admin: ADMIN_ACTIONS,
    manager: ['view'],
    field_engineer: ['view'],
  },
  floors: {
    admin: ADMIN_ACTIONS,
    super_admin: ADMIN_ACTIONS,
    manager: ['view'],
    field_engineer: ['view'],
  },
  flats: {
    admin: ADMIN_ACTIONS,
    super_admin: ADMIN_ACTIONS,
    manager: ['view'],
    field_engineer: ['view'],
  },
  rooms: {
    admin: ADMIN_ACTIONS,
    super_admin: ADMIN_ACTIONS,
    manager: ['view'],
    field_engineer: ['view', 'create', 'edit', 'delete'],
  },
  captures: {
    admin: ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'upload'],
    super_admin: ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'upload'],
    manager: ['view', 'approve', 'reject'],
    field_engineer: ['view', 'upload', 'create', 'edit', 'delete'],
  },
  tours: {
    admin: ['view', 'create', 'edit', 'delete', 'publish'],
    super_admin: ['view', 'create', 'edit', 'delete', 'publish'],
    manager: ['view', 'publish'],
    field_engineer: ['view', 'create', 'publish', 'edit', 'delete'],
  },
  floorPlans: {
    admin: ['view', 'create', 'edit', 'delete', 'upload'],
    super_admin: ['view', 'create', 'edit', 'delete', 'upload'],
    manager: ['view', 'create', 'edit', 'delete', 'upload'],
    field_engineer: ['view', 'create', 'upload', 'edit'],
  },
  defects: {
    admin: ['view', 'create', 'edit', 'delete'],
    super_admin: ['view', 'create', 'edit', 'delete'],
    manager: ['view', 'create', 'edit'],
    field_engineer: ['view'],
  },
  analytics: {
    admin: ['view'],
    super_admin: ['view'],
    manager: ['view'],
  },
  settings: {
    admin: ['view', 'edit'],
    super_admin: ['view', 'edit'],
  },
  organizations: {
    admin: ['view', 'edit'],
    super_admin: ['view', 'edit'],
  },
  auditLogs: {
    admin: ['view'],
    super_admin: ['view'],
  },
  media: {
    admin: ['view'],
    super_admin: ['view'],
  },
  notifications: {
    admin: ['view', 'create', 'edit', 'delete'],
    super_admin: ['view', 'create', 'edit', 'delete'],
    manager: ['view', 'create', 'edit', 'delete'],
    field_engineer: ['view', 'create', 'edit', 'delete'],
  },
};

export function can(
  role: AppRole | undefined,
  module: keyof typeof MATRIX,
  action: Action,
): boolean {
  if (!role) return false;
  const allowed = MATRIX[module]?.[role];
  return !!allowed?.includes(action);
}
