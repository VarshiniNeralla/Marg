import React, { useState } from 'react';
import { Box, Typography, TextField, Switch, Select, MenuItem, Snackbar, Alert } from '@mui/material';
import {
  PersonRounded, BusinessRounded, PeopleRounded, NotificationsRounded,
  LockRounded, PaletteRounded, CheckRounded, WarningAmberRounded, StorageRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';
import { useSettingsStore, NOTIF_PREF_KEYS, NOTIF_PREF_DEFAULTS } from '@store/settingsStore';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { resetApplicationData } from '@store/resetApplicationData';

// ── Shared primitives ─────────────────────────────────────────────────────────

const tabs = [
  { key: 'account',       label: 'Account',        icon: <PersonRounded sx={{ fontSize: 16 }} /> },
  { key: 'organization',  label: 'Organization',   icon: <BusinessRounded sx={{ fontSize: 16 }} /> },
  { key: 'team',          label: 'Team',           icon: <PeopleRounded sx={{ fontSize: 16 }} /> },
  { key: 'notifications', label: 'Notifications',  icon: <NotificationsRounded sx={{ fontSize: 16 }} /> },
  { key: 'security',      label: 'Security',       icon: <LockRounded sx={{ fontSize: 16 }} /> },
  { key: 'appearance',    label: 'Appearance',     icon: <PaletteRounded sx={{ fontSize: 16 }} /> },
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
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, py: 2, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
      <Box sx={{ width: 200, flexShrink: 0, pt: 0.5 }}>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{label}</Typography>
        {helper && <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>{helper}</Typography>}
      </Box>
      <Box sx={{ flex: 1 }}>{children}</Box>
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

  const initial = {
    name: account.name || user?.name || 'Ravi Kumar',
    email: account.email || user?.email || 'admin@demo.com',
    phone: account.phone,
    designation: account.designation,
  };

  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  function handleSave() {
    patchAccount({ name: form.name, email: form.email, phone: form.phone, designation: form.designation });
    setSaved(form);
    updateUser({ name: form.name });
    onSaved();
  }

  function handleDiscard() { setForm(saved); }

  return (
    <>
      <SectionCard title="Personal Information">
        <FieldRow label="Full name" helper="Your display name across the platform">
          <TextField fullWidth value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Email address" helper="Used for login and notifications">
          <TextField fullWidth value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Phone" helper="Optional — for SMS notifications">
          <TextField fullWidth value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Job title">
          <TextField fullWidth value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} size="small" sx={fieldSx} />
        </FieldRow>
      </SectionCard>
      <FormActions isDirty={isDirty} onSave={handleSave} onDiscard={handleDiscard} />
    </>
  );
}

// ── Organization Tab ──────────────────────────────────────────────────────────

function OrganizationTab({ onSaved }: { onSaved: () => void }) {
  const organization = useSettingsStore(s => s.organization);
  const patchOrganization = useSettingsStore(s => s.patchOrganization);

  const initial = {
    name: organization.name,
    website: organization.website,
    address: organization.address,
  };

  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  function handleSave() {
    patchOrganization({ name: form.name, website: form.website, address: form.address });
    setSaved(form);
    onSaved();
  }

  return (
    <>
      <SectionCard title="Organization Details">
        <FieldRow label="Organization name">
          <TextField fullWidth value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Slug" helper="Used in URLs — cannot be changed after creation">
          <TextField fullWidth defaultValue="demo" size="small" disabled sx={{ ...fieldSx, opacity: 0.6 }} />
        </FieldRow>
        <FieldRow label="Website">
          <TextField fullWidth value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Address">
          <TextField fullWidth value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} size="small" sx={fieldSx} />
        </FieldRow>
      </SectionCard>
      <FormActions isDirty={isDirty} onSave={handleSave} onDiscard={() => setForm(saved)} />
    </>
  );
}

// ── Team Tab ──────────────────────────────────────────────────────────────────

function TeamTab() {
  const members = useSettingsStore(s => s.teamMembers);
  const setTeamMembers = useSettingsStore(s => s.setTeamMembers);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Member');

  function handleInvite() {
    if (!inviteEmail) return;
    setTeamMembers([...members, { name: inviteEmail.split('@')[0], email: inviteEmail, role: inviteRole, status: 'Invited' }]);
    setShowInvite(false);
    setInviteEmail('');
    setInviteRole('Member');
  }

  function handleRemove(email: string) {
    setTeamMembers(members.filter(x => x.email !== email));
  }

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>{members.length} members</Typography>
        <Box onClick={() => setShowInvite(!showInvite)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
          + Invite member
        </Box>
      </Box>

      {showInvite && (
        <Box sx={{ p: 2.5, borderRadius: '12px', border: `1px solid ${colors.borderLight}`, mb: 3, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField placeholder="Email address" size="small" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} sx={{ flex: 1, minWidth: 200, ...fieldSx }} />
          <Select value={inviteRole} onChange={e => setInviteRole(e.target.value as string)} size="small" sx={{ minWidth: 120, borderRadius: '10px', fontSize: '0.875rem' }}>
            {['Admin', 'Reviewer', 'Member'].map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
          </Select>
          <Box onClick={handleInvite} sx={{ px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
            Send invitation
          </Box>
          <Box onClick={() => setShowInvite(false)} sx={{ px: 2, py: 0.875, borderRadius: '8px', border: `1px solid ${colors.border}`, color: colors.textMuted, fontSize: '0.875rem', cursor: 'pointer' }}>
            Cancel
          </Box>
        </Box>
      )}

      <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
        {members.map((m, i) => (
          <Box key={m.email} sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, py: 2, borderBottom: i < members.length - 1 ? `1px solid ${colors.borderLight}` : 'none' }}>
            <Box sx={{ width: 36, height: 36, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: '#fff' }}>{m.name[0]}</Typography>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{m.name}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{m.email}</Typography>
            </Box>
            <Box sx={{ px: 1.5, py: 0.25, borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, color: m.role === 'Admin' ? '#7c3aed' : colors.textSecondary, backgroundColor: m.role === 'Admin' ? 'rgba(124,58,237,0.08)' : colors.bgDeep }}>
              {m.role}
            </Box>
            <Box sx={{ px: 1.25, py: 0.25, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 600, color: m.status === 'Active' ? '#16a34a' : '#d97706', backgroundColor: m.status === 'Active' ? 'rgba(22,163,74,0.08)' : 'rgba(217,119,6,0.08)' }}>
              {m.status}
            </Box>
            {m.role !== 'Admin' && (
              <Box onClick={() => handleRemove(m.email)} sx={{ px: 1.5, py: 0.25, borderRadius: '6px', fontSize: '0.75rem', color: colors.danger, cursor: 'pointer', '&:hover': { backgroundColor: colors.dangerBg } }}>
                Remove
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </>
  );
}

// ── Notifications Tab ─────────────────────────────────────────────────────────

const NOTIF_PREFS = NOTIF_PREF_KEYS.map(key => ({
  key,
  label: key === 'capture_upload' ? 'Capture uploaded'
    : key === 'capture_review' ? 'Review required'
    : key === 'tour_published' ? 'Tour published'
    : key === 'project_update' ? 'Project updates'
    : key === 'team_invite' ? 'Team invitations'
    : 'Weekly digest',
  sub: key === 'capture_upload' ? 'When a new capture is uploaded to any project'
    : key === 'capture_review' ? 'When a capture is marked for your review'
    : key === 'tour_published' ? 'When a virtual tour is published'
    : key === 'project_update' ? 'Progress milestones and status changes'
    : key === 'team_invite' ? 'When someone invites you to a project'
    : 'Summary of activity every Monday morning',
  default: NOTIF_PREF_DEFAULTS[key],
}));

function NotificationsTab({ onSaved }: { onSaved: () => void }) {
  const storedNotifs = useSettingsStore(s => s.notifications);
  const patchNotifications = useSettingsStore(s => s.patchNotifications);
  const initial: Record<string, boolean> = Object.fromEntries(
    NOTIF_PREF_KEYS.map(k => [k, storedNotifs[k] ?? NOTIF_PREF_DEFAULTS[k]]),
  );
  const [state, setState] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const isDirty = JSON.stringify(state) !== JSON.stringify(saved);

  function handleSave() {
    patchNotifications(state);
    setSaved(state);
    onSaved();
  }

  return (
    <>
      <SectionCard title="Email Notifications">
        {NOTIF_PREFS.map((p, i) => (
          <Box key={p.key} sx={{ display: 'flex', alignItems: 'center', py: 1.75, borderBottom: i < NOTIF_PREFS.length - 1 ? `1px solid ${colors.borderLight}` : 'none' }}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{p.label}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{p.sub}</Typography>
            </Box>
            <Switch checked={state[p.key]} onChange={() => setState(s => ({ ...s, [p.key]: !s[p.key] }))} size="small" />
          </Box>
        ))}
      </SectionCard>
      <FormActions isDirty={isDirty} onSave={handleSave} onDiscard={() => setState(saved)} />
    </>
  );
}

// ── Security Tab ──────────────────────────────────────────────────────────────

function SecurityTab({ onSaved }: { onSaved: () => void }) {
  const security = useSettingsStore(s => s.security);
  const patchSecurity = useSettingsStore(s => s.patchSecurity);
  const [form, setForm] = useState({ current: '', newPw: '', confirm: '' });
  const [error, setError] = useState('');
  const isDirty = !!(form.current || form.newPw || form.confirm);

  function handleSave() {
    if (!form.current || !form.newPw || !form.confirm) { setError('Please fill in all password fields.'); return; }
    if (form.newPw !== form.confirm) { setError('New passwords do not match.'); return; }
    if (form.newPw.length < 8) { setError('New password must be at least 8 characters.'); return; }
    setError('');
    setForm({ current: '', newPw: '', confirm: '' });
    onSaved();
  }

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }}>{error}</Alert>}
      <SectionCard title="Change Password">
        <FieldRow label="Current password">
          <TextField fullWidth type="password" placeholder="••••••••" size="small" value={form.current} onChange={e => setForm(f => ({ ...f, current: e.target.value }))} sx={fieldSx} />
        </FieldRow>
        <FieldRow label="New password">
          <TextField fullWidth type="password" placeholder="••••••••" size="small" value={form.newPw} onChange={e => setForm(f => ({ ...f, newPw: e.target.value }))} sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Confirm new password">
          <TextField fullWidth type="password" placeholder="••••••••" size="small" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} sx={fieldSx} />
        </FieldRow>
      </SectionCard>
      <SectionCard title="Two-Factor Authentication">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
      <FormActions isDirty={isDirty} onSave={handleSave} onDiscard={() => { setForm({ current: '', newPw: '', confirm: '' }); setError(''); }} />
    </>
  );
}

// ── Appearance Tab ────────────────────────────────────────────────────────────

function AppearanceTab({ onSaved }: { onSaved: () => void }) {
  const appearance = useSettingsStore(s => s.appearance);
  const patchAppearance = useSettingsStore(s => s.patchAppearance);

  const initial = { theme: appearance.theme, density: appearance.density };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  function handleSave() {
    patchAppearance({ theme: form.theme, density: form.density });
    setSaved(form);
    onSaved();
  }

  return (
    <>
      <SectionCard title="Display Preferences">
        <FieldRow label="Theme" helper="Light mode is currently the only supported mode">
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {(['light', 'system'] as const).map(t => (
              <Box key={t} onClick={() => setForm(f => ({ ...f, theme: t }))} sx={{ px: 2.5, py: 1, borderRadius: '8px', border: `1.5px solid ${form.theme === t ? colors.primary : colors.borderLight}`, color: form.theme === t ? colors.primary : colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize', transition: `all ${motion.durationFast}`, backgroundColor: form.theme === t ? colors.primarySoft : 'transparent' }}>
                {t === 'light' ? 'Light' : 'System'}
              </Box>
            ))}
          </Box>
        </FieldRow>
        <FieldRow label="Density" helper="Controls spacing throughout the interface">
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {(['comfortable', 'compact'] as const).map(d => (
              <Box key={d} onClick={() => setForm(f => ({ ...f, density: d }))} sx={{ px: 2.5, py: 1, borderRadius: '8px', border: `1.5px solid ${form.density === d ? colors.primary : colors.borderLight}`, color: form.density === d ? colors.primary : colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize', transition: `all ${motion.durationFast}`, backgroundColor: form.density === d ? colors.primarySoft : 'transparent' }}>
                {d}
              </Box>
            ))}
          </Box>
        </FieldRow>
      </SectionCard>
      <FormActions isDirty={isDirty} onSave={handleSave} onDiscard={() => setForm(saved)} />
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

  function handleSaved() { setToastOpen(true); }

  const tabContent: Record<string, React.ReactNode> = {
    account:       <AccountTab onSaved={handleSaved} />,
    organization:  <OrganizationTab onSaved={handleSaved} />,
    team:          <TeamTab />,
    notifications: <NotificationsTab onSaved={handleSaved} />,
    security:      <SecurityTab onSaved={handleSaved} />,
    appearance:    <AppearanceTab onSaved={handleSaved} />,
    advanced:      <AdvancedTab />,
  };

  return (
    <Box>
      <Box sx={{ mb: 5 }}>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>
          Settings
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Manage your account, organization, and preferences</Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        <Box sx={{ width: 200, flexShrink: 0 }}>
          {tabs.map(t => (
            <Box key={t.key} onClick={() => setActive(t.key)} sx={{
              display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, borderRadius: '8px', cursor: 'pointer', mb: 0.25,
              backgroundColor: active === t.key ? colors.primarySoft : 'transparent',
              color: active === t.key ? colors.primary : colors.textSecondary,
              fontSize: '0.875rem', fontWeight: active === t.key ? 600 : 400,
              transition: `all ${motion.durationFast}`,
              '&:hover': { backgroundColor: active === t.key ? colors.primarySoft : colors.bg, color: colors.textStrong },
            }}>
              {t.icon} {t.label}
            </Box>
          ))}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
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
