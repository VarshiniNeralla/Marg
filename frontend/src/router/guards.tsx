import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@store/authStore';

// ── ProtectedRoute ─────────────────────────────────────────────────────────────
// Redirects to /login if the user is not authenticated.

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

// ── RoleRoute ──────────────────────────────────────────────────────────────────
// Renders children only if the user's system role is in the allowed list.
// Falls back to /dashboard if the user is authenticated but lacks the role.

type SystemRole = 'super_admin' | 'admin' | 'user';

interface RoleRouteProps {
  children: React.ReactNode;
  allowedRoles: SystemRole[];
  fallback?: string;
}

export function RoleRoute({
  children,
  allowedRoles,
  fallback = '/dashboard',
}: RoleRouteProps) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!user || !allowedRoles.includes(user.role as SystemRole)) {
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}

// ── AdminRoute — shorthand for role ≥ admin ────────────────────────────────────

export function AdminRoute({ children }: { children: React.ReactNode }) {
  return (
    <RoleRoute allowedRoles={['admin', 'super_admin']}>
      {children}
    </RoleRoute>
  );
}

// ── SuperAdminRoute ────────────────────────────────────────────────────────────

export function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  return (
    <RoleRoute allowedRoles={['super_admin']}>
      {children}
    </RoleRoute>
  );
}

// ── GuestRoute ─────────────────────────────────────────────────────────────────
// Redirects to /dashboard if user is already logged in (prevents visiting /login).

export function GuestRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
