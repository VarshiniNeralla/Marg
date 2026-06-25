import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid } from '@mui/material';
import {
  ViewInArRounded, MapRounded, CameraAltRounded, CheckCircleRounded,
  BugReportRounded, BarChartRounded, ArrowForwardRounded, GroupRounded,
  NotificationsRounded, SecurityRounded, CloudUploadRounded, SpeedRounded,
} from '@mui/icons-material';
import { colors, shadows, motion } from '@theme/tokens';

const NAV_H = 64;

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.75,
      px: 1.5, py: 0.5, borderRadius: '999px',
      border: '1px solid rgba(37,99,235,0.2)',
      backgroundColor: 'rgba(37,99,235,0.06)',
      fontSize: '0.75rem', fontWeight: 600, color: colors.primary,
      letterSpacing: '0.02em',
    }}>
      {children}
    </Box>
  );
}

function Navbar() {
  return (
    <Box component="nav" sx={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      height: NAV_H, display: 'flex', alignItems: 'center', px: { xs: 2, md: 6 },
      backdropFilter: 'blur(20px) saturate(180%)',
      backgroundColor: 'rgba(255,255,255,0.88)',
      borderBottom: `1px solid rgba(15,23,42,0.06)`,
    }}>
      <Box component={Link} to="/" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mr: 'auto', textDecoration: 'none' }}>
        <Box component="img" src="/assets/new_logo.png" alt="My Home Group" sx={{ height: 32, width: 'auto', objectFit: 'contain', flexShrink: 0 }} />
        <Box>
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>Prāṅgaṇ</Typography>
          <Typography sx={{ fontSize: '0.625rem', fontWeight: 500, color: colors.textSubdued, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}>by SiteSureLabs</Typography>
        </Box>
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.5, mr: 4 }}>
        {[['Features', '/features'], ['Pricing', '/pricing'], ['Contact', '/contact']].map(([label, path]) => (
          <Box key={label} component={Link} to={path} sx={{ px: 1.5, py: 0.875, borderRadius: '8px', fontSize: '0.9375rem', fontWeight: 500, color: colors.textSecondary, textDecoration: 'none', '&:hover': { color: colors.textStrong, backgroundColor: 'rgba(15,23,42,0.04)' }, transition: `all ${motion.durationFast}` }}>{label}</Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box component={Link} to="/login" sx={{ px: 2, py: 0.875, borderRadius: '8px', fontSize: '0.9375rem', fontWeight: 500, color: colors.textSecondary, textDecoration: 'none', '&:hover': { color: colors.textStrong } }}>Sign in</Box>
        <Box component={Link} to="/register" sx={{ px: 2.5, py: 1, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontWeight: 600, fontSize: '0.9375rem', textDecoration: 'none', boxShadow: shadows.btn, '&:hover': { opacity: 0.9 }, transition: `opacity ${motion.durationFast}` }}>Register</Box>
      </Box>
    </Box>
  );
}

const FEATURES_DETAIL = [
  {
    icon: <ViewInArRounded sx={{ fontSize: 32 }} />, color: '#2563eb', bg: 'rgba(37,99,235,0.08)',
    title: '360° Virtual Tours', badge: 'Core',
    tagline: 'Immersive panoramic experiences for every room.',
    bullets: [
      'Equirectangular panorama rendering via Photo Sphere Viewer v5',
      'Room-to-room hotspot navigation with yaw/pitch positioning',
      'Fullscreen mode, auto-rotate, and navigation drawer',
      'Tour strip for quick room switching',
      'Publish/unpublish controls with review workflow integration',
    ],
  },
  {
    icon: <MapRounded sx={{ fontSize: 32 }} />, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)',
    title: 'Floor Plan Mapping', badge: 'Core',
    tagline: 'See every capture location in context.',
    bullets: [
      'Upload PDF or PNG floor plans per floor',
      'Place interactive SVG room markers at precise coordinates',
      'Live capture status overlays (green/yellow/red per room)',
      'Click any marker to jump directly to that room\'s captures',
      'Sync with Room hierarchy for automatic marker generation',
    ],
  },
  {
    icon: <CameraAltRounded sx={{ fontSize: 32 }} />, color: '#0891b2', bg: 'rgba(8,145,178,0.08)',
    title: 'Capture Management', badge: 'Core',
    tagline: 'Multi-format upload with real-time progress.',
    bullets: [
      'Supports .jpg .jpeg .png .dng .insp .insv formats',
      'Multi-file drag-and-drop with per-file progress bars',
      'RAW and Insta360 formats show processing pipeline state',
      'File-type badges and size validation',
      'Cloudinary integration for secure cloud storage',
    ],
  },
  {
    icon: <CheckCircleRounded sx={{ fontSize: 32 }} />, color: '#16a34a', bg: 'rgba(22,163,74,0.08)',
    title: 'Review Workflows', badge: 'Core',
    tagline: '6-state lifecycle from upload to publication.',
    bullets: [
      'Uploaded → Assigned → Reviewing → Changes Requested → Approved → Published',
      'Assign reviewers from team members',
      'Add detailed reviewer notes per capture',
      'Request re-uploads with feedback attached',
      'Audit trail for every status change',
    ],
  },
  {
    icon: <BugReportRounded sx={{ fontSize: 32 }} />, color: '#dc2626', bg: 'rgba(220,38,38,0.08)',
    title: 'Defect Tracking', badge: 'Add-on',
    tagline: 'Link issues directly to site captures.',
    bullets: [
      'Create defects from any capture with room/floor context',
      'Severity levels: Critical, High, Medium, Low, Informational',
      'Assign defects to team members',
      'Status tracking: Open → In Progress → Resolved → Closed',
      'Filter by project, severity, assignee, status',
    ],
  },
  {
    icon: <BarChartRounded sx={{ fontSize: 32 }} />, color: '#d97706', bg: 'rgba(217,119,6,0.08)',
    title: 'Analytics', badge: 'Core',
    tagline: 'Portfolio-wide visibility at a glance.',
    bullets: [
      'KPI tiles: captures, reviews, tours, defects',
      'Bar chart capture volume by month',
      'Project completion progress bars',
      'Team productivity metrics',
      'Filter by date range, project, team member',
    ],
  },
  {
    icon: <GroupRounded sx={{ fontSize: 32 }} />, color: '#0891b2', bg: 'rgba(8,145,178,0.08)',
    title: 'Team Management', badge: 'Core',
    tagline: 'Role-based access for every stakeholder.',
    bullets: [
      'System roles: Super Admin, Admin, User',
      'Project roles: Admin, Manager, Reviewer, Viewer',
      'Invite team members via email',
      'Deactivate accounts without losing history',
      'Organization-level member directory',
    ],
  },
  {
    icon: <NotificationsRounded sx={{ fontSize: 32 }} />, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)',
    title: 'Notifications', badge: 'Core',
    tagline: 'Stay informed on every project event.',
    bullets: [
      'Real-time unread count badge with 30-second polling',
      'Mark individual or all notifications as read',
      'Navigate directly to the relevant entity from any notification',
      'Delete notifications with undo snackbar',
      'Notification types: review, assignment, defect, system',
    ],
  },
  {
    icon: <CloudUploadRounded sx={{ fontSize: 32 }} />, color: '#16a34a', bg: 'rgba(22,163,74,0.08)',
    title: 'Cloudinary Storage', badge: 'Infrastructure',
    tagline: 'Secure media delivery at scale.',
    bullets: [
      'XHR upload with real upload progress (not fake)',
      'Signed uploads via backend signature endpoint',
      'Private delivery URLs per organization',
      'Automatic image optimization and format conversion',
      'CDN-delivered panoramas worldwide',
    ],
  },
  {
    icon: <SecurityRounded sx={{ fontSize: 32 }} />, color: '#dc2626', bg: 'rgba(220,38,38,0.08)',
    title: 'Security', badge: 'Infrastructure',
    tagline: 'Enterprise-grade auth from day one.',
    bullets: [
      'JWT access tokens (15 min expiry) + httpOnly refresh cookies (7 days)',
      'Silent token rotation with request queue',
      'Tenant-scoped MongoDB queries (org_id on every document)',
      'RBAC enforced at both API and UI layer',
      'Audit logs for all critical actions',
    ],
  },
  {
    icon: <SpeedRounded sx={{ fontSize: 32 }} />, color: '#d97706', bg: 'rgba(217,119,6,0.08)',
    title: 'Performance', badge: 'Infrastructure',
    tagline: 'Fast by default, optimistic by design.',
    bullets: [
      'React Query with 5-minute stale time and optimistic updates',
      'Lazy-loaded page chunks via React.lazy',
      'Skeleton loading states for all list and grid views',
      'Vite build with tree-shaking and code splitting',
      'Canvas-based PSV rendering (no DOM overhead)',
    ],
  },
  {
    icon: <MapRounded sx={{ fontSize: 32 }} />, color: '#0891b2', bg: 'rgba(8,145,178,0.08)',
    title: 'Project Hierarchy', badge: 'Core',
    tagline: 'Organization → Project → Tower → Floor → Flat / Unit → Room.',
    bullets: [
      'Multi-tenant: each organization\'s data is fully isolated',
      'Projects contain towers, towers contain floors, floors contain rooms',
      'Hierarchical breadcrumb navigation throughout',
      'Batch actions at every level',
      'FastAPI backend with MongoDB Atlas + Motor async driver',
    ],
  },
];

function FeatureCard({ f }: { f: typeof FEATURES_DETAIL[0] }) {
  const badgeColor = f.badge === 'Core' ? { color: '#16a34a', bg: 'rgba(22,163,74,0.08)' } : f.badge === 'Add-on' ? { color: '#d97706', bg: 'rgba(217,119,6,0.08)' } : { color: '#64748b', bg: 'rgba(100,116,139,0.08)' };
  return (
    <Box sx={{ p: 3, borderRadius: '20px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, height: '100%', display: 'flex', flexDirection: 'column', transition: `all ${motion.durationNormal}`, '&:hover': { boxShadow: shadows.lg, transform: 'translateY(-2px)' } }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ width: 56, height: 56, borderRadius: '14px', backgroundColor: f.bg, color: f.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{f.icon}</Box>
        <Box sx={{ px: 1, py: 0.375, borderRadius: '6px', backgroundColor: badgeColor.bg, fontSize: '0.6875rem', fontWeight: 700, color: badgeColor.color, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{f.badge}</Box>
      </Box>
      <Typography sx={{ fontSize: '1.125rem', fontWeight: 700, color: colors.textStrong, mb: 0.5, letterSpacing: '-0.02em' }}>{f.title}</Typography>
      <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 2 }}>{f.tagline}</Typography>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', flex: 1 }}>
        {f.bullets.map(b => (
          <Box key={b} component="li" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.875, fontSize: '0.875rem', color: colors.textSecondary, lineHeight: 1.5 }}>
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: f.color, flexShrink: 0, mt: '5px' }} />
            {b}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default function FeaturesPage() {
  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: colors.bg }}>
      <Navbar />
      <Box sx={{ pt: `${NAV_H + 64}px`, pb: 12, px: { xs: 3, md: 6 }, maxWidth: 1200, mx: 'auto' }}>
        <Box sx={{ textAlign: 'center', mb: { xs: 6, md: 10 } }}>
          <Pill>Full Feature List</Pill>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2.25rem', md: '3.25rem' }, fontWeight: 800, letterSpacing: '-0.05em', color: colors.textStrong, mt: 2, mb: 1.5 }}>
            Every feature, no surprises
          </Typography>
          <Typography sx={{ fontSize: '1.0625rem', color: colors.textMuted, maxWidth: 560, mx: 'auto', lineHeight: 1.7 }}>
            Prāṅgaṇ ships with everything a construction team needs — from first capture to client handover.
          </Typography>
          <Box sx={{ mt: 3, display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Box component={Link} to="/register" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2.5, py: 1.375, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontWeight: 600, fontSize: '0.9375rem', textDecoration: 'none', boxShadow: shadows.btn, '&:hover': { opacity: 0.9 }, transition: `opacity ${motion.durationFast}` }}>
              Register <ArrowForwardRounded sx={{ fontSize: 16 }} />
            </Box>
            <Box component={Link} to="/pricing" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2.5, py: 1.375, borderRadius: '10px', border: `1.5px solid ${colors.border}`, color: colors.textStrong, fontWeight: 600, fontSize: '0.9375rem', textDecoration: 'none', '&:hover': { borderColor: colors.primary, color: colors.primary }, transition: `all ${motion.durationFast}` }}>
              View pricing
            </Box>
          </Box>
        </Box>

        <Grid container spacing={3}>
          {FEATURES_DETAIL.map(f => (
            <Grid key={f.title} size={{ xs: 12, sm: 6, md: 4 }}>
              <FeatureCard f={f} />
            </Grid>
          ))}
        </Grid>
      </Box>
    </Box>
  );
}
