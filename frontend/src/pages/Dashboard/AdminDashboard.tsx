import React, { useEffect, useState } from 'react';
import { Box, Typography, Grid } from '@mui/material';
import {
  FolderRounded, PeopleRounded, CameraAltRounded, RateReviewRounded,
  ViewInArRounded, AddRounded, MapRounded, BarChartRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { computeDashboardStats } from '@store/workflowSelectors';
import PageHeader from '@shared/components/PageHeader/PageHeader';
import { userService } from '@services/userService';

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
  const auditLogs  = useWorkflowStore(s => s.auditLogs);

  const [realUserCount, setRealUserCount] = useState<number | null>(null);

  useEffect(() => {
    userService.listUsers({ limit: 1 })
      .then(res => setRealUserCount(res.total ?? res.items?.length ?? null))
      .catch(() => setRealUserCount(null));
  }, []);

  const stats = computeDashboardStats({ projects, towers, floors, flats, rooms, captures, tours, floorPlans, defects, notifications, auditLogs, users: [] });
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
          { label: 'Projects',        value: String(stats.projectCount),       sub: `${stats.activeProjectCount} active`,    color: colors.primary, icon: <FolderRounded /> },
          { label: 'Team Members',    value: realUserCount !== null ? String(realUserCount) : '—', sub: 'across all roles', color: '#7c3aed', icon: <PeopleRounded /> },
          { label: 'Captures',        value: String(stats.captureCount),        sub: `${stats.pendingReviews} pending review`, color: '#0891b2', icon: <CameraAltRounded /> },
          { label: 'Published Tours', value: String(stats.publishedTourCount), sub: `of ${stats.tourCount} total`,           color: '#059669', icon: <ViewInArRounded /> },
          { label: 'Pending Reviews', value: String(stats.pendingReviews),     sub: 'awaiting manager',                      color: '#dc2626', icon: <RateReviewRounded /> },
        ].map((s) => (
          <Grid key={s.label} size={{ xs: 12, sm: 6, md: 4 }}>
            <StatCard {...s} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        {/* Quick Actions */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em', mb: 2 }}>Quick Actions</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <ActionCard label="Projects"    desc="View and manage all projects"   path="/projects"    color="#2563eb" icon={<FolderRounded />} />
              <ActionCard label="Floor Plans" desc="Browse uploaded site blueprints" path="/floor-plans" color="#7c3aed" icon={<MapRounded />} />
              <ActionCard label="Analytics"   desc="KPIs and team metrics"           path="/analytics"   color="#059669" icon={<BarChartRounded />} />
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
