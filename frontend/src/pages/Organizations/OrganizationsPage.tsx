import React, { useEffect, useState } from 'react';
import { Box, Typography, Grid, Chip, TextField, Button, Snackbar, Alert } from '@mui/material';
import { BusinessRounded, PeopleRounded, FolderRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import PageHeader from '@shared/components/PageHeader/PageHeader';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { organizationService } from '@services/organizationService';
import type { OrganizationMeResponse } from '@/types/dto';

export default function OrganizationsPage() {
  const user = useAuthStore(s => s.user);
  const updateUser = useAuthStore(s => s.updateUser);
  const projects = useWorkflowStore(s => s.projects);
  const activeProjects = projects.filter(p => !p.archived);

  const [org, setOrg] = useState<OrganizationMeResponse | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const me = await organizationService.getMyOrg();
        if (cancelled) return;
        setOrg(me);
        setName(me.name || '');
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load organization');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Organization name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await organizationService.updateMyOrg({ name: trimmed });
      setOrg(prev => prev ? { ...prev, name: updated.name, updated_at: updated.updated_at } : prev);
      updateUser({ org_name: updated.name });
      setToast('Organization updated');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save organization');
    } finally {
      setSaving(false);
    }
  }

  const memberCount = org?.stats?.total_users ?? '—';
  const projectCount = org?.stats?.total_projects ?? activeProjects.length;
  const plan = org?.plan ?? '—';

  return (
    <Box>
      <PageHeader
        title="Organization"
        subtitle="Tenant overview and settings"
        breadcrumbs={[{ label: 'Organizations' }]}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>
      )}

      <Box sx={{ borderRadius: '20px', background: colors.ink, p: 4, mb: 3, color: colors.white }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Box sx={{ width: 56, height: 56, borderRadius: '14px', backgroundColor: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <BusinessRounded sx={{ fontSize: 28, color: 'rgba(255,255,255,0.8)' }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>
              {loading ? 'Loading…' : (org?.name ?? user?.org_name ?? 'Organization')}
            </Typography>
            <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.55)' }}>
              {org?.slug ? `slug · ${org.slug}` : (user?.org_slug ? `slug · ${user.org_slug}` : 'Your organization')}
              {org?.status ? ` · ${org.status}` : ''}
            </Typography>
          </Box>
        </Box>
        <Grid container spacing={2}>
          {[
            { icon: <FolderRounded />, label: 'Projects', value: projectCount },
            { icon: <PeopleRounded />, label: 'Active members', value: memberCount },
            { icon: <BusinessRounded />, label: 'Plan', value: plan },
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

      <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, p: 3, mb: 3 }}>
        <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 2 }}>
          Organization name
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading || saving}
            sx={{ flex: 1, minWidth: 220 }}
          />
          <Button
            variant="contained"
            disableElevation
            onClick={() => void handleSave()}
            disabled={loading || saving || !name.trim()}
            sx={{ textTransform: 'none', borderRadius: '10px', fontWeight: 600 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      </Box>

      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1.5 }}>
        Projects in organization
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {activeProjects.length === 0 && (
          <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>No active projects yet.</Typography>
        )}
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

      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setToast('')}>{toast}</Alert>
      </Snackbar>
    </Box>
  );
}
