import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Grid, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, IconButton, Divider, Button as MuiButton, CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  AddRounded, EditRounded, DeleteRounded, SearchRounded,
  PeopleRounded, EmailRounded, WorkOutlineRounded, CheckCircleRounded,
  PersonOffRounded, RefreshRounded, ErrorRounded, ArrowBackRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import PageHeader from '@shared/components/PageHeader/PageHeader';
import Button from '@shared/components/Button/Button';
import { userService } from '@services/userService';
import { authService as backendAuth } from '@services/authService';
import { useAuthStore , getRoleLandingPath } from '@store/authStore';
import apiClient from '@services/apiClient';

type AppRole = 'admin' | 'manager' | 'field_engineer';

const ROLE_OPTIONS: { value: AppRole; label: string; color: string; bg: string }[] = [
  { value: 'admin',          label: 'Admin',          color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  { value: 'manager',        label: 'Manager',        color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  { value: 'field_engineer', label: 'Field Engineer', color: '#059669', bg: 'rgba(5,150,105,0.08)' },
];

const DESIGNATION_OPTIONS = ['Site Manager', 'Site Engineer', 'Platform Admin'];

function roleMeta(role: string) {
  return ROLE_OPTIONS.find(r => r.value === role || r.value === role.replace(' ', '_'))
    ?? { label: role, color: '#64748b', bg: 'rgba(100,116,139,0.08)' };
}

interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  designation?: string;
  created_at?: string;
  last_login?: string | null;
}

interface CreateForm {
  name: string;
  email: string;
  role: AppRole;
  designation: string;
  password: string;
}

interface EditForm {
  name: string;
  designation: string;
  role: AppRole;
  newPassword: string;
}

const EMPTY_CREATE: CreateForm = { name: '', email: '', role: 'field_engineer', designation: '', password: 'Prangan@123' };
const EMPTY_EDIT: EditForm = { name: '', designation: '', role: 'field_engineer', newPassword: '' };

const inputSx = {
  width: '100%', px: 1.75, py: 1.25, borderRadius: '10px',
  border: `1px solid ${colors.border}`, fontSize: '0.9375rem',
  fontFamily: 'inherit', color: colors.textStrong, outline: 'none',
  backgroundColor: '#fff', boxSizing: 'border-box' as const,
  '&:focus': { borderColor: colors.primary, boxShadow: '0 0 0 3px rgba(37,99,235,0.1)' },
};

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 1.25,
      px: 2, py: 1.5, mb: 2, borderRadius: '10px',
      backgroundColor: '#fef2f2',
      border: '1px solid #fecaca',
    }}>
      <ErrorRounded sx={{ fontSize: 18, color: '#dc2626', flexShrink: 0, mt: '1px' }} />
      <Typography sx={{ fontSize: '0.875rem', color: '#b91c1c', lineHeight: 1.5 }}>{msg}</Typography>
    </Box>
  );
}

export default function UserManagementPage() {
  const currentUser = useAuthStore(s => s.user);

  const [users, setUsers]             = useState<ApiUser[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [search, setSearch]           = useState('');
  const [roleFilter, setRoleFilter]   = useState('all');

  const [createOpen, setCreateOpen]   = useState(false);
  const [createForm, setCreateForm]   = useState<CreateForm>(EMPTY_CREATE);
  const [createErr, setCreateErr]     = useState('');
  const [creating, setCreating]       = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ name: string; email: string; password: string } | null>(null);

  const [editTarget, setEditTarget]   = useState<ApiUser | null>(null);
  const [editForm, setEditForm]       = useState<EditForm>(EMPTY_EDIT);
  const [editErr, setEditErr]         = useState('');
  const [editing, setEditing]         = useState(false);
  const [pwSuccess, setPwSuccess]     = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ApiUser | null>(null);
  const [deleting, setDeleting]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await userService.listUsers({ limit: 100 });
      setUsers((res.items as unknown as ApiUser[]) ?? []);
    } catch {
      setError('Failed to load users. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
                        u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  // ── Create ────────────────────────────────────────────────────────────────────
  async function handleCreate() {
    setCreateErr('');
    if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password.trim()) {
      setCreateErr('Name, email and password are required.');
      return;
    }
    setCreating(true);
    try {
      // Use /auth/register — admin creates users this way (org_slug from current user's org)
      const orgSlug = (currentUser as any)?.org_slug ?? 'myhome';
      await apiClient.post('/auth/register', {
        name: createForm.name.trim(),
        email: createForm.email.trim().toLowerCase(),
        password: createForm.password,
        org_slug: orgSlug,
        role: createForm.role,
        designation: createForm.designation.trim() || undefined,
      });
      setCreatedInfo({ name: createForm.name.trim(), email: createForm.email.trim().toLowerCase(), password: createForm.password });
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE);
      await load();
    } catch (e: any) {
      const detail = e?.detail;
      const fieldMsg = Array.isArray(detail) ? detail.map((d: any) => d.message ?? d.msg).join('; ') : null;
      setCreateErr(fieldMsg ?? e?.message ?? 'Failed to create user.');
    } finally {
      setCreating(false);
    }
  }

  // ── Edit ──────────────────────────────────────────────────────────────────────
  function openEdit(u: ApiUser) {
    setEditTarget(u);
    setEditForm({ name: u.name, designation: u.designation ?? '', role: (u.role as AppRole) ?? 'field_engineer', newPassword: '' });
    setEditErr('');
    setPwSuccess(false);
  }

  async function handleEdit() {
    if (!editTarget) return;
    setEditErr('');
    setEditing(true);
    try {
      await userService.updateUser(editTarget.id, {
        name: editForm.name.trim() || undefined,
        designation: editForm.designation.trim() || undefined,
        role: editForm.role,
      } as any);
      if (editForm.newPassword.trim()) {
        await apiClient.put(`/users/${editTarget.id}/password`, { new_password: editForm.newPassword.trim() });
        setPwSuccess(true);
      }
      setEditTarget(null);
      await load();
    } catch (e: any) {
      setEditErr(e?.message ?? 'Failed to update user.');
    } finally {
      setEditing(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await userService.deactivateUser(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const adminCount = users.filter(u => u.role === 'admin' || u.role === 'super_admin').length;
  const managerCount = users.filter(u => u.role === 'manager').length;
  const engCount = users.filter(u => u.role === 'field_engineer').length;
  const activeCount = users.filter(u => u.is_active !== false).length;

  return (
    <Box>
      {/* Back to overview */}
      <Box component={Link} to={getRoleLandingPath(currentUser?.role)} sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
        fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
        transition: `all ${motion.durationFast}`, '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
      }}>
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
      </Box>

      <PageHeader
        title="User Management"
        subtitle={`${users.length} members · ${activeCount} active`}
        breadcrumbs={[{ label: 'Users' }]}
        actions={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Refresh">
              <IconButton onClick={load} size="small" sx={{ border: `1px solid ${colors.border}`, borderRadius: '8px' }}>
                <RefreshRounded sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Button variant="primary" onClick={() => { setCreateForm(EMPTY_CREATE); setCreateErr(''); setCreateOpen(true); }} sx={{ gap: 0.75, height: 38, fontSize: '0.875rem' }}>
              <AddRounded sx={{ fontSize: 18 }} /> Create User
            </Button>
          </Box>
        }
      />

      {error && <ErrorBanner msg={error} />}

      {/* Success banner after user creation */}
      {createdInfo && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, px: 2.5, py: 2, mb: 2.5, borderRadius: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <Box>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: '#15803d', mb: 0.25 }}>
              User created successfully
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: '#166534', lineHeight: 1.6 }}>
              <strong>{createdInfo.name}</strong> ({createdInfo.email})<br />
              Temporary password: <Box component="span" sx={{ fontFamily: 'monospace', backgroundColor: '#dcfce7', px: 0.75, py: 0.125, borderRadius: '4px', fontSize: '0.875rem', letterSpacing: '0.05em' }}>{createdInfo.password}</Box>
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: '#15803d', mt: 0.5 }}>Share these credentials with the user. They should change their password on first login.</Typography>
          </Box>
          <Box onClick={() => setCreatedInfo(null)} sx={{ cursor: 'pointer', color: '#15803d', fontSize: '1.25rem', lineHeight: 1, flexShrink: 0, '&:hover': { opacity: 0.7 } }}>✕</Box>
        </Box>
      )}

      {/* Summary cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Admins',          value: adminCount,   color: '#2563eb' },
          { label: 'Managers',        value: managerCount, color: '#7c3aed' },
          { label: 'Field Engineers', value: engCount,     color: '#059669' },
          { label: 'Active',          value: activeCount,  color: '#0891b2' },
        ].map(s => (
          <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
            <Box sx={{ p: 2, borderRadius: '12px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '1.625rem', fontWeight: 800, color: s.color, letterSpacing: '-0.04em', lineHeight: 1 }}>{s.value}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.375, fontWeight: 500 }}>{s.label}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* Search + filter */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.875, borderRadius: '10px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
          <SearchRounded sx={{ fontSize: 18, color: colors.textMuted }} />
          <Box component="input" value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} placeholder="Search by name or email…" sx={{ border: 'none', outline: 'none', background: 'transparent', fontSize: '0.875rem', color: colors.textStrong, flex: 1, fontFamily: 'inherit', '&::placeholder': { color: colors.textSubdued } }} />
        </Box>
        <Select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} size="small" sx={{ borderRadius: '10px', fontSize: '0.875rem', minWidth: 160, '.MuiOutlinedInput-notchedOutline': { borderColor: colors.border } }}>
          <MenuItem value="all">All roles</MenuItem>
          <MenuItem value="admin">Admin</MenuItem>
          <MenuItem value="manager">Manager</MenuItem>
          <MenuItem value="field_engineer">Field Engineer</MenuItem>
        </Select>
      </Box>

      {/* User cards */}
      {loading ? (
        <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress size={32} /></Box>
      ) : (
        <Grid container spacing={2}>
          {filtered.map(u => {
            const rm = roleMeta(u.role);
            const isActive = u.is_active !== false;
            const initials = u.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
            const isSelf = u.id === currentUser?.id;
            return (
              <Grid key={u.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.border}`, p: 2.5, opacity: isActive ? 1 : 0.55, transition: `all ${motion.durationFast}`, '&:hover': { boxShadow: '0 8px 24px rgba(15,23,42,0.07)' } }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 2 }}>
                    <Box sx={{ width: 44, height: 44, borderRadius: '12px', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.875rem', flexShrink: 0 }}>
                      {initials}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>
                        {u.name} {isSelf && <Typography component="span" sx={{ fontSize: '0.6875rem', color: colors.primary, fontWeight: 500 }}>(you)</Typography>}
                      </Typography>
                      <Chip label={rm.label} size="small" sx={{ height: 20, fontSize: '0.625rem', fontWeight: 600, color: rm.color, backgroundColor: rm.bg, borderRadius: '5px', mt: 0.25 }} />
                    </Box>
                    {isActive
                      ? <CheckCircleRounded sx={{ fontSize: 16, color: colors.success }} />
                      : <PersonOffRounded sx={{ fontSize: 16, color: colors.danger }} />
                    }
                  </Box>

                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.625, mb: 2 }}>
                    {u.designation && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: colors.textMuted }}>
                        <WorkOutlineRounded sx={{ fontSize: 13 }} />
                        <Typography sx={{ fontSize: '0.8125rem' }}>{u.designation}</Typography>
                      </Box>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: colors.textMuted }}>
                      <EmailRounded sx={{ fontSize: 13 }} />
                      <Typography noWrap sx={{ fontSize: '0.8125rem' }}>{u.email}</Typography>
                    </Box>
                    {u.created_at && (
                      <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, mt: 0.25 }}>
                        Joined {new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Typography>
                    )}
                  </Box>

                  <Divider sx={{ borderColor: colors.borderLight, mb: 1.5 }} />
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <MuiButton size="small" startIcon={<EditRounded sx={{ fontSize: 14 }} />} onClick={() => openEdit(u)} sx={{ flex: 1, fontSize: '0.75rem', fontWeight: 600, color: colors.textSecondary, borderRadius: '8px', textTransform: 'none', '&:hover': { backgroundColor: colors.bg } }}>
                      Edit
                    </MuiButton>
                    <Tooltip title={isSelf ? "Can't delete your own account" : ''}>
                      <span style={{ flex: 1 }}>
                        <MuiButton size="small" startIcon={<DeleteRounded sx={{ fontSize: 14 }} />} disabled={isSelf} onClick={() => setDeleteTarget(u)} sx={{ width: '100%', fontSize: '0.75rem', fontWeight: 600, color: colors.danger, borderRadius: '8px', textTransform: 'none', '&:hover': { backgroundColor: colors.dangerBg }, '&:disabled': { opacity: 0.4 } }}>
                          Delete
                        </MuiButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Box>
              </Grid>
            );
          })}
        </Grid>
      )}

      {!loading && filtered.length === 0 && (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <PeopleRounded sx={{ fontSize: 48, color: colors.textSubdued, mb: 1 }} />
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>No users found.</Typography>
        </Box>
      )}

      {/* ── Create User Dialog ─────────────────────────────────────────────── */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: '20px' } } }}>
        <DialogTitle sx={{ fontSize: '1.0625rem', fontWeight: 700, pb: 1 }}>Create New User</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2.5 }}>
          {createErr && <ErrorBanner msg={createErr} />}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* Role selector */}
            <Box>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Role</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {ROLE_OPTIONS.map(opt => (
                  <Box key={opt.value} onClick={() => setCreateForm(f => ({ ...f, role: opt.value }))} sx={{ flex: 1, p: 1.5, borderRadius: '10px', border: `1.5px solid ${createForm.role === opt.value ? opt.color : colors.border}`, backgroundColor: createForm.role === opt.value ? opt.bg : 'transparent', cursor: 'pointer', textAlign: 'center', transition: 'all 140ms', '&:hover': { borderColor: opt.color } }}>
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: createForm.role === opt.value ? opt.color : colors.textMuted }}>{opt.label}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>

            {([
              { label: 'Full Name', key: 'name' as const,  type: 'text',  placeholder: 'e.g. Rahul Sharma' },
              { label: 'Email',     key: 'email' as const, type: 'email', placeholder: 'e.g. rahul@myhomeconstructions.com' },
            ] as const).map(field => (
              <Box key={field.key}>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>{field.label}</Typography>
                <Box component="input" type={field.type} value={createForm[field.key]} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateForm(f => ({ ...f, [field.key]: e.target.value }))} placeholder={field.placeholder} sx={inputSx} />
              </Box>
            ))}

            {/* Designation dropdown */}
            <Box>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Designation</Typography>
              <Select
                value={createForm.designation}
                onChange={e => setCreateForm(f => ({ ...f, designation: e.target.value }))}
                displayEmpty
                size="small"
                fullWidth
                sx={{ borderRadius: '10px', fontSize: '0.9375rem', '.MuiOutlinedInput-notchedOutline': { borderColor: colors.border } }}
              >
                <MenuItem value=""><em style={{ color: colors.textMuted }}>Select designation… (optional)</em></MenuItem>
                {DESIGNATION_OPTIONS.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
              </Select>
            </Box>

            {/* Password — shown as plain text so admin can verify what they're setting */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary }}>Temporary Password</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>Must: 8+ chars, uppercase, digit, special (@$!%*?&)</Typography>
              </Box>
              <Box component="input" type="text" value={createForm.password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateForm(f => ({ ...f, password: e.target.value }))} placeholder="e.g. Prangan@123" sx={{ ...inputSx, fontFamily: 'monospace', letterSpacing: '0.04em' }} />
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.5 }}>
                This password will be shown to you after creation. Share it with the user.
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <MuiButton onClick={() => setCreateOpen(false)} sx={{ borderRadius: '10px', textTransform: 'none', color: colors.textMuted }}>Cancel</MuiButton>
          <Button variant="primary" onClick={handleCreate} loading={creating} sx={{ borderRadius: '10px', px: 3 }}>Create User</Button>
        </DialogActions>
      </Dialog>

      {/* ── Edit User Dialog ───────────────────────────────────────────────── */}
      <Dialog open={Boolean(editTarget)} onClose={() => setEditTarget(null)} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: '20px' } } }}>
        <DialogTitle sx={{ fontSize: '1.0625rem', fontWeight: 700, pb: 1 }}>Edit User</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2.5 }}>
          {editErr && <ErrorBanner msg={editErr} />}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* Full Name */}
            <Box>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Full Name</Typography>
              <Box component="input" value={editForm.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditForm(f => ({ ...f, name: e.target.value }))} sx={inputSx} />
            </Box>

            {/* Designation dropdown */}
            <Box>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Designation</Typography>
              <Select
                value={editForm.designation}
                onChange={e => setEditForm(f => ({ ...f, designation: e.target.value }))}
                displayEmpty
                size="small"
                fullWidth
                sx={{ borderRadius: '10px', fontSize: '0.9375rem', '.MuiOutlinedInput-notchedOutline': { borderColor: colors.border } }}
              >
                <MenuItem value=""><em style={{ color: colors.textMuted }}>Select designation…</em></MenuItem>
                {DESIGNATION_OPTIONS.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
              </Select>
            </Box>

            {/* Role */}
            <Box>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Role</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {ROLE_OPTIONS.map(opt => (
                  <Box key={opt.value} onClick={() => setEditForm(f => ({ ...f, role: opt.value }))} sx={{ flex: 1, p: 1.25, borderRadius: '10px', border: `1.5px solid ${editForm.role === opt.value ? opt.color : colors.border}`, backgroundColor: editForm.role === opt.value ? opt.bg : 'transparent', cursor: 'pointer', textAlign: 'center', transition: 'all 140ms' }}>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: editForm.role === opt.value ? opt.color : colors.textMuted }}>{opt.label}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>

            {/* Change password */}
            <Box sx={{ pt: 0.5, borderTop: `1px solid ${colors.borderLight}` }}>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>Change Password</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 0.875 }}>Leave blank to keep the current password unchanged.</Typography>
              <Box component="input" type="password" value={editForm.newPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditForm(f => ({ ...f, newPassword: e.target.value }))} placeholder="New password (min 8 chars)" sx={{ ...inputSx, fontFamily: 'monospace', letterSpacing: '0.04em' }} />
            </Box>
          </Box>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <MuiButton onClick={() => setEditTarget(null)} sx={{ borderRadius: '10px', textTransform: 'none', color: colors.textMuted }}>Cancel</MuiButton>
          <Button variant="primary" onClick={handleEdit} loading={editing} sx={{ borderRadius: '10px', px: 3 }}>Save Changes</Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirmation ────────────────────────────────────────────── */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: '20px' } } }}>
        <DialogTitle sx={{ fontSize: '1.0625rem', fontWeight: 700, pb: 1 }}>Delete User</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textSecondary }}>
            Permanently delete <strong>{deleteTarget?.name}</strong> ({deleteTarget?.email})?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <MuiButton onClick={() => setDeleteTarget(null)} sx={{ borderRadius: '10px', textTransform: 'none', color: colors.textMuted }}>Cancel</MuiButton>
          <MuiButton onClick={handleDelete} disabled={deleting} sx={{ borderRadius: '10px', textTransform: 'none', fontWeight: 600, color: '#fff', backgroundColor: colors.danger, px: 2.5, '&:hover': { backgroundColor: '#b91c1c' } }}>
            {deleting ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : 'Delete'}
          </MuiButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
