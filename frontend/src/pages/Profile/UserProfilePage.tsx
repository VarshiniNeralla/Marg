import React, { useState, useRef } from 'react';
import { Box, Typography, TextField, Chip, Grid, Snackbar, Alert } from '@mui/material';
import { CameraAltRounded, CheckCircleRounded, AccessTimeRounded, ViewInArRounded, WarningAmberRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useSettingsStore } from '@store/settingsStore';
import ActivityFeed from '@shared/components/ActivityFeed/ActivityFeed';
import { useAuthStore } from '@store/authStore';
import { uploadAvatarFiles } from '@/services/uploadService';
import { userService } from '@/services/userService';

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px',
    fontSize: '0.9375rem',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: 1.5 },
  },
};


export default function UserProfilePage() {
  const user = useAuthStore(s => s.user);
  const updateUser = useAuthStore(s => s.updateUser);
  const profile = useSettingsStore(s => s.profile);
  const patchProfile = useSettingsStore(s => s.patchProfile);
  const fileRef = useRef<HTMLInputElement>(null);

  const roleLabel = user?.role === 'super_admin' ? 'Super Admin'
    : user?.role === 'admin' ? 'Admin'
    : user?.role === 'manager' ? 'Site Manager'
    : 'Field Engineer';

  const initial = {
    name: profile.name || user?.name || '',
    designation: profile.designation || roleLabel,
    phone: profile.phone,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
  };

  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [toastOpen, setToastOpen] = useState(false);
  const [showSavedState, setShowSavedState] = useState(false);
  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  const captures  = useWorkflowStore(s => s.captures);
  const tours     = useWorkflowStore(s => s.tours);
  const auditLogs = useWorkflowStore(s => s.auditLogs);
  const projects  = useWorkflowStore(s => s.projects);

  const assignedIds   = new Set(user?.assignedProjectIds ?? []);
  const activeProjects = assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived);

  const displayName = form.name || user?.name || '';
  const myCaptures = captures.filter(c => c.uploadedBy === displayName || c.uploadedBy === user?.name).length;
  const myTours = tours.filter(t => t.status === 'published').length;
  const pending = captures.filter(c => c.status === 'review').length;

  const initials = displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  function handleSave() {
    patchProfile({
      name: form.name,
      designation: form.designation,
      phone: form.phone,
      bio: form.bio,
      avatarUrl: form.avatarUrl,
    });
    setSaved(form);
    updateUser({ name: form.name, avatar_url: form.avatarUrl || null });
    setToastOpen(true);
    setShowSavedState(true);
    setTimeout(() => setShowSavedState(false), 2000);
  }

  function handleDiscard() {
    setForm(saved);
  }

  function handleAvatarClick() {
    fileRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadAvatarFiles([file]);
      const url = result.files[0]?.thumbnail_url || result.files[0]?.original_url;
      if (!url) return;
      setForm(f => ({ ...f, avatarUrl: url }));
      setSaved(s => ({ ...s, avatarUrl: url }));
      patchProfile({ avatarUrl: url });
      updateUser({ avatar_url: url });
      if (user?.id) {
        void userService.updateUser(user.id, { avatar_url: url });
      }
    } catch (error) {
      console.error('[avatar-upload]', error);
    }
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

      <Grid container spacing={3} sx={{ maxWidth: 900, mx: 'auto' }}>
        {/* Top / Left: Avatar & Basic Info */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 3, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Box sx={{ position: 'relative', display: 'inline-block', mb: 2 }}>
              {form.avatarUrl ? (
                <Box component="img" src={form.avatarUrl} alt={displayName} sx={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', display: 'block', mx: 'auto' }} />
              ) : (
                <Box sx={{ width: 96, height: 96, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto' }}>
                  <Typography sx={{ fontSize: '2.25rem', fontWeight: 700, color: '#fff' }}>{initials}</Typography>
                </Box>
              )}
              <Box onClick={handleAvatarClick} sx={{ position: 'absolute', bottom: 2, right: 2, width: 30, height: 30, borderRadius: '50%', backgroundColor: colors.card, border: `2px solid ${colors.card}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)', '&:hover': { backgroundColor: colors.bgDeep } }}>
                <CameraAltRounded sx={{ fontSize: 16, color: colors.textMuted }} />
              </Box>
            </Box>
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.25rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em' }}>
              {displayName}
            </Typography>
            <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 1.5 }}>{form.designation}</Typography>
            <Chip label={user?.role === 'super_admin' ? 'Super Admin' : user?.role === 'admin' ? 'Admin' : user?.role === 'manager' ? 'Manager' : 'Field Engineer'} size="small" sx={{ height: 24, px: 1, fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)', borderRadius: '8px' }} />
          </Box>
        </Grid>

        {/* Right: Personal Info Form */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 3, height: '100%' }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 2.5 }}>Personal Details</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Username / Full name</Typography>
                <TextField fullWidth value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} size="small" sx={fieldSx} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Email address</Typography>
                <TextField fullWidth value={user?.email ?? ''} size="small" disabled sx={{ ...fieldSx, opacity: 0.7 }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Phone number</Typography>
                <TextField fullWidth value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} size="small" sx={fieldSx} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Designation</Typography>
                <TextField fullWidth value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} size="small" sx={fieldSx} />
              </Grid>
            </Grid>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1.5, mt: 3, minHeight: 40 }}>
              {isDirty && (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(217,119,6,0.08)', fontSize: '0.8125rem', color: '#d97706', fontWeight: 500 }}>
                    <WarningAmberRounded sx={{ fontSize: 14 }} /> Unsaved
                  </Box>
                  <Box onClick={handleDiscard} sx={{ px: 2, py: 0.875, borderRadius: '8px', border: `1px solid ${colors.border}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', '&:hover': { color: colors.textStrong }, transition: `all ${motion.durationFast}` }}>
                    Discard
                  </Box>
                  <Box onClick={handleSave} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', transition: `all ${motion.durationFast}` }}>
                    Save changes
                  </Box>
                </>
              )}
              {!isDirty && showSavedState && (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1, borderRadius: '8px', background: 'rgba(22,163,74,0.12)', color: '#16a34a', fontSize: '0.875rem', fontWeight: 600 }}>
                  ✓ Saved
                </Box>
              )}
            </Box>
          </Box>
        </Grid>

        {/* Bottom Left: Stats */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 3, height: '100%' }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, mb: 2 }}>Performance Stats</Typography>
            <Grid container spacing={2}>
              {[
                { icon: <CameraAltRounded sx={{ fontSize: 18, color: '#2563eb' }} />, bg: 'rgba(37,99,235,0.1)', label: 'Captures uploaded', value: myCaptures },
                { icon: <CheckCircleRounded sx={{ fontSize: 18, color: '#16a34a' }} />, bg: 'rgba(22,163,74,0.1)', label: 'Reviews completed', value: captures.filter(c => c.status === 'processed').length },
                { icon: <AccessTimeRounded sx={{ fontSize: 18, color: '#d97706' }} />, bg: 'rgba(217,119,6,0.1)', label: 'Pending reviews',   value: pending },
                { icon: <ViewInArRounded sx={{ fontSize: 18, color: '#7c3aed' }} />, bg: 'rgba(124,58,237,0.1)', label: 'Tours published',   value: myTours },
              ].map(({ icon, bg, label, value }) => (
                <Grid size={{ xs: 12, sm: 6 }} key={label}>
                  <Box sx={{ display: 'flex', alignItems: 'center', p: 1.5, borderRadius: '12px', border: `1px solid ${colors.borderLight}` }}>
                    <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 1.5 }}>{icon}</Box>
                    <Box>
                      <Typography sx={{ fontSize: '1.125rem', fontWeight: 700, color: colors.textStrong, lineHeight: 1.1 }}>{value}</Typography>
                      <Typography sx={{ fontSize: '0.75rem', color: colors.textSecondary, mt: 0.25 }}>{label}</Typography>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Grid>

        {/* Bottom Right: Active Projects */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 3, height: '100%' }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, mb: 2 }}>Active Projects</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {activeProjects.length === 0 ? (
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>No active projects.</Typography>
              ) : activeProjects.map(p => (
                <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: '12px', backgroundColor: colors.bg, border: `1px solid ${colors.borderLight}` }}>
                  <Box sx={{ width: 32, height: 32, borderRadius: '8px', background: p.gradient ?? colors.primaryGradient, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.875rem', color: colors.textStrong, fontWeight: 600 }}>{p.name}</Typography>
                </Box>
              ))}
            </Box>
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
