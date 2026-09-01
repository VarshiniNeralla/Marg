import { useState } from 'react';
import { Box, Typography, Grid, Pagination, Alert, Button } from '@mui/material';
import {
  RateReviewRounded, CheckCircleRounded, CameraAltRounded,
  ViewInArRounded, ArrowForwardRounded, RefreshRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { computeDashboardStats } from '@store/workflowSelectors';
import DashboardHero from '@shared/components/DashboardHero/DashboardHero';

const TOURS_PAGE_SIZE = 5;

export default function ManagerDashboard() {
  const user      = useAuthStore((s) => s.user);
  const projects  = useWorkflowStore(s => s.projects);
  const towers    = useWorkflowStore(s => s.towers);
  const floors    = useWorkflowStore(s => s.floors);
  const flats     = useWorkflowStore(s => s.flats);
  const rooms     = useWorkflowStore(s => s.rooms);
  const captures  = useWorkflowStore(s => s.captures);
  const tours     = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const defects    = useWorkflowStore(s => s.defects);
  const notifications = useWorkflowStore(s => s.notifications);
  const auditLogs  = useWorkflowStore(s => s.auditLogs);
  const apiSnapshotError = useWorkflowStore(s => s.apiSnapshotError);
  const apiSnapshotStatus = useWorkflowStore(s => s.apiSnapshotStatus);
  const retryApiSnapshot = useWorkflowStore(s => s.retryApiSnapshot);
  const [toursPage, setToursPage] = useState(1);
  const snapshotLoading = apiSnapshotStatus === 'loading' || apiSnapshotStatus === 'idle';

  // Same shared aggregation Admin's dashboard uses, so "Total Captures" /
  // "Published Tours" can never drift between the two roles' views of the
  // identical underlying data.
  const stats = computeDashboardStats({ projects, towers, floors, flats, rooms, captures, tours, floorPlans, defects, notifications, auditLogs, users: [] });

  // Manager-only breakdown of the published set — no Admin-side equivalent to unify with.
  const pendingReviews = tours.filter(t => t.status === 'published' && !t.managerReviewed).length;
  const reviewedCount  = tours.filter(t => t.status === 'published' && t.managerReviewed).length;
  const publishedTours = tours.filter(t => t.status === 'published');
  const toursTotalPages = Math.max(1, Math.ceil(publishedTours.length / TOURS_PAGE_SIZE));
  const paginatedTours = publishedTours.slice(
    (toursPage - 1) * TOURS_PAGE_SIZE,
    toursPage * TOURS_PAGE_SIZE,
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const fmt = (n: number) => (snapshotLoading ? '…' : String(n));

  const kpis = [
    {
      label: 'Pending Reviews',
      value: fmt(pendingReviews),
      sub: snapshotLoading ? 'loading workspace…' : 'awaiting your action',
      color: '#d97706',
      bg: 'rgba(217,119,6,0.08)',
      icon: <RateReviewRounded />,
      to: { pathname: '/reviews', state: { tab: 'pending' } },
    },
    {
      label: 'Reviewed',
      value: fmt(reviewedCount),
      sub: snapshotLoading ? 'loading workspace…' : 'marked as done',
      color: '#059669',
      bg: 'rgba(5,150,105,0.08)',
      icon: <CheckCircleRounded />,
      to: { pathname: '/reviews', state: { tab: 'reviewed' } },
    },
    {
      label: 'Published Tours',
      value: fmt(stats.publishedTourCount),
      sub: snapshotLoading ? 'loading workspace…' : 'live for clients',
      color: '#2563eb',
      bg: 'rgba(37,99,235,0.08)',
      icon: <ViewInArRounded />,
      to: '/tours',
    },
    {
      label: 'Total Captures',
      value: fmt(stats.captureCount),
      sub: snapshotLoading ? 'loading workspace…' : 'across all projects',
      color: '#7c3aed',
      bg: 'rgba(124,58,237,0.08)',
      icon: <CameraAltRounded />,
      to: '/captures',
    },
  ];

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {apiSnapshotError && (
        <Alert
          severity="error"
          sx={{ mb: 2.5, borderRadius: '12px', alignItems: 'center' }}
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshRounded sx={{ fontSize: 16 }} />}
              onClick={() => retryApiSnapshot()}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Retry
            </Button>
          }
        >
          Could not load live workspace data. Stats below may be stale or empty. {apiSnapshotError}
        </Alert>
      )}
      <DashboardHero
        eyebrow="My Overview"
        greeting={`${greeting}, ${user?.name?.split(' ')[0] ?? 'Manager'}`}
        subtitle="Review queue and project progress"
        ctaLabel="Open Reviews"
        ctaIcon={<RateReviewRounded sx={{ fontSize: 19 }} />}
        ctaTo="/reviews"
        accent="#7c3aed"
        accentHover="#6d28d9"
      />

      {/* KPI row */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {kpis.map((s) => (
          <Grid key={s.label} size={{ xs: 6, sm: 6, md: 3 }}>
            <Box
              component={Link}
              to={s.to}
              sx={{
                position: 'relative', overflow: 'hidden',
                p: { xs: 2, sm: 2.25 }, borderRadius: '16px',
                border: `1px solid ${colors.borderLight}`,
                backgroundColor: colors.card,
                textDecoration: 'none', display: 'block',
                transition: `box-shadow 150ms, transform 150ms`,
                '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' },
              }}
            >
              {/* top accent bar */}
              <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0', backgroundColor: s.color, opacity: 0.7 }} />
              <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: s.bg, color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1.5, '& svg': { fontSize: 18 } }}>
                {s.icon}
              </Box>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textMuted, mb: 0.375 }}>{s.label}</Typography>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, lineHeight: 1, letterSpacing: '-0.03em' }}>{s.value}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.375 }}>{s.sub}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        {/* Published Tours — full width, top priority */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ p: { xs: 2, sm: 3 }, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>
                Published Tours
              </Typography>
              <Box component={Link} to="/tours" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5, '&:hover': { opacity: 0.75 } }}>
                All tours <ArrowForwardRounded sx={{ fontSize: 14 }} />
              </Box>
            </Box>

            {publishedTours.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <ViewInArRounded sx={{ fontSize: 36, color: colors.textSubdued, mb: 0.75 }} />
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>No published tours yet.</Typography>
              </Box>
            ) : (
              <>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {paginatedTours.map(t => (
                    <Box
                      key={t.id}
                      component={Link}
                      to={`/tours/${t.id}`}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1.5,
                        p: { xs: 1.25, sm: 1.5 }, borderRadius: '12px',
                        border: `1px solid ${colors.borderLight}`,
                        textDecoration: 'none', width: '100%',
                        '&:hover': { backgroundColor: colors.bg, borderColor: colors.border },
                        transition: `background ${motion.durationFast}, border-color ${motion.durationFast}`,
                      }}
                    >
                      <Box sx={{ width: 42, height: 42, borderRadius: '10px', background: t.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ViewInArRounded sx={{ fontSize: 18, color: 'rgba(255,255,255,0.85)' }} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{t.roomName}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{t.towerName} · {t.floorLabel}</Typography>
                      </Box>
                      <Box sx={{ px: 1.25, py: 0.375, borderRadius: '6px', backgroundColor: 'rgba(37,99,235,0.08)', color: '#2563eb', fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0 }}>
                        Live
                      </Box>
                    </Box>
                  ))}
                </Box>
                {toursTotalPages > 1 && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2.5 }}>
                    <Pagination
                      count={toursTotalPages}
                      page={toursPage}
                      onChange={(_, p) => setToursPage(p)}
                      color="primary"
                      size="small"
                      sx={{ '& .MuiPaginationItem-root': { fontWeight: 600 } }}
                    />
                  </Box>
                )}
              </>
            )}
          </Box>
        </Grid>

      </Grid>
    </Box>
  );
}
