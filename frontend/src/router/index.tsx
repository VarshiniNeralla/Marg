import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Outlet, Navigate } from 'react-router-dom';

import {
  ProtectedRoute, AdminRoute, ManagerOrAdminRoute,
  ManagerRoute, FieldEngineerRoute, GuestRoute,
} from './guards';
import PublicLayout from '@layouts/PublicLayout';
import LandingLayout from '@layouts/LandingLayout';
import DashboardLayout from '@layouts/DashboardLayout';
import LoadingScreen from '@shared/components/LoadingScreen/LoadingScreen';

function PageSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

// ── Landing ───────────────────────────────────────────────────────────────────
const LandingPage  = lazy(() => import('@/pages/Landing/LandingPage'));
const FeaturesPage = lazy(() => import('@/pages/Landing/FeaturesPage'));
const PricingPage  = lazy(() => import('@/pages/Landing/PricingPage'));
const ContactPage  = lazy(() => import('@/pages/Landing/ContactPage'));

// ── Auth ──────────────────────────────────────────────────────────────────────
const LoginPage          = lazy(() => import('@features/auth/pages/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@features/auth/pages/ForgotPasswordPage'));
const ResetPasswordPage  = lazy(() => import('@features/auth/pages/ResetPasswordPage'));

// ── Role Dashboards ───────────────────────────────────────────────────────────
const AdminDashboard    = lazy(() => import('@/pages/Dashboard/AdminDashboard'));
const ManagerDashboard  = lazy(() => import('@/pages/Dashboard/ManagerDashboard'));
const EngineerDashboard = lazy(() => import('@/pages/Dashboard/EngineerDashboard'));

// ── Construction Workflow ─────────────────────────────────────────────────────
const WorkflowPage = lazy(() => import('@/pages/Workflow/WorkflowPage'));

// ── Projects ──────────────────────────────────────────────────────────────────
const ProjectsPage      = lazy(() => import('@/pages/Projects/ProjectsPage'));
const NewProjectPage    = lazy(() => import('@/pages/Projects/NewProjectPage'));
const EditProjectPage   = lazy(() => import('@/pages/Projects/EditProjectPage'));
const ProjectDetailPage = lazy(() => import('@/pages/Projects/ProjectDetailPage'));
const TowersPage        = lazy(() => import('@/pages/Projects/TowersPage'));
const FloorListPage     = lazy(() => import('@/pages/Projects/FloorListPage'));
const RoomListPage      = lazy(() => import('@/pages/Projects/RoomListPage'));

// ── Captures ─────────────────────────────────────────────────────────────────
const CapturesPage      = lazy(() => import('@/pages/Captures/CapturesPage'));
const CaptureDetailPage = lazy(() => import('@/pages/Captures/CaptureDetailPage'));
const CaptureUploadPage = lazy(() => import('@/pages/Captures/CaptureUploadPage'));

// ── Tours ─────────────────────────────────────────────────────────────────────
const ToursPage      = lazy(() => import('@/pages/Tours/ToursPage'));
const TourViewerPage = lazy(() => import('@/pages/Tours/TourViewerPage'));

// ── Floor Plans ───────────────────────────────────────────────────────────────
const FloorPlansPage      = lazy(() => import('@/pages/FloorPlans/FloorPlansPage'));
const FloorPlanViewerPage = lazy(() => import('@/pages/FloorPlans/FloorPlanViewerPage'));
const FloorPlanUploadPage = lazy(() => import('@/pages/FloorPlans/FloorPlanUploadPage'));

// ── Analytics / Settings / Profile ───────────────────────────────────────────
const AnalyticsPage   = lazy(() => import('@/pages/Analytics/AnalyticsPage'));
const SettingsPage    = lazy(() => import('@/pages/Settings/SettingsPage'));
const UserProfilePage = lazy(() => import('@/pages/Profile/UserProfilePage'));
const DefectsPage     = lazy(() => import('@/pages/Defects/DefectsPage'));

// ── Admin-only ────────────────────────────────────────────────────────────────
const UserManagementPage = lazy(() => import('@/pages/Users/UserManagementPage'));
const OrganizationsPage  = lazy(() => import('@/pages/Organizations/OrganizationsPage'));
const MediaPage          = lazy(() => import('@/pages/Admin/MediaPage'));
const AuditPage          = lazy(() => import('@/pages/Admin/AuditPage'));

// ── Manager-only ──────────────────────────────────────────────────────────────
const ReviewsPage = lazy(() => import('@/pages/Reviews/ReviewsPage'));
const ProgressReportsPage = lazy(() => import('@/pages/ProgressReports/ProgressReportsPage'));
const ConstructionProgressOverviewPage = lazy(() => import('@/pages/ConstructionProgress/ConstructionProgressOverviewPage'));
const ConstructionProgressDashboardPage = lazy(() => import('@/pages/ConstructionProgress/ConstructionProgressDashboardPage'));
const FlatFinishingWorksPage = lazy(() => import('@/pages/ConstructionProgress/FlatFinishingWorksPage'));
const DrishtiProjectSelectionPage = lazy(() => import('@/pages/Drishti/DrishtiProjectSelectionPage'));
const DrishtiChatPage = lazy(() => import('@/pages/Drishti/DrishtiChatPage'));
const DrishtiPdfPreviewPage = lazy(() => import('@/pages/Drishti/DrishtiPdfPreviewPage'));

// ── Field Engineer-only ───────────────────────────────────────────────────────
const CaptureWorkflowPage = lazy(() => import('@/pages/CaptureWorkflow/CaptureWorkflowPage'));
const PublishToursPage    = lazy(() => import('@/pages/CaptureWorkflow/PublishToursPage'));
const UploadQueuePage     = lazy(() => import('@/pages/Captures/CaptureUploadPage'));
const MyCaptures          = lazy(() => import('@/pages/Captures/CapturesPage'));

const router = createBrowserRouter([
  // ── Landing (public) ────────────────────────────────────────────────────────
  {
    element: <LandingLayout />,
    children: [
      { path: '/',         element: <PageSuspense><LandingPage /></PageSuspense> },
      { path: '/features', element: <PageSuspense><FeaturesPage /></PageSuspense> },
      { path: '/pricing',  element: <PageSuspense><PricingPage /></PageSuspense> },
      { path: '/contact',  element: <PageSuspense><ContactPage /></PageSuspense> },
    ],
  },

  // ── Auth (public, redirect if already logged in) ─────────────────────────
  {
    element: <PublicLayout />,
    children: [
      { path: '/login',           element: <GuestRoute><PageSuspense><LoginPage /></PageSuspense></GuestRoute> },
      { path: '/forgot-password', element: <GuestRoute><PageSuspense><ForgotPasswordPage /></PageSuspense></GuestRoute> },
      { path: '/reset-password',  element: <GuestRoute><PageSuspense><ResetPasswordPage /></PageSuspense></GuestRoute> },
      // Register removed — users only created by Admin
      { path: '/register',        element: <Navigate to="/login" replace /> },
    ],
  },

  // ── Protected (all authenticated roles) ──────────────────────────────────
  {
    element: (
      <ProtectedRoute>
        <DashboardLayout />
      </ProtectedRoute>
    ),
    children: [
      // ── Role-specific dashboards ──────────────────────────────────────────
      {
        path: '/dashboard/admin',
        element: (
          <AdminRoute>
            <PageSuspense><AdminDashboard /></PageSuspense>
          </AdminRoute>
        ),
      },
      {
        path: '/dashboard/manager',
        element: (
          <ManagerRoute>
            <PageSuspense><ManagerDashboard /></PageSuspense>
          </ManagerRoute>
        ),
      },
      {
        path: '/dashboard/engineer',
        element: (
          <FieldEngineerRoute>
            <PageSuspense><EngineerDashboard /></PageSuspense>
          </FieldEngineerRoute>
        ),
      },
      // Legacy /dashboard → redirect to role landing (handled in GuestRoute / guards)
      { path: '/dashboard', element: <Navigate to="/login" replace /> },

      // ── Shared authenticated routes ───────────────────────────────────────
      { path: '/profile', element: <PageSuspense><UserProfilePage /></PageSuspense> },

      // ── Routes accessible by all authenticated roles ─────────────────────
      // Capture detail is viewable by all roles — engineers open their own captures from pins/history.
      { path: '/captures/:captureId',                                       element: <PageSuspense><CaptureDetailPage /></PageSuspense> },
      // Floor plans are viewable by all roles — engineers browse/view but cannot upload.
      { path: '/floor-plans',                                               element: <PageSuspense><FloorPlansPage /></PageSuspense> },
      { path: '/floor-plans/:projectId/:towerId/:floorId',                  element: <PageSuspense><FloorPlanViewerPage /></PageSuspense> },
      // Tours are viewable by all roles — engineers verify their published walkthroughs.
      { path: '/tours',                                                     element: <PageSuspense><ToursPage /></PageSuspense> },
      { path: '/tours/:tourId',                                             element: <PageSuspense><TourViewerPage /></PageSuspense> },

      // ── Admin + Manager only ──────────────────────────────────────────────
      {
        element: <ManagerOrAdminRoute><Outlet /></ManagerOrAdminRoute>,
        children: [
          { path: '/projects',                                                  element: <PageSuspense><ProjectsPage /></PageSuspense> },
          { path: '/projects/:projectId',                                       element: <PageSuspense><ProjectDetailPage /></PageSuspense> },
          { path: '/analytics', element: <PageSuspense><AnalyticsPage /></PageSuspense> },
          { path: '/defects',   element: <PageSuspense><DefectsPage /></PageSuspense> },
          { path: '/captures',                element: <PageSuspense><CapturesPage /></PageSuspense> },
          { path: '/progress-reports',        element: <PageSuspense><ProgressReportsPage /></PageSuspense> },
          { path: '/construction-progress',           element: <PageSuspense><ConstructionProgressOverviewPage /></PageSuspense> },
          { path: '/construction-progress/:floorId',  element: <PageSuspense><ConstructionProgressDashboardPage /></PageSuspense> },
          { path: '/construction-progress/:floorId/flats', element: <PageSuspense><FlatFinishingWorksPage /></PageSuspense> },
          { path: '/construction-progress/:floorId/common', element: <PageSuspense><FlatFinishingWorksPage /></PageSuspense> },
          { path: '/drishti',              element: <PageSuspense><DrishtiProjectSelectionPage /></PageSuspense> },
          { path: '/drishti/:projectId',   element: <PageSuspense><DrishtiChatPage /></PageSuspense> },
          // Viewing floors/rooms/captures within a tower is not an admin-only
          // action — FloorListPage/RoomListPage already self-guard their own
          // Add/Edit/Delete buttons behind an internal hasAdminRole check, so
          // a manager opening these routes only ever sees a read-only view.
          // Only /towers (which has the "Add Tower" creation flow) stays
          // admin-only, below.
          { path: '/projects/:projectId/towers/:towerId',                 element: <PageSuspense><FloorListPage /></PageSuspense> },
          { path: '/projects/:projectId/towers/:towerId/floors/:floorId', element: <PageSuspense><RoomListPage /></PageSuspense> },
          // Managers see/edit field engineers only — the page and backend both scope this;
          // it's not moved to the Admin-only block below since Admins need the full view too.
          { path: '/users',                             element: <PageSuspense><UserManagementPage /></PageSuspense> },
          { path: '/reviews',                           element: <PageSuspense><ReviewsPage /></PageSuspense> },
          { path: '/floor-plans/:projectId/:towerId/:floorId/upload', element: <PageSuspense><FloorPlanUploadPage /></PageSuspense> },
        ],
      },

      // ── Admin-only routes ─────────────────────────────────────────────────
      {
        element: <AdminRoute><Outlet /></AdminRoute>,
        children: [
          { path: '/projects/new',                      element: <PageSuspense><NewProjectPage /></PageSuspense> },
          { path: '/projects/:projectId/edit',          element: <PageSuspense><EditProjectPage /></PageSuspense> },
          { path: '/projects/:projectId/towers',                                element: <PageSuspense><TowersPage /></PageSuspense> },
          { path: '/workflow',                          element: <PageSuspense><WorkflowPage /></PageSuspense> },
          { path: '/organizations',                     element: <PageSuspense><OrganizationsPage /></PageSuspense> },
          { path: '/admin/media',                       element: <PageSuspense><MediaPage /></PageSuspense> },
          { path: '/admin/audit',                       element: <PageSuspense><AuditPage /></PageSuspense> },
          { path: '/settings',                          element: <PageSuspense><SettingsPage /></PageSuspense> },
          { path: '/captures/upload',                   element: <PageSuspense><CaptureUploadPage /></PageSuspense> },
          // Dev-only PDF layout QA — admin-gated (never public)
          { path: '/dev/drishti-pdf-preview',           element: <PageSuspense><DrishtiPdfPreviewPage /></PageSuspense> },
        ],
      },

      // ── Field Engineer-only routes ────────────────────────────────────────
      {
        element: <FieldEngineerRoute><Outlet /></FieldEngineerRoute>,
        children: [
          { path: '/capture-workflow', element: <PageSuspense><CaptureWorkflowPage /></PageSuspense> },
          { path: '/my-captures',      element: <PageSuspense><MyCaptures /></PageSuspense> },
          { path: '/publish-tours',    element: <PageSuspense><PublishToursPage /></PageSuspense> },
          { path: '/upload-queue',     element: <PageSuspense><UploadQueuePage /></PageSuspense> },
        ],
      },
    ],
  },

  // ── 404 ───────────────────────────────────────────────────────────────────
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
