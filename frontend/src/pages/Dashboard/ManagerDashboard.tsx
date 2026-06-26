import React from 'react';
import { Box, Typography, Grid, LinearProgress } from '@mui/material';
import {
  RateReviewRounded, CheckCircleRounded, CameraAltRounded,
  ViewInArRounded, ArrowForwardRounded, FolderOpenRounded
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import PageHeader from '@shared/components/PageHeader/PageHeader';

export default function ManagerDashboard() {
  const user      = useAuthStore((s) => s.user);
  const projects  = useWorkflowStore(s => s.projects);
  const captures  = useWorkflowStore(s => s.captures);
  const tours     = useWorkflowStore(s => s.tours);

  const assignedIds = new Set(user?.assignedProjectIds ?? []);
  const myProjects = (assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived)
  );

  const pendingReviews = captures.filter(c => c.status === 'review');
  const reviewed       = captures.filter(c => c.status === 'processed');
  const publishedTours = tours.filter(t => t.status === 'published');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const kpis = [
    {
      label: 'Pending Reviews',
      value: pendingReviews.length,
      sub: 'awaiting your action',
      color: '#d97706',
      bg: 'rgba(217,119,6,0.08)',
      icon: <RateReviewRounded />,
      to: '/reviews',
    },
    {
      label: 'Reviewed',
      value: reviewed.length,
      sub: 'captures processed',
      color: '#059669',
      bg: 'rgba(5,150,105,0.08)',
      icon: <CheckCircleRounded />,
      to: '/captures',
    },
    {
      label: 'Published Tours',
      value: publishedTours.length,
      sub: 'live for clients',
      color: '#2563eb',
      bg: 'rgba(37,99,235,0.08)',
      icon: <ViewInArRounded />,
      to: '/tours',
    },
    {
      label: 'Total Captures',
      value: captures.length,
      sub: 'across all projects',
      color: '#7c3aed',
      bg: 'rgba(124,58,237,0.08)',
      icon: <CameraAltRounded />,
      to: '/captures',
    },
  ];

  return (
    <Box>
      <PageHeader
        title={`${greeting}, ${user?.name?.split(' ')[0] ?? 'Manager'}`}
        subtitle="Review queue and project progress"
        breadcrumbs={[{ label: 'Overview' }]}
        actions={
          <Box
            component={Link}
            to="/reviews"
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.75,
              px: 2.5, py: 1, borderRadius: '10px',
              background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
              color: '#fff', fontSize: '0.875rem', fontWeight: 600,
              textDecoration: 'none', boxShadow: '0 4px 14px rgba(124,58,237,0.28)',
            }}
          >
            <RateReviewRounded sx={{ fontSize: 17 }} /> Open Reviews
          </Box>
        }
      />

      {/* KPI row */}
      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        {kpis.map((s) => (
          <Grid key={s.label} size={{ xs: 12, sm: 6, lg: 3 }}>
            <Box
              component={Link}
              to={s.to}
              sx={{
                display: 'flex', flexDirection: 'column',
                p: 2.5, borderRadius: '16px',
                border: `1px solid ${colors.borderLight}`,
                backgroundColor: colors.card,
                textDecoration: 'none',
                transition: `transform ${motion.durationFast} ${motion.easeOut}, box-shadow ${motion.durationFast}`,
                '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 4px 12px rgba(0,0,0,0.05)` },
              }}
            >
              <Box sx={{ width: 38, height: 38, borderRadius: '10px', backgroundColor: s.bg, color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2, '& svg': { fontSize: 20 } }}>
                {s.icon}
              </Box>
              <Typography sx={{ fontSize: '1.875rem', fontWeight: 800, color: colors.textStrong, lineHeight: 1, letterSpacing: '-0.04em', mb: 0.5 }}>
                {s.value}
              </Typography>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textSecondary }}>{s.label}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>{s.sub}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        {/* Pending review queue */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>
                  Review Queue
                </Typography>
                {pendingReviews.length > 0 && (
                  <Box sx={{ px: 1, py: 0.25, borderRadius: '6px', backgroundColor: 'rgba(217,119,6,0.1)', color: '#d97706', fontSize: '0.75rem', fontWeight: 700 }}>
                    {pendingReviews.length}
                  </Box>
                )}
              </Box>
              <Box component={Link} to="/reviews" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5, '&:hover': { opacity: 0.75 } }}>
                See all <ArrowForwardRounded sx={{ fontSize: 14 }} />
              </Box>
            </Box>

            {pendingReviews.length === 0 ? (
              <Box sx={{ py: 5, textAlign: 'center' }}>
                <CheckCircleRounded sx={{ fontSize: 44, color: colors.success, mb: 1 }} />
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textSecondary }}>All clear — no pending reviews.</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mt: 0.5 }}>New uploads will appear here.</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', maxHeight: 300, overflowY: 'auto', pr: 1, '&::-webkit-scrollbar': { width: '6px' }, '&::-webkit-scrollbar-thumb': { backgroundColor: colors.border, borderRadius: '4px' } }}>
                {pendingReviews.map((c, i) => (
                  <Box
                    key={c.id}
                    component={Link}
                    to={`/captures/${c.id}`}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 2,
                      py: 1.5, px: 1.5, borderRadius: '10px',
                      borderBottom: i < pendingReviews.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
                      textDecoration: 'none',
                      '&:hover': { backgroundColor: colors.bg },
                      transition: `background ${motion.durationFast}`,
                    }}
                  >
                    <Box sx={{ width: 38, height: 38, borderRadius: '9px', background: c.gradient, flexShrink: 0 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{c.roomName}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{c.towerName} · {c.floorLabel} · {c.uploadedAt}</Typography>
                    </Box>
                    <Box sx={{ px: 1.25, py: 0.375, borderRadius: '6px', backgroundColor: 'rgba(217,119,6,0.08)', color: '#d97706', fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0 }}>
                      Pending
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Grid>

        {/* Right column */}
        <Grid size={{ xs: 12, md: 5 }}>
          {/* Projects */}
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.borderLight}`, backgroundColor: colors.card, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>
                Projects
              </Typography>
              <Box component={Link} to="/projects" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500, '&:hover': { opacity: 0.75 } }}>
                All projects →
              </Box>
            </Box>

            {myProjects.length === 0 ? (
              <Box sx={{ py: 3, textAlign: 'center' }}>
                <FolderOpenRounded sx={{ fontSize: 36, color: colors.textSubdued, mb: 0.75 }} />
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>No projects assigned yet.</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {myProjects.slice(0, 4).map(p => (
                  <Box
                    key={p.id}
                    component={Link}
                    to={`/projects/${p.id}`}
                    sx={{
                      p: 1.75, borderRadius: '12px', border: `1px solid ${colors.borderLight}`,
                      textDecoration: 'none', backgroundColor: colors.bg,
                      transition: `border-color ${motion.durationFast}`,
                      '&:hover': { borderColor: p.accent + '60' },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: p.accent, flexShrink: 0 }} />
                      <Typography noWrap sx={{ flex: 1, fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>
                        {p.name}
                      </Typography>
                      <ArrowForwardRounded sx={{ fontSize: 14, color: colors.textSubdued }} />
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          {/* Published Tours */}
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>
                Published Tours
              </Typography>
              <Box component={Link} to="/tours" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500, '&:hover': { opacity: 0.75 } }}>
                All tours →
              </Box>
            </Box>

            {publishedTours.length === 0 ? (
              <Box sx={{ py: 3, textAlign: 'center' }}>
                <ViewInArRounded sx={{ fontSize: 36, color: colors.textSubdued, mb: 0.75 }} />
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>No published tours yet.</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {publishedTours.slice(0, 4).map(t => (
                  <Box
                    key={t.id}
                    component={Link}
                    to={`/tours/${t.id}`}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      p: 1.25, borderRadius: '10px',
                      border: `1px solid ${colors.borderLight}`,
                      textDecoration: 'none',
                      '&:hover': { backgroundColor: colors.bg },
                      transition: `background ${motion.durationFast}`,
                    }}
                  >
                    <Box sx={{ width: 32, height: 32, borderRadius: '8px', background: t.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ViewInArRounded sx={{ fontSize: 15, color: 'rgba(255,255,255,0.8)' }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>{t.roomName}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{t.towerName} · {t.floorLabel}</Typography>
                    </Box>
                    <Box sx={{ px: 1, py: 0.25, borderRadius: '5px', backgroundColor: 'rgba(37,99,235,0.08)', color: '#2563eb', fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0 }}>
                      Live
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
