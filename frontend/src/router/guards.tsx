import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, isAdmin, isManager, isFieldEngineer, getRoleLandingPath } from '@store/authStore';
import type { AppRole } from '@store/authStore';

// ── ProtectedRoute ─────────────────────────────────────────────────────────────
// Redirects unauthenticated visitors to /login.

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

// ── RoleRoute ──────────────────────────────────────────────────────────────────
// Renders children only when user's role is in allowedRoles.
// On mismatch: redirects to their own landing page (not /dashboard blindly).

export function RoleRoute({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles: AppRole[];
}) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to={getRoleLandingPath(user?.role)} replace />;
  }
  return <>{children}</>;
}

// ── Shorthand guards ───────────────────────────────────────────────────────────

export function AdminRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute allowedRoles={['admin', 'super_admin']}>{children}</RoleRoute>;
}

export function ManagerRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute allowedRoles={['manager']}>{children}</RoleRoute>;
}

export function ManagerOrAdminRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute allowedRoles={['admin', 'super_admin', 'manager']}>{children}</RoleRoute>;
}

export function FieldEngineerRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute allowedRoles={['field_engineer']}>{children}</RoleRoute>;
}

// ── GuestRoute ─────────────────────────────────────────────────────────────────
// Redirects authenticated users away from auth pages to their role landing.

export function GuestRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  if (isAuthenticated) {
    return <Navigate to={getRoleLandingPath(user?.role)} replace />;
  }
  return <>{children}</>;
}
