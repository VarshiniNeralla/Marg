import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Outlet, Navigate } from 'react-router-dom';

import { ProtectedRoute, AdminRoute, GuestRoute } from './guards';
import PublicLayout from '@layouts/PublicLayout';
import DashboardLayout from '@layouts/DashboardLayout';
import LoadingScreen from '@shared/components/LoadingScreen/LoadingScreen';
import { useAuthStore } from '@store/authStore';

function RootRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />;
}

function PageSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

// Auth
const LoginPage           = lazy(() => import('@features/auth/pages/LoginPage'));
const RegisterPage        = lazy(() => import('@features/auth/pages/RegisterPage'));
const ForgotPasswordPage  = lazy(() => import('@features/auth/pages/ForgotPasswordPage'));
const ResetPasswordPage   = lazy(() => import('@features/auth/pages/ResetPasswordPage'));

// Dashboard
const DashboardHomePage   = lazy(() => import('@features/dashboard/DashboardHomePage'));

// General pages
const ProjectsPage        = lazy(() => import('@pages/Projects/ProjectsPage'));
const CapturesPage        = lazy(() => import('@pages/Captures/CapturesPage'));
const ToursPage           = lazy(() => import('@pages/Tours/ToursPage'));
const FloorPlansPage      = lazy(() => import('@pages/FloorPlans/FloorPlansPage'));
const AnalyticsPage       = lazy(() => import('@pages/Analytics/AnalyticsPage'));
const SettingsPage        = lazy(() => import('@pages/Settings/SettingsPage'));

// Admin pages
const UsersPage           = lazy(() => import('@pages/Users/UsersPage'));
const OrganizationsPage   = lazy(() => import('@pages/Organizations/OrganizationsPage'));
const AccessPage          = lazy(() => import('@pages/Access/AccessPage'));

const router = createBrowserRouter([
  // Public routes
  {
    element: <PublicLayout />,
    children: [
      { path: '/login',            element: <GuestRoute><PageSuspense><LoginPage /></PageSuspense></GuestRoute> },
      { path: '/register',         element: <GuestRoute><PageSuspense><RegisterPage /></PageSuspense></GuestRoute> },
      { path: '/forgot-password',  element: <GuestRoute><PageSuspense><ForgotPasswordPage /></PageSuspense></GuestRoute> },
      { path: '/reset-password',   element: <GuestRoute><PageSuspense><ResetPasswordPage /></PageSuspense></GuestRoute> },
    ],
  },

  // Protected routes
  {
    element: (
      <ProtectedRoute>
        <DashboardLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: '/dashboard',    element: <PageSuspense><DashboardHomePage /></PageSuspense> },
      { path: '/projects',     element: <PageSuspense><ProjectsPage /></PageSuspense> },
      { path: '/captures',     element: <PageSuspense><CapturesPage /></PageSuspense> },
      { path: '/tours',        element: <PageSuspense><ToursPage /></PageSuspense> },
      { path: '/floor-plans',  element: <PageSuspense><FloorPlansPage /></PageSuspense> },
      { path: '/analytics',    element: <PageSuspense><AnalyticsPage /></PageSuspense> },
      { path: '/settings',     element: <PageSuspense><SettingsPage /></PageSuspense> },

      // Admin-only routes
      {
        element: <AdminRoute><Outlet /></AdminRoute>,
        children: [
          { path: '/users',         element: <PageSuspense><UsersPage /></PageSuspense> },
          { path: '/organizations', element: <PageSuspense><OrganizationsPage /></PageSuspense> },
          { path: '/access',        element: <PageSuspense><AccessPage /></PageSuspense> },
        ],
      },
    ],
  },

  { path: '/', element: <RootRedirect /> },

  {
    path: '*',
    element: (
      <PublicLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', flexDirection: 'column', gap: 16, color: '#64748b' }}>
          <span style={{ fontSize: '3rem', fontWeight: 700, color: '#e2e8f0' }}>404</span>
          <p style={{ fontSize: '1rem' }}>Page not found.</p>
        </div>
      </PublicLayout>
    ),
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
