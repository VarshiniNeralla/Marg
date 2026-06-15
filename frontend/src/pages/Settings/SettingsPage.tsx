import React, { useState } from 'react';
import { Box, Typography, TextField, Switch, Divider, Select, MenuItem } from '@mui/material';
import {
  PersonRounded, BusinessRounded, PeopleRounded, NotificationsRounded,
  LockRounded, PaletteRounded,
} from '@mui/icons-material';
import { colors } from '@theme/tokens';

const tabs = [
  { key: 'account',       label: 'Account',        icon: <PersonRounded sx={{ fontSize: 16 }} /> },
  { key: 'organization',  label: 'Organization',   icon: <BusinessRounded sx={{ fontSize: 16 }} /> },
  { key: 'team',          label: 'Team',           icon: <PeopleRounded sx={{ fontSize: 16 }} /> },
  { key: 'notifications', label: 'Notifications',  icon: <NotificationsRounded sx={{ fontSize: 16 }} /> },
  { key: 'security',      label: 'Security',       icon: <LockRounded sx={{ fontSize: 16 }} /> },
  { key: 'appearance',    label: 'Appearance',     icon: <PaletteRounded sx={{ fontSize: 16 }} /> },
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

function SaveButton({ onClick }: { onClick?: () => void }) {
  const [saved, setSaved] = useState(false);
  function handleClick() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onClick?.();
  }
  return (
    <Box onClick={handleClick} sx={{ display: 'inline-flex', alignItems: 'center', px: 2.5, py: 1, borderRadius: '8px', background: saved ? 'rgba(22,163,74,0.12)' : colors.primaryGradient, color: saved ? '#16a34a' : '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', boxShadow: saved ? 'none' : '0 4px 14px rgba(37,99,235,0.28)' }}>
      {saved ? '✓ Saved' : 'Save changes'}
    </Box>
  );
}

function AccountTab() {
  return (
    <>
      <SectionCard title="Personal Information">
        <FieldRow label="Full name" helper="Your display name across the platform">
          <TextField fullWidth defaultValue="Ravi Kumar" size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Email address" helper="Used for login and notifications">
          <TextField fullWidth defaultValue="admin@demo.com" size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Phone" helper="Optional — for SMS notifications">
          <TextField fullWidth defaultValue="+91 98765 43210" size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Job title">
          <TextField fullWidth defaultValue="Site Manager" size="small" sx={fieldSx} />
        </FieldRow>
      </SectionCard>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}><SaveButton /></Box>
    </>
  );
}

function OrganizationTab() {
  return (
    <>
      <SectionCard title="Organization Details">
        <FieldRow label="Organization name">
          <TextField fullWidth defaultValue="My Home Constructions" size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Slug" helper="Used in URLs — cannot be changed after creation">
          <TextField fullWidth defaultValue="demo" size="small" disabled sx={{ ...fieldSx, opacity: 0.6 }} />
        </FieldRow>
        <FieldRow label="Website">
          <TextField fullWidth defaultValue="https://myhomeconstructions.com" size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Address">
          <TextField fullWidth defaultValue="Hyderabad, Telangana, India" size="small" sx={fieldSx} />
        </FieldRow>
      </SectionCard>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}><SaveButton /></Box>
    </>
  );
}

function TeamTab() {
  const members = [
    { name: 'Ravi Kumar',  email: 'ravi@demo.com',  role: 'Admin',    status: 'Active' },
    { name: 'Anil P',      email: 'anil@demo.com',  role: 'Reviewer', status: 'Active' },
    { name: 'Kiran Desai', email: 'kiran@demo.com', role: 'Member',   status: 'Active' },
    { name: 'Meena R',     email: 'meena@demo.com', role: 'Member',   status: 'Invited' },
  ];
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>{members.length} members</Typography>
        <Box onClick={() => setShowInvite(!showInvite)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
          + Invite member
        </Box>
      </Box>

      {showInvite && (
        <Box sx={{ p: 2.5, borderRadius: '12px', border: `1px solid ${colors.borderLight}`, mb: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField placeholder="Email address" size="small" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} sx={{ flex: 1, ...fieldSx }} />
          <Select defaultValue="Member" size="small" sx={{ minWidth: 120, borderRadius: '10px', fontSize: '0.875rem' }}>
            {['Admin', 'Reviewer', 'Member'].map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
          </Select>
          <Box onClick={() => { setShowInvite(false); setInviteEmail(''); }} sx={{ px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
            Send
          </Box>
        </Box>
      )}

      <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
        {members.map((m, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 3, py: 2, borderBottom: i < members.length - 1 ? `1px solid ${colors.borderLight}` : 'none' }}>
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
          </Box>
        ))}
      </Box>
    </>
  );
}

function NotificationsTab() {
  const prefs = [
    { key: 'capture_upload', label: 'Capture uploaded', sub: 'When a new capture is uploaded to any project', default: true },
    { key: 'capture_review', label: 'Review required',  sub: 'When a capture is marked for your review',    default: true },
    { key: 'tour_published', label: 'Tour published',   sub: 'When a virtual tour is published',            default: false },
    { key: 'project_update', label: 'Project updates',  sub: 'Progress milestones and status changes',      default: true },
    { key: 'team_invite',    label: 'Team invitations', sub: 'When someone invites you to a project',       default: true },
    { key: 'weekly_digest',  label: 'Weekly digest',    sub: 'Summary of activity every Monday morning',    default: false },
  ];
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(prefs.map(p => [p.key, p.default]))
  );
  return (
    <SectionCard title="Email Notifications">
      {prefs.map((p, i) => (
        <Box key={p.key} sx={{ display: 'flex', alignItems: 'center', py: 1.75, borderBottom: i < prefs.length - 1 ? `1px solid ${colors.borderLight}` : 'none' }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{p.label}</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{p.sub}</Typography>
          </Box>
          <Switch checked={state[p.key]} onChange={() => setState(s => ({ ...s, [p.key]: !s[p.key] }))} size="small" />
        </Box>
      ))}
    </SectionCard>
  );
}

function SecurityTab() {
  return (
    <>
      <SectionCard title="Change Password">
        <FieldRow label="Current password">
          <TextField fullWidth type="password" placeholder="••••••••" size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="New password">
          <TextField fullWidth type="password" placeholder="••••••••" size="small" sx={fieldSx} />
        </FieldRow>
        <FieldRow label="Confirm new password">
          <TextField fullWidth type="password" placeholder="••••••••" size="small" sx={fieldSx} />
        </FieldRow>
      </SectionCard>
      <SectionCard title="Two-Factor Authentication">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>Authenticator app</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>Use Google Authenticator or similar</Typography>
          </Box>
          <Box sx={{ px: 2, py: 0.75, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', '&:hover': { borderColor: colors.primary, color: colors.primary } }}>
            Enable 2FA
          </Box>
        </Box>
      </SectionCard>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}><SaveButton /></Box>
    </>
  );
}

function AppearanceTab() {
  const [theme, setTheme] = useState<'light' | 'system'>('light');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  return (
    <SectionCard title="Display Preferences">
      <FieldRow label="Theme" helper="Light mode is currently the only supported mode">
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {(['light', 'system'] as const).map(t => (
            <Box key={t} onClick={() => setTheme(t)} sx={{ px: 2.5, py: 1, borderRadius: '8px', border: `1.5px solid ${theme === t ? colors.primary : colors.borderLight}`, color: theme === t ? colors.primary : colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.15s' }}>
              {t === 'light' ? 'Light' : 'System'}
            </Box>
          ))}
        </Box>
      </FieldRow>
      <FieldRow label="Density" helper="Controls spacing throughout the interface">
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {(['comfortable', 'compact'] as const).map(d => (
            <Box key={d} onClick={() => setDensity(d)} sx={{ px: 2.5, py: 1, borderRadius: '8px', border: `1.5px solid ${density === d ? colors.primary : colors.borderLight}`, color: density === d ? colors.primary : colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.15s' }}>
              {d}
            </Box>
          ))}
        </Box>
      </FieldRow>
    </SectionCard>
  );
}

const tabContent: Record<string, React.ReactNode> = {
  account:       <AccountTab />,
  organization:  <OrganizationTab />,
  team:          <TeamTab />,
  notifications: <NotificationsTab />,
  security:      <SecurityTab />,
  appearance:    <AppearanceTab />,
};

export default function SettingsPage() {
  const [active, setActive] = useState('account');

  return (
    <Box>
      <Box sx={{ mb: 5 }}>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>
          Settings
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Manage your account, organization, and preferences</Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        {/* Sidebar */}
        <Box sx={{ width: 200, flexShrink: 0 }}>
          {tabs.map(t => (
            <Box
              key={t.key}
              onClick={() => setActive(t.key)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, borderRadius: '8px', cursor: 'pointer', mb: 0.25,
                backgroundColor: active === t.key ? colors.primarySoft : 'transparent',
                color: active === t.key ? colors.primary : colors.textSecondary,
                fontSize: '0.875rem', fontWeight: active === t.key ? 600 : 400,
                transition: 'all 0.15s',
                '&:hover': { backgroundColor: active === t.key ? colors.primarySoft : colors.bg, color: colors.textStrong },
              }}
            >
              {t.icon} {t.label}
            </Box>
          ))}
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {tabContent[active]}
        </Box>
      </Box>
    </Box>
  );
}
