import React from 'react';
import { Box, Typography, Grid, LinearProgress } from '@mui/material';
import {
  FolderRounded, PeopleRounded, CameraAltRounded, RateReviewRounded,
  ViewInArRounded, BugReportRounded, AddRounded,
  WarningAmberRounded, CheckCircleRounded, AccessTimeRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { computeDashboardStats } from '@store/workflowSelectors';
import PageHeader from '@shared/components/PageHeader/PageHeader';

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub: string; color: string; icon: React.ReactNode }) {
  return (
    <Box sx={{ p: 2.5, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
      <Box sx={{ width: 44, height: 44, borderRadius: '12px', backgroundColor: color + '14', color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, '& svg': { fontSize: 22 } }}>
        {icon}
      </Box>
      <Box>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, lineHeight: 1, letterSpacing: '-0.04em' }}>{value}</Typography>
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSecondary, mt: 0.25 }}>{label}</Typography>
        <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>{sub}</Typography>
      </Box>
    </Box>
  );
}

function ActionCard({ label, desc, path, color, icon }: { label: string; desc: string; path: string; color: string; icon: React.ReactNode }) {
  return (
    <Box component={Link} to={path} sx={{ p: 2.5, borderRadius: '14px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2, transition: `all ${motion.durationFast}`, '&:hover': { borderColor: color + '55', transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(15,23,42,0.07)' } }}>
      <Box sx={{ width: 38, height: 38, borderRadius: '10px', backgroundColor: color + '12', color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, '& svg': { fontSize: 18 } }}>
        {icon}
      </Box>
      <Box>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{label}</Typography>
        <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{desc}</Typography>
      </Box>
    </Box>
  );
}

export default function AdminDashboard() {
  const user = useAuthStore((s) => s.user);
  const projects = useWorkflowStore(s => s.projects);
  const captures = useWorkflowStore(s => s.captures);
  const tours    = useWorkflowStore(s => s.tours);
  const towers   = useWorkflowStore(s => s.towers);
  const floors   = useWorkflowStore(s => s.floors);
  const flats    = useWorkflowStore(s => s.flats);
  const rooms    = useWorkflowStore(s => s.rooms);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const defects    = useWorkflowStore(s => s.defects);
  const notifications = useWorkflowStore(s => s.notifications);
  const users      = useWorkflowStore(s => s.users);
  const auditLogs  = useWorkflowStore(s => s.auditLogs);

  const stats = computeDashboardStats({ projects, towers, floors, flats, rooms, captures, tours, floorPlans, defects, notifications, auditLogs, users });
  const activeProjects = projects.filter(p => !p.archived);
  const pendingCaptures = captures.filter(c => c.status === 'review');
  const openDefects = defects.filter(d => d.status === 'open' || d.status === 'in_progress');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Box>
      <PageHeader
        title={`${greeting}, ${user?.name?.split(' ')[0] ?? 'Admin'}`}
        subtitle="Platform overview — all projects and teams"
        breadcrumbs={[{ label: 'Overview' }]}
        actions={
          <Box component={Link} to="/projects/new" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <AddRounded sx={{ fontSize: 18 }} /> New Project
          </Box>
        }
      />

      {/* KPI Stats */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {[
          { label: 'Projects', value: String(stats.projectCount), sub: `${stats.activeProjectCount} active`, color: colors.primary, icon: <FolderRounded /> },
          { label: 'Team Members', value: String(users.length), sub: 'across all roles', color: '#7c3aed', icon: <PeopleRounded /> },
          { label: 'Captures', value: String(stats.captureCount), sub: `${stats.pendingReviews} pending review`, color: '#0891b2', icon: <CameraAltRounded /> },
          { label: 'Published Tours', value: String(stats.publishedTourCount), sub: `of ${stats.tourCount} total`, color: '#059669', icon: <ViewInArRounded /> },
          { label: 'Open Defects', value: String(stats.defectOpenCount), sub: 'needs resolution', color: '#d97706', icon: <BugReportRounded /> },
          { label: 'Pending Reviews', value: String(stats.pendingReviews), sub: 'awaiting manager', color: '#dc2626', icon: <RateReviewRounded /> },
        ].map((s) => (
          <Grid key={s.label} size={{ xs: 12, sm: 6, md: 4 }}>
            <StatCard {...s} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        {/* Project Progress */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>Project Progress</Typography>
              <Box component={Link} to="/projects" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500 }}>View all →</Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {activeProjects.slice(0, 5).map(p => (
                <Box key={p.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: p.accent }} />
                      <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{p.name}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, fontWeight: 600 }}>{p.progress}%</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={p.progress} sx={{ height: 6, borderRadius: 3, backgroundColor: colors.bgDeep, '& .MuiLinearProgress-bar': { borderRadius: 3, backgroundColor: p.accent } }} />
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, mt: 0.5 }}>{p.captures} captures · {p.towers} towers</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Grid>

        {/* Quick Actions */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, mb: 2.5 }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em', mb: 2 }}>Quick Actions</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <ActionCard label="Manage Users" desc="Create, edit, assign roles" path="/users" color="#2563eb" icon={<PeopleRounded />} />
              <ActionCard label="Review Captures" desc={`${pendingCaptures.length} awaiting review`} path="/captures" color="#d97706" icon={<RateReviewRounded />} />
              <ActionCard label="Analytics" desc="KPIs and team metrics" path="/analytics" color="#059669" icon={<BugReportRounded />} />
            </Box>
          </Box>

          {/* Alerts */}
          {(pendingCaptures.length > 0 || openDefects.length > 0) && (
            <Box sx={{ p: 2.5, borderRadius: '14px', border: `1px solid ${colors.warning}30`, backgroundColor: colors.warningBg }}>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: '#92400e', mb: 1.25 }}>Needs Attention</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {pendingCaptures.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AccessTimeRounded sx={{ fontSize: 14, color: colors.warning }} />
                    <Typography sx={{ fontSize: '0.8125rem', color: '#92400e' }}>{pendingCaptures.length} captures pending review</Typography>
                  </Box>
                )}
                {openDefects.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <WarningAmberRounded sx={{ fontSize: 14, color: colors.danger }} />
                    <Typography sx={{ fontSize: '0.8125rem', color: '#92400e' }}>{openDefects.length} open defects</Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Grid>

        {/* Recent Captures */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>Recent Captures</Typography>
              <Box component={Link} to="/captures" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500 }}>View all →</Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {captures.slice(0, 6).map((c, i) => {
                const statusIcon = c.status === 'processed'
                  ? <CheckCircleRounded sx={{ fontSize: 14, color: colors.success }} />
                  : c.status === 'review'
                  ? <AccessTimeRounded sx={{ fontSize: 14, color: colors.warning }} />
                  : <WarningAmberRounded sx={{ fontSize: 14, color: colors.danger }} />;
                return (
                  <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.25, borderBottom: i < captures.slice(0, 6).length - 1 ? `1px solid ${colors.borderLight}` : 'none' }}>
                    <Box sx={{ width: 36, height: 36, borderRadius: '8px', background: c.gradient, flexShrink: 0 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{c.roomName}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{c.projectName} · {c.floorLabel}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {statusIcon}
                      <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, textTransform: 'capitalize' }}>{c.status}</Typography>
                    </Box>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued, flexShrink: 0 }}>{c.uploadedAt}</Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
