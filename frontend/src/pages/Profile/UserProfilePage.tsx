import React, { useState, useRef } from 'react';
import { Box, Typography, TextField, Chip, Grid, Snackbar, Alert } from '@mui/material';
import { CameraAltRounded, CheckCircleRounded, AccessTimeRounded, ViewInArRounded, WarningAmberRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { mockCaptures, mockTours, mockAuditLogs } from '@/data/mockData';
import ActivityFeed from '@shared/components/ActivityFeed/ActivityFeed';
import { useAuthStore } from '@store/authStore';

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px',
    fontSize: '0.9375rem',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: 1.5 },
  },
};

const PROFILE_KEY = 'sitesurelabs_profile';

function loadProfile(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export default function UserProfilePage() {
  const user = useAuthStore(s => s.user);
  const updateUser = useAuthStore(s => s.updateUser);
  const fileRef = useRef<HTMLInputElement>(null);

  const stored = loadProfile();

  const initial = {
    name:        stored.name ?? user?.name ?? 'Ravi Kumar',
    designation: stored.designation ?? 'Site Manager',
    phone:       stored.phone ?? '+91 98765 43210',
    bio:         stored.bio ?? 'Site manager at My Home Constructions with 8+ years of experience in residential construction documentation.',
    avatarUrl:   stored.avatarUrl ?? '',
  };

  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [toastOpen, setToastOpen] = useState(false);
  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  const myCaptures = mockCaptures.filter(c => c.uploadedBy === 'Ravi Kumar').length;
  const myTours = mockTours.filter(t => t.status === 'published').length;
  const pending = mockCaptures.filter(c => c.status === 'review').length;

  const displayName = form.name || user?.name || 'Ravi Kumar';
  const initials = displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  function handleSave() {
    const updated = { ...form };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    setSaved(updated);
    updateUser({ name: updated.name, avatar_url: updated.avatarUrl || null });
    setToastOpen(true);
  }

  function handleDiscard() {
    setForm(saved);
  }

  function handleAvatarClick() {
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setForm(f => ({ ...f, avatarUrl: dataUrl }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <Box>
      <Box sx={{ mb: 5 }}>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>
          Profile
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Your account information and activity</Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Left column */}
        <Grid size={{ xs: 12, md: 4 }}>
          {/* Avatar card */}
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 3, mb: 3, textAlign: 'center' }}>
            <Box sx={{ position: 'relative', display: 'inline-block', mb: 2 }}>
              {form.avatarUrl ? (
                <Box component="img" src={form.avatarUrl} alt={displayName} sx={{ width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', display: 'block', mx: 'auto' }} />
              ) : (
                <Box sx={{ width: 88, height: 88, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto' }}>
                  <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: '#fff' }}>{initials}</Typography>
                </Box>
              )}
              <Box onClick={handleAvatarClick} sx={{ position: 'absolute', bottom: 2, right: 2, width: 26, height: 26, borderRadius: '50%', backgroundColor: colors.card, border: `2px solid ${colors.card}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.16)', '&:hover': { backgroundColor: colors.bgDeep } }}>
                <CameraAltRounded sx={{ fontSize: 13, color: colors.textMuted }} />
              </Box>
            </Box>
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.125rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em' }}>
              {displayName}
            </Typography>
            <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 1.5 }}>{form.designation}</Typography>
            <Chip label={user?.role === 'super_admin' ? 'Super Admin' : user?.role === 'admin' ? 'Admin' : 'Member'} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 700, color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)', borderRadius: '6px' }} />
          </Box>

          {/* Stats */}
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 2.5, mb: 3 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 2 }}>Your Stats</Typography>
            {[
              { icon: <CameraAltRounded sx={{ fontSize: 15, color: '#2563eb' }} />, label: 'Captures uploaded', value: myCaptures },
              { icon: <CheckCircleRounded sx={{ fontSize: 15, color: '#16a34a' }} />, label: 'Reviews completed', value: 24 },
              { icon: <AccessTimeRounded sx={{ fontSize: 15, color: '#d97706' }} />, label: 'Pending reviews',   value: pending },
              { icon: <ViewInArRounded sx={{ fontSize: 15, color: '#7c3aed' }} />, label: 'Tours published',   value: myTours },
            ].map(({ icon, label, value }) => (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', py: 1.25, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
                <Box sx={{ mr: 1.5 }}>{icon}</Box>
                <Typography sx={{ flex: 1, fontSize: '0.875rem', color: colors.textSecondary }}>{label}</Typography>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>{value}</Typography>
              </Box>
            ))}
          </Box>

          {/* Projects */}
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 2.5 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 2 }}>Active Projects</Typography>
            {['My Home Udyan', 'My Home Grava Residences'].map(p => (
              <Box key={p} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
                <Box sx={{ width: 28, height: 28, borderRadius: '6px', background: colors.primaryGradient, flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.875rem', color: colors.textStrong, fontWeight: 500 }}>{p}</Typography>
              </Box>
            ))}
          </Box>
        </Grid>

        {/* Right column */}
        <Grid size={{ xs: 12, md: 8 }}>
          {/* Edit form */}
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 3, mb: 3 }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 3 }}>Personal Information</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Full name</Typography>
                <TextField fullWidth value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} size="small" sx={fieldSx} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Job title / Designation</Typography>
                <TextField fullWidth value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} size="small" sx={fieldSx} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Email address</Typography>
                <TextField fullWidth defaultValue={user?.email ?? 'admin@demo.com'} size="small" disabled sx={{ ...fieldSx, opacity: 0.6 }} helperText="Contact support to change your email" />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Phone</Typography>
                <TextField fullWidth value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} size="small" sx={fieldSx} />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Bio</Typography>
                <TextField fullWidth multiline rows={3} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} size="small" sx={fieldSx} />
              </Grid>
            </Grid>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1.5, mt: 3 }}>
              {isDirty && (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(217,119,6,0.08)', fontSize: '0.8125rem', color: '#d97706', fontWeight: 500 }}>
                    <WarningAmberRounded sx={{ fontSize: 14 }} /> Unsaved changes
                  </Box>
                  <Box onClick={handleDiscard} sx={{ px: 2, py: 0.875, borderRadius: '8px', border: `1px solid ${colors.border}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', '&:hover': { color: colors.textStrong }, transition: `all ${motion.durationFast}` }}>
                    Discard
                  </Box>
                </>
              )}
              <Box onClick={handleSave} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1, borderRadius: '8px', background: isDirty ? colors.primaryGradient : 'rgba(22,163,74,0.12)', color: isDirty ? '#fff' : '#16a34a', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: isDirty ? '0 4px 14px rgba(37,99,235,0.28)' : 'none', transition: `all ${motion.durationFast}` }}>
                {isDirty ? 'Save changes' : '✓ Saved'}
              </Box>
            </Box>
          </Box>

          {/* Activity feed */}
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 3 }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 2.5 }}>Recent Activity</Typography>
            <ActivityFeed logs={mockAuditLogs} maxItems={8} />
          </Box>
        </Grid>
      </Grid>

      {/* Hidden file input for avatar */}
      <Box component="input" ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} sx={{ display: 'none' }} />

      <Snackbar open={toastOpen} autoHideDuration={3000} onClose={() => setToastOpen(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity="success" sx={{ borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }} onClose={() => setToastOpen(false)}>
          Profile updated successfully
        </Alert>
      </Snackbar>
    </Box>
  );
}
