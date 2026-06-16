import React from 'react';
import { Box, Typography, Grid, Chip } from '@mui/material';
import { PeopleRounded, EmailRounded, WorkOutlineRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import PageHeader from '@shared/components/PageHeader/PageHeader';
import { useWorkflowStore } from '@store/workflowStore';

const roleColor: Record<string, { color: string; bg: string }> = {
  super_admin: { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  admin: { color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  manager: { color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  reviewer: { color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  viewer: { color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
};

export default function UsersPage() {
  const users = useWorkflowStore(s => s.users);
  const projects = useWorkflowStore(s => s.projects);

  return (
    <Box>
      <PageHeader
        title="Team Members"
        subtitle={`${users.length} members across ${projects.filter(p => !p.archived).length} active projects`}
        breadcrumbs={[{ label: 'Users' }]}
      />

      <Grid container spacing={2}>
        {users.map(u => {
          const rc = roleColor[u.role] ?? roleColor.viewer;
          const initials = u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
          return (
            <Grid key={u.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, p: 2.5, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', transition: `all ${motion.durationFast}`, '&:hover': { boxShadow: '0 8px 24px rgba(15,23,42,0.08)' } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                  <Box sx={{ width: 44, height: 44, borderRadius: '12px', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.875rem' }}>
                    {initials}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>{u.name}</Typography>
                    <Chip label={u.role.replace('_', ' ')} size="small" sx={{ height: 20, fontSize: '0.625rem', fontWeight: 600, color: rc.color, backgroundColor: rc.bg, borderRadius: '5px', mt: 0.25, textTransform: 'capitalize' }} />
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: colors.textMuted }}>
                    <WorkOutlineRounded sx={{ fontSize: 14 }} />
                    <Typography sx={{ fontSize: '0.8125rem' }}>{u.designation}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: colors.textMuted }}>
                    <EmailRounded sx={{ fontSize: 14 }} />
                    <Typography noWrap sx={{ fontSize: '0.8125rem' }}>{u.email}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, mt: 0.5 }}>
                    {u.projectIds.length} project{u.projectIds.length !== 1 ? 's' : ''} · Last active {u.lastActive}
                  </Typography>
                </Box>
              </Box>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
