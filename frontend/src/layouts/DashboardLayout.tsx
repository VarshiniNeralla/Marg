import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Box, IconButton, Avatar, Menu, MenuItem, Divider, Typography, Drawer, useMediaQuery, Chip,
} from '@mui/material';
import {
  GridViewRounded, FolderOpenRounded, CameraAltRounded, ViewInArRounded,
  MapRounded, BarChartRounded, PeopleRounded, TuneRounded,
  VpnKeyRounded, LogoutRounded, PersonRounded, MenuRounded, BugReportRounded,
  CloudUploadRounded, StorageRounded, RateReviewRounded,
  EngineeringRounded, ManageAccountsRounded, AdminPanelSettingsRounded,
  QueueRounded, PhotoCameraRounded,
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { colors, motion, zIndex } from '@theme/tokens';
import { useAuthStore, isAdmin, isManager, isFieldEngineer, getRoleLabel } from '@store/authStore';
import { authService } from '@features/auth/services/authService';
import NotificationCenter from '@/shared/components/NotificationCenter/NotificationCenter';
import GlobalSearch from '@/shared/components/GlobalSearch/GlobalSearch';

const SIDEBAR_W = 224;
const NAV_H = 56;

interface NavItem { label: string; path: string; icon: React.ReactNode; }
interface NavSection { heading: string; items: NavItem[]; }

// ── Navigation definitions per role ───────────────────────────────────────────

const ADMIN_NAV: NavSection[] = [
  {
    heading: 'Overview',
    items: [
      { label: 'Overview', path: '/dashboard/admin', icon: <GridViewRounded /> },
    ],
  },
  {
    heading: 'Projects',
    items: [
      { label: 'Projects',    path: '/projects',    icon: <FolderOpenRounded /> },
      { label: 'Floor Plans', path: '/floor-plans', icon: <MapRounded /> },
      { label: 'Captures',   path: '/captures',    icon: <CameraAltRounded /> },
      { label: 'Tours',       path: '/tours',       icon: <ViewInArRounded /> },
      { label: 'Defects',     path: '/defects',     icon: <BugReportRounded /> },
      { label: 'Analytics',   path: '/analytics',   icon: <BarChartRounded /> },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Users',    path: '/users',    icon: <PeopleRounded /> },
      { label: 'Access',   path: '/access',   icon: <VpnKeyRounded /> },
      { label: 'Media',         path: '/admin/media',   icon: <StorageRounded /> },
      { label: 'Settings',      path: '/settings',      icon: <TuneRounded /> },
    ],
  },
];

const MANAGER_NAV: NavSection[] = [
  {
    heading: 'Overview',
    items: [
      { label: 'Overview', path: '/dashboard/manager', icon: <GridViewRounded /> },
    ],
  },
  {
    heading: 'Review',
    items: [
      { label: 'Reviews',     path: '/reviews',   icon: <RateReviewRounded /> },
      { label: 'Captures',   path: '/captures',  icon: <CameraAltRounded /> },
      { label: 'Virtual Tours', path: '/tours',  icon: <ViewInArRounded /> },
    ],
  },
  {
    heading: 'Monitor',
    items: [
      { label: 'Projects',    path: '/projects',    icon: <FolderOpenRounded /> },
      { label: 'Floor Plans', path: '/floor-plans', icon: <MapRounded /> },
      { label: 'Analytics',   path: '/analytics',   icon: <BarChartRounded /> },
      { label: 'Defects',     path: '/defects',     icon: <BugReportRounded /> },
    ],
  },
];

const ENGINEER_NAV: NavSection[] = [
  {
    heading: 'Overview',
    items: [
      { label: 'My Overview', path: '/dashboard/engineer', icon: <GridViewRounded /> },
    ],
  },
  {
    heading: 'Capture',
    items: [
      { label: 'Capture Workflow', path: '/capture-workflow', icon: <PhotoCameraRounded /> },
      { label: 'Upload Queue',     path: '/upload-queue',     icon: <QueueRounded /> },
      { label: 'My Captures',      path: '/my-captures',      icon: <CameraAltRounded /> },
    ],
  },
  {
    heading: 'View',
    items: [
      { label: 'Floor Plans', path: '/floor-plans', icon: <MapRounded /> },
    ],
  },
];

// ── Role badge color ───────────────────────────────────────────────────────────

function roleBadge(role: string | undefined) {
  if (!role) return { color: '#64748b', bg: 'rgba(100,116,139,0.1)', label: 'User' };
  if (role === 'admin' || role === 'super_admin') return { color: '#2563eb', bg: 'rgba(37,99,235,0.08)', label: 'Admin' };
  if (role === 'manager')      return { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', label: 'Manager' };
  if (role === 'field_engineer') return { color: '#059669', bg: 'rgba(5,150,105,0.08)', label: 'Field Engineer' };
  return { color: '#64748b', bg: 'rgba(100,116,139,0.1)', label: role };
}

export default function DashboardLayout() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const location = useLocation();

  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarAnchor, setAvatarAnchor] = useState<null | HTMLElement>(null);

  // Pick nav sections based on role
  const navSections: NavSection[] =
    isAdmin(user)         ? ADMIN_NAV :
    isManager(user)       ? MANAGER_NAV :
    isFieldEngineer(user) ? ENGINEER_NAV :
    ADMIN_NAV;

  const badge = roleBadge(user?.role);

  async function handleLogout() {
    try { await authService.logout(); } catch { /* ignore */ }
    clearAuth();
    navigate('/login');
  }

  function active(path: string) {
    if (path.endsWith('/admin') || path.endsWith('/manager') || path.endsWith('/engineer')) {
      return location.pathname === path;
    }
    return location.pathname === path || location.pathname.startsWith(path + '/');
  }

  function NavLink({ item }: { item: NavItem }) {
    const on = active(item.path);
    return (
      <Box
        component={Link}
        to={item.path}
        onClick={() => isMobile && setMobileOpen(false)}
        title={item.label}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.875,
          borderRadius: '10px', textDecoration: 'none',
          color: on ? colors.textStrong : colors.textMuted,
          backgroundColor: on ? colors.bg : 'transparent',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { color: colors.textStrong, backgroundColor: colors.bg },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: on ? colors.primary : 'inherit', '& svg': { fontSize: 18 } }}>
          {item.icon}
        </Box>
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: on ? 600 : 400, letterSpacing: on ? '-0.01em' : 0, lineHeight: 1, color: 'inherit' }}>
          {item.label}
        </Typography>
        {on && <Box sx={{ ml: 'auto', width: 4, height: 4, borderRadius: '50%', backgroundColor: colors.primary, flexShrink: 0 }} />}
      </Box>
    );
  }

  function SidebarInner() {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', py: 1.5, px: 1.5 }}>
        {/* Wordmark */}
        <Box sx={{ px: 0.5, pt: 0.5, pb: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box component="img" src="/assets/new_logo.png" alt="My Home Constructions" sx={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
            <Box>
              <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontWeight: 700, fontSize: '0.875rem', color: colors.textStrong, letterSpacing: '-0.025em', lineHeight: 1.1 }}>Horizon</Typography>
              <Typography sx={{ fontSize: '0.625rem', color: colors.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 }}>by SiteSureLabs</Typography>
            </Box>
          </Box>
        </Box>

        {/* Role badge pill */}
        <Box sx={{ mb: 2, px: 0.5 }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: '8px', backgroundColor: badge.bg }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: badge.color }} />
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: badge.color, letterSpacing: '0.02em' }}>
              {badge.label}
            </Typography>
          </Box>
        </Box>

        {/* Nav sections */}
        <Box sx={{ flex: 1, overflow: 'hidden auto', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {navSections.map((section) => (
            <Box key={section.heading}>
              <Typography sx={{ px: 1.5, mb: 0.75, fontSize: '0.625rem', fontWeight: 600, color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {section.heading}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {section.items.map((item) => <NavLink key={item.path} item={item} />)}
              </Box>
            </Box>
          ))}
        </Box>

        {/* User pill */}
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 1, borderRadius: '10px', backgroundColor: colors.bg, cursor: 'pointer', mt: 1.5, '&:hover': { backgroundColor: colors.bgDeep }, transition: `background ${motion.durationFast} ${motion.easeOut}` }}
          onClick={(e) => setAvatarAnchor(e.currentTarget as HTMLElement)}
        >
          <Avatar src={user?.avatar_url ?? undefined} sx={{ width: 28, height: 28, fontSize: '0.6875rem', fontWeight: 700, bgcolor: colors.ink, flexShrink: 0 }}>
            {user?.name?.[0]?.toUpperCase()}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textStrong, lineHeight: 1.2 }}>{user?.name}</Typography>
            <Typography noWrap sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>{user?.org_name}</Typography>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: colors.bg }}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <Box sx={{ width: SIDEBAR_W, flexShrink: 0 }}>
          <Box component="nav" sx={{ position: 'fixed', top: 0, left: 0, width: SIDEBAR_W, height: '100vh', backgroundColor: colors.card, boxShadow: '1px 0 0 rgba(15,23,42,0.05)', zIndex: zIndex.sidebar, overflow: 'hidden auto' }}>
            <SidebarInner />
          </Box>
        </Box>
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} slotProps={{ paper: { sx: { width: SIDEBAR_W, backgroundColor: colors.card, boxShadow: 'none', border: 'none' } } }}>
          <SidebarInner />
        </Drawer>
      )}

      {/* Main content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <Box sx={{ height: NAV_H, display: 'flex', alignItems: 'center', px: { xs: 2, md: 4, lg: 5 }, gap: 1.5, backgroundColor: colors.navBg, backdropFilter: 'blur(20px) saturate(180%)', position: 'sticky', top: 0, zIndex: zIndex.nav, boxShadow: '0 1px 0 rgba(15,23,42,0.06)' }}>
          {isMobile && (
            <IconButton size="small" onClick={() => setMobileOpen(true)} sx={{ color: colors.textMuted, mr: 0.5 }}>
              <MenuRounded />
            </IconButton>
          )}
          <GlobalSearch />
          <Box sx={{ flex: 1 }} />

          {/* Capture shortcut — only for Field Engineer */}
          {isFieldEngineer(user) && (
            <Box
              component={Link}
              to="/capture-workflow"
              sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.75, px: 1.5, py: 0.625, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, color: colors.textSecondary, fontSize: '0.8125rem', fontWeight: 500, textDecoration: 'none', '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft } }}
            >
              <CloudUploadRounded sx={{ fontSize: 15 }} />
              Capture
            </Box>
          )}

          {/* Manager: quick review link */}
          {isManager(user) && (
            <Box
              component={Link}
              to="/reviews"
              sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.75, px: 1.5, py: 0.625, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, color: colors.textSecondary, fontSize: '0.8125rem', fontWeight: 500, textDecoration: 'none', '&:hover': { borderColor: '#7c3aed', color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.05)' } }}
            >
              <RateReviewRounded sx={{ fontSize: 15 }} /> Reviews
            </Box>
          )}

          <NotificationCenter />

          <IconButton size="small" onClick={(e) => setAvatarAnchor(e.currentTarget)} sx={{ p: '3px', borderRadius: '8px' }}>
            <Avatar src={user?.avatar_url ?? undefined} sx={{ width: 28, height: 28, fontSize: '0.75rem', bgcolor: colors.ink }}>
              {user?.name?.[0]?.toUpperCase()}
            </Avatar>
          </IconButton>
        </Box>

        {/* Page */}
        <Box
          component="main"
          key={location.pathname}
          sx={{
            flex: 1, width: '100%', maxWidth: 1280, mx: 'auto',
            px: { xs: 2, md: 4, lg: 5 }, py: { xs: 3, md: 5 },
            animation: 'pageFadeIn 200ms ease-out',
            '@keyframes pageFadeIn': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
          }}
        >
          <Outlet />
        </Box>
      </Box>

      {/* Account menu */}
      <Menu
        anchorEl={avatarAnchor}
        open={Boolean(avatarAnchor)}
        onClose={() => setAvatarAnchor(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{ paper: { sx: { minWidth: 220, mt: 0.5, borderRadius: '14px', border: `1px solid ${colors.border}`, boxShadow: '0 20px 48px rgba(15,23,42,0.10)', overflow: 'hidden' } } }}
      >
        <Box sx={{ px: 2, pt: 1.75, pb: 1.25 }}>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{user?.name}</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.125 }}>{user?.email}</Typography>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.75, px: 1, py: 0.25, borderRadius: '6px', backgroundColor: badge.bg }}>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: badge.color }}>{badge.label}</Typography>
          </Box>
        </Box>
        <Divider sx={{ borderColor: colors.border }} />
        <Box sx={{ p: 0.75 }}>
          <MenuItem onClick={() => { setAvatarAnchor(null); navigate('/profile'); }} sx={{ gap: 1.5, py: 0.875, borderRadius: '8px', '&:hover': { backgroundColor: colors.bg } }}>
            <PersonRounded sx={{ fontSize: 16, color: colors.textMuted }} />
            <Typography sx={{ fontSize: '0.875rem', color: colors.textSecondary }}>Profile</Typography>
          </MenuItem>
          {isAdmin(user) && (
            <MenuItem onClick={() => { setAvatarAnchor(null); navigate('/settings'); }} sx={{ gap: 1.5, py: 0.875, borderRadius: '8px', '&:hover': { backgroundColor: colors.bg } }}>
              <TuneRounded sx={{ fontSize: 16, color: colors.textMuted }} />
              <Typography sx={{ fontSize: '0.875rem', color: colors.textSecondary }}>Settings</Typography>
            </MenuItem>
          )}
          <Divider sx={{ borderColor: colors.borderLight, my: 0.5 }} />
          <MenuItem onClick={handleLogout} sx={{ gap: 1.5, py: 0.875, borderRadius: '8px', '&:hover': { backgroundColor: colors.dangerBg }, color: colors.danger }}>
            <LogoutRounded sx={{ fontSize: 16 }} />
            <Typography sx={{ fontSize: '0.875rem' }}>Sign out</Typography>
          </MenuItem>
        </Box>
      </Menu>
    </Box>
  );
}
