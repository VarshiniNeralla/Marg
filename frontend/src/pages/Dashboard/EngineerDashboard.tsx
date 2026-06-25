import React from 'react';
import { Box, Typography, Grid, LinearProgress, Chip } from '@mui/material';
import {
  PhotoCameraRounded, CheckCircleRounded, AccessTimeRounded, WarningAmberRounded,
  QueueRounded, FolderRounded, ArrowForwardRounded, UploadFileRounded,
  ReplayRounded, CancelRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import PageHeader from '@shared/components/PageHeader/PageHeader';

const captureStatusConfig: Record<string, { label: string; color: string; bg: string }> = {
  processed: { label: 'Processed', color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  review:    { label: 'In Review', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  rejected:  { label: 'Rejected',  color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  uploaded:  { label: 'Uploaded',  color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
};

export default function EngineerDashboard() {
  const user     = useAuthStore((s) => s.user);
  const projects = useWorkflowStore(s => s.projects);
  const captures = useWorkflowStore(s => s.captures);
  const floors   = useWorkflowStore(s => s.floors);

  // Engineer sees only assigned projects
  const assignedIds = new Set(user?.assignedProjectIds ?? []);
  const myProjects = assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived).slice(0, 3);

  // Captures attributed to this user (mock: all captures for now)
  const myCaptures = captures;
  const pendingUploads = myCaptures.filter(c => c.status === 'review');
  const approved       = myCaptures.filter(c => c.status === 'processed');
  const rejected       = myCaptures.filter(c => c.status === 'rejected');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';

  return (
    <Box>
      <PageHeader
        title={`${greeting}, ${user?.name?.split(' ')[0] ?? 'Engineer'}`}
        subtitle="Your capture assignments and upload status"
        breadcrumbs={[{ label: 'My Overview' }]}
        actions={
          <Box component={Link} to="/capture-workflow" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, borderRadius: '10px', background: 'linear-gradient(135deg,#059669,#047857)', color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <PhotoCameraRounded sx={{ fontSize: 18 }} /> Start Capture
          </Box>
        }
      />

      {/* KPI row */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {[
          { label: 'Assigned Projects', value: String(myProjects.length), sub: 'active sites', color: '#2563eb', icon: <FolderRounded /> },
          { label: 'My Uploads', value: String(myCaptures.length), sub: 'total captures', color: '#059669', icon: <UploadFileRounded /> },
          { label: 'Pending Review', value: String(pendingUploads.length), sub: 'awaiting manager', color: '#d97706', icon: <AccessTimeRounded /> },
          { label: 'Rejected', value: String(rejected.length), sub: 'need re-capture', color: '#dc2626', icon: <ReplayRounded /> },
        ].map(({ label, value, sub, color, icon }) => (
          <Grid key={label} size={{ xs: 12, sm: 6, md: 3 }}>
            <Box sx={{ p: 2.5, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
              <Box sx={{ width: 44, height: 44, borderRadius: '12px', backgroundColor: color + '14', color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, '& svg': { fontSize: 22 } }}>{icon}</Box>
              <Box>
                <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, lineHeight: 1, letterSpacing: '-0.04em' }}>{value}</Typography>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSecondary, mt: 0.25 }}>{label}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>{sub}</Typography>
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        {/* Assigned projects */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>My Projects</Typography>
            </Box>
            {myProjects.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <FolderRounded sx={{ fontSize: 40, color: colors.textSubdued, mb: 1 }} />
                <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>No projects assigned yet.</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textSubdued, mt: 0.5 }}>Contact your admin to get assigned.</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {myProjects.map(p => (
                  <Box key={p.id} component={Link} to={`/projects/${p.id}`} sx={{ p: 2, borderRadius: '12px', border: `1px solid ${colors.border}`, textDecoration: 'none', '&:hover': { borderColor: p.accent + '55', backgroundColor: colors.bg } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: p.accent }} />
                      <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, flex: 1 }} noWrap>{p.name}</Typography>
                      <ArrowForwardRounded sx={{ fontSize: 14, color: colors.textSubdued }} />
                    </Box>
                    <LinearProgress variant="determinate" value={p.progress} sx={{ height: 5, borderRadius: 3, backgroundColor: colors.bgDeep, mb: 0.75, '& .MuiLinearProgress-bar': { borderRadius: 3, backgroundColor: p.accent } }} />
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{p.progress}% complete · {p.towers} towers</Typography>
                  </Box>
                ))}
              </Box>
            )}

            {/* Start capture CTA */}
            <Box component={Link} to="/capture-workflow" sx={{ mt: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 1.5, borderRadius: '12px', border: `1.5px dashed ${colors.primary}50`, color: colors.primary, textDecoration: 'none', fontSize: '0.875rem', fontWeight: 600, '&:hover': { backgroundColor: colors.primarySoft } }}>
              <PhotoCameraRounded sx={{ fontSize: 18 }} /> Start New Capture
            </Box>
          </Box>
        </Grid>

        {/* Recent uploads */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ p: 3, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>My Recent Uploads</Typography>
              <Box component={Link} to="/my-captures" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                All uploads <ArrowForwardRounded sx={{ fontSize: 14 }} />
              </Box>
            </Box>

            {myCaptures.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <QueueRounded sx={{ fontSize: 48, color: colors.textSubdued, mb: 1 }} />
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textSecondary }}>No captures yet.</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mt: 0.5 }}>Use the Capture Workflow to upload your first image.</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {myCaptures.slice(0, 8).map((c, i) => {
                  const sc = captureStatusConfig[c.status] ?? captureStatusConfig.uploaded;
                  return (
                    <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.25, borderBottom: i < Math.min(myCaptures.length, 8) - 1 ? `1px solid ${colors.borderLight}` : 'none' }}>
                      <Box sx={{ width: 36, height: 36, borderRadius: '8px', background: c.gradient, flexShrink: 0 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{c.roomName}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{c.projectName} · {c.floorLabel}</Typography>
                      </Box>
                      <Chip label={sc.label} size="small" sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600, color: sc.color, backgroundColor: sc.bg, borderRadius: '5px' }} />
                      <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, flexShrink: 0 }}>{c.uploadedAt}</Typography>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>

          {/* Rejected — needs attention */}
          {rejected.length > 0 && (
            <Box sx={{ mt: 2.5, p: 2.5, borderRadius: '14px', border: `1px solid rgba(220,38,38,0.2)`, backgroundColor: 'rgba(220,38,38,0.04)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
                <WarningAmberRounded sx={{ fontSize: 18, color: '#dc2626' }} />
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: '#dc2626' }}>{rejected.length} capture{rejected.length > 1 ? 's' : ''} rejected — re-capture needed</Typography>
              </Box>
              <Box component={Link} to="/capture-workflow" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: '0.8125rem', color: '#dc2626', fontWeight: 600, textDecoration: 'none' }}>
                Go to Capture Workflow <ArrowForwardRounded sx={{ fontSize: 14 }} />
              </Box>
            </Box>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
