import React from 'react';
import { Box, Typography, Grid, Chip } from '@mui/material';
import { BusinessRounded, PeopleRounded, FolderRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import PageHeader from '@shared/components/PageHeader/PageHeader';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';

export default function OrganizationsPage() {
  const user = useAuthStore(s => s.user);
  const projects = useWorkflowStore(s => s.projects);
  const users = useWorkflowStore(s => s.users);
  const activeProjects = projects.filter(p => !p.archived);

  return (
    <Box>
      <PageHeader
        title="Organization"
        subtitle="Multi-tenant organization overview"
        breadcrumbs={[{ label: 'Organizations' }]}
      />

      <Box sx={{ borderRadius: '20px', background: colors.ink, p: 4, mb: 3, color: colors.white }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Box sx={{ width: 56, height: 56, borderRadius: '14px', backgroundColor: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BusinessRounded sx={{ fontSize: 28, color: 'rgba(255,255,255,0.8)' }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{user?.org_name ?? 'My Home Constructions'}</Typography>
            <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.55)' }}>Construction · Hyderabad, India</Typography>
          </Box>
        </Box>
        <Grid container spacing={2}>
          {[
            { icon: <FolderRounded />, label: 'Active Projects', value: activeProjects.length },
            { icon: <PeopleRounded />, label: 'Team Members', value: users.length },
            { icon: <BusinessRounded />, label: 'Plan', value: 'Enterprise' },
          ].map(s => (
            <Grid key={s.label} size={{ xs: 12, sm: 4 }}>
              <Box sx={{ p: 2, borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <Box sx={{ color: 'rgba(255,255,255,0.6)', mb: 1, '& svg': { fontSize: 18 } }}>{s.icon}</Box>
                <Typography sx={{ fontSize: '1.5rem', fontWeight: 700 }}>{s.value}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>{s.label}</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>

      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1.5 }}>Projects in organization</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {activeProjects.map(p => (
          <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderRadius: '12px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}` }}>
            <Box sx={{ width: 40, height: 40, borderRadius: '10px', background: p.gradient, flexShrink: 0 }} />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>{p.name}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{p.location}</Typography>
            </Box>
            <Chip label={p.status} size="small" sx={{ textTransform: 'capitalize', fontSize: '0.6875rem', fontWeight: 600 }} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
