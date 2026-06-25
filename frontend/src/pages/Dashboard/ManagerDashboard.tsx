import React from 'react';
import { Box, Typography, Grid, Chip } from '@mui/material';
import {
  RateReviewRounded, CheckCircleRounded, AccessTimeRounded,
  ViewInArRounded, BugReportRounded, ArrowForwardRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import PageHeader from '@shared/components/PageHeader/PageHeader';

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  uploaded:  { label: 'Uploaded',  color: '#64748b', bg: 'rgba(100,116,139,0.08)', icon: <AccessTimeRounded sx={{ fontSize: 13 }} /> },
  review:    { label: 'Pending Review', color: '#d97706', bg: 'rgba(217,119,6,0.08)', icon: <RateReviewRounded sx={{ fontSize: 13 }} /> },
  reviewing: { label: 'Reviewing', color: '#d97706', bg: 'rgba(217,119,6,0.08)',   icon: <RateReviewRounded sx={{ fontSize: 13 }} /> },
  processed: { label: 'Reviewed',  color: '#059669', bg: 'rgba(5,150,105,0.08)',   icon: <CheckCircleRounded sx={{ fontSize: 13 }} /> },
  published: { label: 'Published', color: '#2563eb', bg: 'rgba(37,99,235,0.08)',   icon: <ViewInArRounded sx={{ fontSize: 13 }} /> },
};

export default function ManagerDashboard() {
  const user = useAuthStore((s) => s.user);
  const projects  = useWorkflowStore(s => s.projects);
  const captures  = useWorkflowStore(s => s.captures);
  const tours     = useWorkflowStore(s => s.tours);
  const defects   = useWorkflowStore(s => s.defects);

  // Manager sees assigned projects (or all if no filter)
  const assignedIds = new Set(user?.assignedProjectIds ?? []);
  const myProjects = assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived);

  const pendingReviews  = captures.filter(c => c.status === 'review');
  const reviewed        = captures.filter(c => c.status === 'processed');
  const unpublishedTours = tours.filter(t => t.status !== 'published');
  const openDefects      = defects.filter(d => d.status === 'open' || d.status === 'in_progress');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Box>
      <PageHeader
        title={`${greeting}, ${user?.name?.split(' ')[0] ?? 'Manager'}`}
        subtitle="Review queue and project progress"
        breadcrumbs={[{ label: 'Overview' }]}
        actions={
          <Box component={Link} to="/reviews" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, borderRadius: '10px', background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <RateReviewRounded sx={{ fontSize: 18 }} /> Open Reviews
          </Box>
        }
      />

      {/* KPI row */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {[
          { label: 'Pending Reviews', value: String(pendingReviews.length), sub: 'awaiting your action', color: '#d97706', icon: <RateReviewRounded /> },
          { label: 'Reviewed', value: String(reviewed.length), sub: 'captures reviewed', color: '#059669', icon: <CheckCircleRounded /> },
          { label: 'Unpublished Tours', value: String(unpublishedTours.length), sub: 'ready to publish', color: '#2563eb', icon: <ViewInArRounded /> },
          { label: 'Open Defects', value: String(openDefects.length), sub: 'needs attention', color: '#dc2626', icon: <BugReportRounded /> },
        ].map((s) => (
          <Grid key={s.label} size={{ xs: 12, sm: 6, md: 3 }}>
            <Box sx={{ p: 2.5, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
              <Box sx={{ width: 44, height: 44, borderRadius: '12px', backgroundColor: s.color + '14', color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, '& svg': { fontSize: 22 } }}>{s.icon}</Box>
              <Box>
                <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, lineHeight: 1, letterSpacing: '-0.04em' }}>{s.value}</Typography>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSecondary, mt: 0.25 }}>{s.label}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>{s.sub}</Typography>
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        {/* Pending review queue */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>
                Review Queue
                {pendingReviews.length > 0 && (
                  <Box component="span" sx={{ ml: 1, px: 1, py: 0.25, borderRadius: '6px', backgroundColor: 'rgba(217,119,6,0.1)', color: '#d97706', fontSize: '0.75rem', fontWeight: 700 }}>{pendingReviews.length}</Box>
                )}
              </Typography>
              <Box component={Link} to="/reviews" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                See all <ArrowForwardRounded sx={{ fontSize: 14 }} />
              </Box>
            </Box>
            {pendingReviews.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <CheckCircleRounded sx={{ fontSize: 40, color: colors.success, mb: 1 }} />
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textSecondary }}>All clear! No pending reviews.</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {pendingReviews.slice(0, 7).map((c, i) => {
                  const sc = statusConfig[c.status] ?? statusConfig.review;
                  return (
                    <Box key={c.id} component={Link} to={`/captures/${c.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5, borderBottom: i < Math.min(pendingReviews.length, 7) - 1 ? `1px solid ${colors.borderLight}` : 'none', textDecoration: 'none', borderRadius: '8px', mx: -1, px: 1, '&:hover': { backgroundColor: colors.bg } }}>
                      <Box sx={{ width: 36, height: 36, borderRadius: '8px', background: c.gradient, flexShrink: 0 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{c.roomName}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{c.projectName} · {c.floorLabel}</Typography>
                      </Box>
                      <Chip
                        icon={sc.icon as React.ReactElement}
                        label={sc.label}
                        size="small"
                        sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, color: sc.color, backgroundColor: sc.bg, borderRadius: '6px', '& .MuiChip-icon': { color: 'inherit', ml: '6px', mr: '-2px' } }}
                      />
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        </Grid>

        {/* Right column */}
        <Grid size={{ xs: 12, md: 5 }}>
          {/* Assigned projects */}
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, mb: 2.5 }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em', mb: 2 }}>
              Assigned Projects
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {myProjects.slice(0, 4).map(p => (
                <Box key={p.id} component={Link} to={`/projects/${p.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: '10px', border: `1px solid ${colors.border}`, textDecoration: 'none', '&:hover': { borderColor: p.accent + '55', backgroundColor: colors.bg } }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: p.accent, flexShrink: 0 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{p.name}</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{p.towers} towers · {p.progress}% done</Typography>
                  </Box>
                  <ArrowForwardRounded sx={{ fontSize: 16, color: colors.textSubdued }} />
                </Box>
              ))}
            </Box>
          </Box>

          {/* Tours to publish */}
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>Tours Ready</Typography>
              <Box component={Link} to="/tours" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500 }}>All tours →</Box>
            </Box>
            {unpublishedTours.length === 0 ? (
              <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>No tours awaiting publish.</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {unpublishedTours.slice(0, 3).map(t => (
                  <Box key={t.id} component={Link} to={`/tours/${t.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, borderRadius: '8px', border: `1px solid ${colors.border}`, textDecoration: 'none', '&:hover': { backgroundColor: colors.bg } }}>
                    <ViewInArRounded sx={{ fontSize: 18, color: '#2563eb' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textStrong }}>{t.roomName}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{t.projectName}</Typography>
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
