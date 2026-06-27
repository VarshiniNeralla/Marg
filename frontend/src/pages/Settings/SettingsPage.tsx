import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, TextField, Switch, Select, MenuItem, Snackbar, Alert, InputAdornment, IconButton } from '@mui/material';
import {
  PersonRounded,
  LockRounded, CheckRounded, WarningAmberRounded, StorageRounded,
  VisibilityRounded, VisibilityOffRounded, ArrowBackRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useAuthStore, getRoleLandingPath } from '@store/authStore';
import { authService } from '@services/authService';
import { useSettingsStore } from '@store/settingsStore';
import { userService } from '@services/userService';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { resetApplicationData } from '@store/resetApplicationData';

// ── Shared primitives ─────────────────────────────────────────────────────────

const tabs = [
  { key: 'account',       label: 'Account',        icon: <PersonRounded sx={{ fontSize: 16 }} /> },
  { key: 'security',      label: 'Security',       icon: <LockRounded sx={{ fontSize: 16 }} /> },
  { key: 'advanced',      label: 'Advanced',       icon: <StorageRounded sx={{ fontSize: 16 }} /> },
];

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px',
    fontSize: '0.9375rem',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: 1.5 },
  },
};

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden', mb: 3 }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${colors.borderLight}` }}>
        <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>{title}</Typography>
      </Box>
      <Box sx={{ p: 3 }}>{children}</Box>
    </Box>
  );
}

function FieldRow({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'stretch', md: 'flex-start' }, gap: { xs: 1, md: 3 }, py: 2, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
      <Box sx={{ width: { xs: '100%', md: 200 }, flexShrink: 0, pt: { md: 0.5 } }}>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{label}</Typography>
        {helper && <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>{helper}</Typography>}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

interface FormActionsProps {
  isDirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

function FormActions({ isDirty, onSave, onDiscard }: FormActionsProps) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1.5 }}>
      {isDirty && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(217,119,6,0.08)', fontSize: '0.8125rem', color: '#d97706', fontWeight: 500 }}>
            <WarningAmberRounded sx={{ fontSize: 14 }} /> Unsaved changes
          </Box>
          <Box onClick={onDiscard} sx={{ px: 2, py: 0.875, borderRadius: '8px', border: `1px solid ${colors.border}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', '&:hover': { color: colors.textStrong, borderColor: colors.textSubdued }, transition: `all ${motion.durationFast}` }}>
            Discard
          </Box>
        </>
      )}
      <Box onClick={onSave} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1, borderRadius: '8px', background: isDirty ? colors.primaryGradient : 'rgba(22,163,74,0.12)', color: isDirty ? '#fff' : '#16a34a', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: isDirty ? '0 4px 14px rgba(37,99,235,0.28)' : 'none', transition: `all ${motion.durationFast}` }}>
        {isDirty ? 'Save changes' : <><CheckRounded sx={{ fontSize: 14 }} /> Saved</>}
      </Box>
    </Box>
  );
}

// ── Account Tab ───────────────────────────────────────────────────────────────

function AccountTab({ onSaved }: { onSaved: () => void }) {
  const user = useAuthStore(s => s.user);
  const updateUser = useAuthStore(s => s.updateUser);
  const account = useSettingsStore(s => s.account);
  const patchAccount = useSettingsStore(s => s.patchAccount);

  // Always seed from authStore user — never from stale settingsStore defaults
  const initial = {
    name: user?.name || '',
    email: user?.email || '',
    phone: account.phone || '',
    designation: account.designation || '',
  };

  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [isEditing, setIsEditing] = useState(false);
  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function handleSave() {
    if (!isDirty) {
      setIsEditing(false);
      return;
    }
    patchAccount({ name: form.name, email: form.email, phone: form.phone, designation: form.designation });
    setSaved(form);
    updateUser({ name: form.name });
    // Persist name to backend so it survives logout/login
    if (user?.id) {
      try { await userService.updateUser(user.id, { name: form.name }); } catch { /* non-fatal */ }
    }
    setIsEditing(false);
    onSaved();
  }

  function handleDiscard() { setForm(saved); setIsEditing(false); }

  return (
    <>
      <SectionCard title="Personal Information">
        <FieldRow label="Full name" helper="Your display name across the platform">
          {isEditing ? (
            <TextField fullWidth value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} size="small" sx={fieldSx} />
          ) : (
            <Typography sx={{ fontSize: '0.9375rem', color: colors.textStrong, py: 1 }}>{form.name}</Typography>
          )}
        </FieldRow>
        <FieldRow label="Email address" helper="Used for login and notifications">
          {isEditing ? (
            <TextField fullWidth value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} size="small" sx={fieldSx} />
          ) : (
            <Typography sx={{ fontSize: '0.9375rem', color: colors.textStrong, py: 1 }}>{form.email}</Typography>
          )}
        </FieldRow>
        <FieldRow label="Phone" helper="Optional — for SMS notifications">
          {isEditing ? (
            <TextField fullWidth value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} size="small" sx={fieldSx} />
          ) : (
            <Typography sx={{ fontSize: '0.9375rem', color: form.phone ? colors.textStrong : colors.textMuted, py: 1 }}>{form.phone || 'Not provided'}</Typography>
          )}
        </FieldRow>
        <FieldRow label="Job title">
          {isEditing ? (
            <TextField fullWidth value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} size="small" sx={fieldSx} />
          ) : (
            <Typography sx={{ fontSize: '0.9375rem', color: form.designation ? colors.textStrong : colors.textMuted, py: 1 }}>{form.designation || 'Not provided'}</Typography>
          )}
        </FieldRow>
      </SectionCard>
      
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
        {!isEditing ? (
          <Box onClick={() => setIsEditing(true)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 3, py: 1.125, borderRadius: '10px', border: `1px solid ${colors.border}`, color: colors.textStrong, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', '&:hover': { borderColor: colors.textSubdued, backgroundColor: colors.bg } }}>
             Edit details
          </Box>
        ) : (
          <>
            <Box onClick={handleDiscard} sx={{ px: 2.5, py: 1.125, borderRadius: '10px', border: `1px solid ${colors.border}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', '&:hover': { color: colors.textStrong, borderColor: colors.textSubdued }, transition: `all ${motion.durationFast}` }}>
              Cancel
            </Box>
            <Box onClick={handleSave} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 3, py: 1.125, borderRadius: '10px', background: isDirty ? colors.primaryGradient : colors.borderLight, color: isDirty ? '#fff' : colors.textMuted, fontSize: '0.875rem', fontWeight: 600, cursor: isDirty ? 'pointer' : 'default', boxShadow: isDirty ? '0 4px 14px rgba(37,99,235,0.28)' : 'none', transition: `all ${motion.durationFast}` }}>
              Save changes
            </Box>
          </>
        )}
      </Box>
    </>
  );
}

// ── Organization Tab ──────────────────────────────────────────────────────────

function OrganizationTab({ onSaved }: { onSaved: () => void }) {
  const orgSlug = useAuthStore(s => s.user?.org_slug ?? '');
  const organization = useSettingsStore(s => s.organization);
  const patchOrganization = useSettingsStore(s => s.patchOrganization);

  const initial = {
    name: organization.name,
    website: organization.website,
    address: organization.address,
  };

  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [isEditing, setIsEditing] = useState(false);
  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  function handleSave() {
    if (!isDirty) {
      setIsEditing(false);
      return;
    }
    patchOrganization({ name: form.name, website: form.website, address: form.address });
    setSaved(form);
    setIsEditing(false);
    onSaved();
  }

  function handleDiscard() { setForm(saved); setIsEditing(false); }

  return (
    <>
      <SectionCard title="Organization Details">
        <FieldRow label="Organization name">
          {isEditing ? (
            <TextField fullWidth value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} size="small" sx={fieldSx} />
          ) : (
            <Typography sx={{ fontSize: '0.9375rem', color: colors.textStrong, py: 1 }}>{form.name}</Typography>
          )}
        </FieldRow>
        <FieldRow label="Slug" helper="Used in URLs — cannot be changed after creation">
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, py: 1 }}>{orgSlug || '—'}</Typography>
        </FieldRow>
        <FieldRow label="Website">
          {isEditing ? (
            <TextField fullWidth value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} size="small" sx={fieldSx} />
          ) : (
            <Typography sx={{ fontSize: '0.9375rem', color: form.website ? colors.textStrong : colors.textMuted, py: 1 }}>{form.website || 'Not provided'}</Typography>
          )}
        </FieldRow>
        <FieldRow label="Address">
          {isEditing ? (
            <TextField fullWidth value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} size="small" sx={fieldSx} />
          ) : (
            <Typography sx={{ fontSize: '0.9375rem', color: form.address ? colors.textStrong : colors.textMuted, py: 1 }}>{form.address || 'Not provided'}</Typography>
          )}
        </FieldRow>
      </SectionCard>
      
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
        {!isEditing ? (
          <Box onClick={() => setIsEditing(true)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 3, py: 1.125, borderRadius: '10px', border: `1px solid ${colors.border}`, color: colors.textStrong, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', '&:hover': { borderColor: colors.textSubdued, backgroundColor: colors.bg } }}>
             Edit details
          </Box>
        ) : (
          <>
            <Box onClick={handleDiscard} sx={{ px: 2.5, py: 1.125, borderRadius: '10px', border: `1px solid ${colors.border}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', '&:hover': { color: colors.textStrong, borderColor: colors.textSubdued }, transition: `all ${motion.durationFast}` }}>
              Cancel
            </Box>
            <Box onClick={handleSave} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 3, py: 1.125, borderRadius: '10px', background: isDirty ? colors.primaryGradient : colors.borderLight, color: isDirty ? '#fff' : colors.textMuted, fontSize: '0.875rem', fontWeight: 600, cursor: isDirty ? 'pointer' : 'default', boxShadow: isDirty ? '0 4px 14px rgba(37,99,235,0.28)' : 'none', transition: `all ${motion.durationFast}` }}>
              Save changes
            </Box>
          </>
        )}
      </Box>
    </>
  );
}

// ── Security Tab ──────────────────────────────────────────────────────────────

function PwField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <FieldRow label={label}>
      <TextField
        fullWidth
        type={show ? 'text' : 'password'}
        placeholder="••••••••"
        size="small"
        value={value}
        onChange={e => onChange(e.target.value)}
        sx={fieldSx}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setShow(s => !s)} edge="end" tabIndex={-1} sx={{ color: colors.textMuted }}>
                  {show ? <VisibilityOffRounded sx={{ fontSize: 18 }} /> : <VisibilityRounded sx={{ fontSize: 18 }} />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
    </FieldRow>
  );
}

function SecurityTab({ onSaved }: { onSaved: () => void }) {
  const security = useSettingsStore(s => s.security);
  const patchSecurity = useSettingsStore(s => s.patchSecurity);
  const [form, setForm] = useState({ current: '', newPw: '', confirm: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isDirty = !!(form.current || form.newPw || form.confirm);

  async function handleSave() {
    if (!form.current || !form.newPw || !form.confirm) { setError('Please fill in all password fields.'); return; }
    if (form.newPw !== form.confirm) { setError('New passwords do not match.'); return; }
    if (form.newPw.length < 8) { setError('New password must be at least 8 characters.'); return; }
    setError('');
    setSaving(true);
    try {
      await authService.changePassword({ current_password: form.current, new_password: form.newPw });
      setForm({ current: '', newPw: '', confirm: '' });
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to change password. Check your current password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }}>{error}</Alert>}
      <SectionCard title="Change Password">
        <PwField label="Current password" value={form.current} onChange={v => setForm(f => ({ ...f, current: v }))} />
        <PwField label="New password" value={form.newPw} onChange={v => setForm(f => ({ ...f, newPw: v }))} />
        <PwField label="Confirm new password" value={form.confirm} onChange={v => setForm(f => ({ ...f, confirm: v }))} />
      </SectionCard>
      <SectionCard title="Two-Factor Authentication">
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', gap: { xs: 1.5, sm: 0 } }}>
          <Box>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>Authenticator app</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>Use Google Authenticator or similar</Typography>
          </Box>
          <Box sx={{ px: 2, py: 0.75, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, color: security.twoFactorEnabled ? colors.success : colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', '&:hover': { borderColor: colors.primary, color: colors.primary }, transition: `all ${motion.durationFast}` }}
            onClick={() => { patchSecurity({ twoFactorEnabled: !security.twoFactorEnabled }); onSaved(); }}>
            {security.twoFactorEnabled ? '2FA Enabled' : 'Enable 2FA'}
          </Box>
        </Box>
      </SectionCard>
      <FormActions isDirty={isDirty || saving} onSave={handleSave} onDiscard={() => { setForm({ current: '', newPw: '', confirm: '' }); setError(''); }} />
    </>
  );
}


// ── Advanced Tab ──────────────────────────────────────────────────────────────

function AdvancedTab() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <SectionCard title="Application Data">
        <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 2, lineHeight: 1.6 }}>
          Reset all locally stored application data including projects, captures, tours, settings, and session state.
          This returns the app to its initial seeded state. This action cannot be undone.
        </Typography>
        <Box
          onClick={() => setConfirmOpen(true)}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1,
            borderRadius: '8px', border: `1.5px solid ${colors.danger}`, color: colors.danger,
            fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
            '&:hover': { backgroundColor: colors.dangerBg },
            transition: `all ${motion.durationFast}`,
          }}
        >
          Reset Application Data
        </Box>
      </SectionCard>

      <ConfirmDialog
        open={confirmOpen}
        title="Reset application data?"
        description="All projects, captures, tours, notifications, settings, and your login session will be cleared. The page will reload with fresh seed data."
        confirmLabel="Reset everything"
        destructive
        onConfirm={() => { setConfirmOpen(false); resetApplicationData(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [active, setActive] = useState('account');
  const [toastOpen, setToastOpen] = useState(false);
  const user = useAuthStore(s => s.user);

  function handleSaved() { setToastOpen(true); }

  const tabContent: Record<string, React.ReactNode> = {
    account:       <AccountTab onSaved={handleSaved} />,
    security:      <SecurityTab onSaved={handleSaved} />,
    advanced:      <AdvancedTab />,
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Box sx={{ mb: 5 }}>
        <Box component={Link} to={getRoleLandingPath(user?.role)} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
        </Box>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>
          Settings
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Manage your account, team, and preferences</Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 2, md: 4 }, alignItems: 'flex-start' }}>
        <Box sx={{
          width: { xs: '100%', md: 200 }, flexShrink: 0,
          display: 'flex', flexDirection: { xs: 'row', md: 'column' },
          gap: { xs: 0.5, md: 0 },
          overflowX: { xs: 'auto', md: 'visible' },
          pb: { xs: 0.5, md: 0 },
          // hide scrollbar on the mobile tab strip
          '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none',
        }}>
          {tabs.map(t => (
            <Box key={t.key} onClick={() => setActive(t.key)} sx={{
              display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, borderRadius: '8px', cursor: 'pointer', mb: { md: 0.25 },
              flexShrink: 0, whiteSpace: 'nowrap',
              backgroundColor: active === t.key ? colors.primarySoft : 'transparent',
              color: active === t.key ? colors.primary : colors.textSecondary,
              fontSize: '0.875rem', fontWeight: active === t.key ? 600 : 400,
              border: { xs: `1px solid ${active === t.key ? colors.primary : colors.border}`, md: 'none' },
              transition: `all ${motion.durationFast}`,
              '&:hover': { backgroundColor: active === t.key ? colors.primarySoft : colors.bg, color: colors.textStrong },
            }}>
              {t.icon} {t.label}
            </Box>
          ))}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          {tabContent[active]}
        </Box>
      </Box>

      <Snackbar open={toastOpen} autoHideDuration={3000} onClose={() => setToastOpen(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity="success" sx={{ borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }} onClose={() => setToastOpen(false)}>
          Settings saved successfully
        </Alert>
      </Snackbar>
    </Box>
  );
}
