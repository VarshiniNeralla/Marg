import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';

import { ProtectedRoute, AdminRoute, GuestRoute } from './guards';
import PublicLayout from '@layouts/PublicLayout';
import LandingLayout from '@layouts/LandingLayout';
import DashboardLayout from '@layouts/DashboardLayout';
import LoadingScreen from '@shared/components/LoadingScreen/LoadingScreen';

// ── Landing ───────────────────────────────────────────────────────────────────
const LandingPage  = lazy(() => import('@/pages/Landing/LandingPage'));
const FeaturesPage = lazy(() => import('@/pages/Landing/FeaturesPage'));
const PricingPage  = lazy(() => import('@/pages/Landing/PricingPage'));
const ContactPage  = lazy(() => import('@/pages/Landing/ContactPage'));

function PageSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
const LoginPage          = lazy(() => import('@features/auth/pages/LoginPage'));
const RegisterPage       = lazy(() => import('@features/auth/pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('@features/auth/pages/ForgotPasswordPage'));
const ResetPasswordPage  = lazy(() => import('@features/auth/pages/ResetPasswordPage'));

// ── Dashboard ─────────────────────────────────────────────────────────────────
const DashboardHomePage  = lazy(() => import('@features/dashboard/DashboardHomePage'));

// ── Projects ──────────────────────────────────────────────────────────────────
const ProjectsPage       = lazy(() => import('@/pages/Projects/ProjectsPage'));
const NewProjectPage     = lazy(() => import('@/pages/Projects/NewProjectPage'));
const EditProjectPage    = lazy(() => import('@/pages/Projects/EditProjectPage'));
const ProjectDetailPage  = lazy(() => import('@/pages/Projects/ProjectDetailPage'));
const TowersPage         = lazy(() => import('@/pages/Projects/TowersPage'));
const FloorListPage      = lazy(() => import('@/pages/Projects/FloorListPage'));
const RoomListPage       = lazy(() => import('@/pages/Projects/RoomListPage'));

// ── Captures ──────────────────────────────────────────────────────────────────
const CapturesPage       = lazy(() => import('@/pages/Captures/CapturesPage'));
const CaptureDetailPage  = lazy(() => import('@/pages/Captures/CaptureDetailPage'));
const CaptureUploadPage  = lazy(() => import('@/pages/Captures/CaptureUploadPage'));

// ── Tours ─────────────────────────────────────────────────────────────────────
const ToursPage          = lazy(() => import('@/pages/Tours/ToursPage'));
const TourViewerPage     = lazy(() => import('@/pages/Tours/TourViewerPage'));

// ── Floor Plans ───────────────────────────────────────────────────────────────
const FloorPlansPage        = lazy(() => import('@/pages/FloorPlans/FloorPlansPage'));
const FloorPlanViewerPage   = lazy(() => import('@/pages/FloorPlans/FloorPlanViewerPage'));
const FloorPlanUploadPage   = lazy(() => import('@/pages/FloorPlans/FloorPlanUploadPage'));

// ── Other ─────────────────────────────────────────────────────────────────────
const AnalyticsPage      = lazy(() => import('@/pages/Analytics/AnalyticsPage'));
const SettingsPage       = lazy(() => import('@/pages/Settings/SettingsPage'));
const UserProfilePage    = lazy(() => import('@/pages/Profile/UserProfilePage'));
const DefectsPage        = lazy(() => import('@/pages/Defects/DefectsPage'));

// ── Admin ─────────────────────────────────────────────────────────────────────
const UsersPage          = lazy(() => import('@/pages/Users/UsersPage'));
const OrganizationsPage  = lazy(() => import('@/pages/Organizations/OrganizationsPage'));
const AccessPage         = lazy(() => import('@/pages/Access/AccessPage'));

const router = createBrowserRouter([
  // Landing routes (public, no auth required, no GuestRoute)
  {
    element: <LandingLayout />,
    children: [
      { path: '/',          element: <PageSuspense><LandingPage /></PageSuspense> },
      { path: '/features',  element: <PageSuspense><FeaturesPage /></PageSuspense> },
      { path: '/pricing',   element: <PageSuspense><PricingPage /></PageSuspense> },
      { path: '/contact',   element: <PageSuspense><ContactPage /></PageSuspense> },
    ],
  },

  // Auth routes
  {
    element: <PublicLayout />,
    children: [
      { path: '/login',           element: <GuestRoute><PageSuspense><LoginPage /></PageSuspense></GuestRoute> },
      { path: '/register',        element: <GuestRoute><PageSuspense><RegisterPage /></PageSuspense></GuestRoute> },
      { path: '/forgot-password', element: <GuestRoute><PageSuspense><ForgotPasswordPage /></PageSuspense></GuestRoute> },
      { path: '/reset-password',  element: <GuestRoute><PageSuspense><ResetPasswordPage /></PageSuspense></GuestRoute> },
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
      { path: '/dashboard', element: <PageSuspense><DashboardHomePage /></PageSuspense> },

      // Projects
      { path: '/projects',                                                         element: <PageSuspense><ProjectsPage /></PageSuspense> },
      { path: '/projects/new',                                                     element: <PageSuspense><NewProjectPage /></PageSuspense> },
      { path: '/projects/:projectId/edit',                                         element: <PageSuspense><EditProjectPage /></PageSuspense> },
      { path: '/projects/:projectId',                                              element: <PageSuspense><ProjectDetailPage /></PageSuspense> },
      { path: '/projects/:projectId/towers',                                       element: <PageSuspense><TowersPage /></PageSuspense> },
      { path: '/projects/:projectId/towers/:towerId',                              element: <PageSuspense><FloorListPage /></PageSuspense> },
      { path: '/projects/:projectId/towers/:towerId/floors/:floorId',              element: <PageSuspense><RoomListPage /></PageSuspense> },

      // Captures
      { path: '/captures',             element: <PageSuspense><CapturesPage /></PageSuspense> },
      { path: '/captures/upload',      element: <PageSuspense><CaptureUploadPage /></PageSuspense> },
      { path: '/captures/:captureId',  element: <PageSuspense><CaptureDetailPage /></PageSuspense> },

      // Tours
      { path: '/tours',          element: <PageSuspense><ToursPage /></PageSuspense> },
      { path: '/tours/:tourId',  element: <PageSuspense><TourViewerPage /></PageSuspense> },

      // Floor Plans
      { path: '/floor-plans',                                                      element: <PageSuspense><FloorPlansPage /></PageSuspense> },
      { path: '/floor-plans/:projectId/:towerId/:floorId',                         element: <PageSuspense><FloorPlanViewerPage /></PageSuspense> },
      { path: '/floor-plans/:projectId/:towerId/:floorId/upload',                  element: <PageSuspense><FloorPlanUploadPage /></PageSuspense> },

      // Other
      { path: '/analytics', element: <PageSuspense><AnalyticsPage /></PageSuspense> },
      { path: '/settings',  element: <PageSuspense><SettingsPage /></PageSuspense> },
      { path: '/profile',   element: <PageSuspense><UserProfilePage /></PageSuspense> },
      { path: '/defects',   element: <PageSuspense><DefectsPage /></PageSuspense> },

      // Admin routes
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

  {
    path: '*',
    element: (
      <PublicLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh', flexDirection: 'column', gap: 16, color: '#64748b', textAlign: 'center', padding: '0 24px' }}>
          <div style={{ fontSize: '5rem', fontWeight: 800, color: '#e2e8f0', lineHeight: 1, letterSpacing: '-0.05em', fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif' }}>404</div>
          <div>
            <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', margin: '0 0 8px', letterSpacing: '-0.03em' }}>Page not found</p>
            <p style={{ fontSize: '0.9375rem', color: '#64748b', margin: 0 }}>The page you're looking for doesn't exist or has been moved.</p>
          </div>
          <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 24px', borderRadius: '10px', background: 'linear-gradient(135deg, #2563eb 0%, #1a56db 100%)', color: '#fff', fontWeight: 600, fontSize: '0.9375rem', textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
            ← Back to homepage
          </a>
        </div>
      </PublicLayout>
    ),
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
