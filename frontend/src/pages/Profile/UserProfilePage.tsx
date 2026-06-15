import React, { useState } from 'react';
import { Box, Typography, TextField, Chip, Grid } from '@mui/material';
import { CameraAltRounded, CheckCircleRounded, AccessTimeRounded, ViewInArRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { mockCaptures, mockTours } from '@/data/mockData';

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px',
    fontSize: '0.9375rem',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: 1.5 },
  },
};

const recentActivity = [
  { type: 'capture',  text: 'Uploaded capture for Living Room A',    project: 'My Home Udyan',       time: '2 hours ago' },
  { type: 'review',   text: 'Approved capture for Master Bedroom',   project: 'My Home Apas',        time: '5 hours ago' },
  { type: 'tour',     text: 'Published virtual tour for Floor 3',    project: 'My Home Grava',       time: 'Yesterday' },
  { type: 'capture',  text: 'Uploaded 4 captures for Utility Room',  project: 'My Home Vyoma',       time: '2 days ago' },
  { type: 'review',   text: 'Requested re-upload for Bathroom 2B',   project: 'My Home Udyan',       time: '3 days ago' },
];

const activityIcon: Record<string, React.ReactNode> = {
  capture: <CameraAltRounded sx={{ fontSize: 14 }} />,
  review:  <CheckCircleRounded sx={{ fontSize: 14 }} />,
  tour:    <ViewInArRounded sx={{ fontSize: 14 }} />,
};
const activityColor: Record<string, string> = {
  capture: '#2563eb',
  review:  '#16a34a',
  tour:    '#7c3aed',
};

export default function UserProfilePage() {
  const [saved, setSaved] = useState(false);
  const myCaptures = mockCaptures.filter(c => c.uploadedBy === 'Ravi Kumar').length;
  const myTours = mockTours.filter(t => t.status === 'published').length;
  const pending = mockCaptures.filter(c => c.status === 'review').length;

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
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
              <Box sx={{ width: 88, height: 88, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto' }}>
                <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: '#fff' }}>R</Typography>
              </Box>
              <Box sx={{ position: 'absolute', bottom: 2, right: 2, width: 24, height: 24, borderRadius: '50%', backgroundColor: colors.card, border: `2px solid ${colors.card}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
                <CameraAltRounded sx={{ fontSize: 12, color: colors.textMuted }} />
              </Box>
            </Box>
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.125rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em' }}>Ravi Kumar</Typography>
            <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 1.5 }}>Site Manager</Typography>
            <Chip label="Admin" size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 700, color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.1)', borderRadius: '6px' }} />
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
                <TextField fullWidth defaultValue="Ravi Kumar" size="small" sx={fieldSx} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Job title</Typography>
                <TextField fullWidth defaultValue="Site Manager" size="small" sx={fieldSx} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Email address</Typography>
                <TextField fullWidth defaultValue="admin@demo.com" size="small" sx={fieldSx} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Phone</Typography>
                <TextField fullWidth defaultValue="+91 98765 43210" size="small" sx={fieldSx} />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Bio</Typography>
                <TextField fullWidth multiline rows={3} defaultValue="Site manager at My Home Constructions with 8+ years of experience in residential construction documentation." size="small" sx={fieldSx} />
              </Grid>
            </Grid>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
              <Box onClick={handleSave} sx={{ display: 'inline-flex', alignItems: 'center', px: 2.5, py: 1, borderRadius: '8px', background: saved ? 'rgba(22,163,74,0.12)' : colors.primaryGradient, color: saved ? '#16a34a' : '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', boxShadow: saved ? 'none' : '0 4px 14px rgba(37,99,235,0.28)' }}>
                {saved ? '✓ Saved' : 'Save changes'}
              </Box>
            </Box>
          </Box>

          {/* Recent activity */}
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 3 }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 2.5 }}>Recent Activity</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {recentActivity.map((a, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 2, py: 1.75, borderBottom: i < recentActivity.length - 1 ? `1px solid ${colors.borderLight}` : 'none', alignItems: 'flex-start' }}>
                  <Box sx={{ width: 28, height: 28, borderRadius: '8px', backgroundColor: `${activityColor[a.type]}15`, color: activityColor[a.type], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.125 }}>
                    {activityIcon[a.type]}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: '0.875rem', color: colors.textStrong, fontWeight: 500 }}>{a.text}</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{a.project}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, flexShrink: 0, mt: 0.25 }}>{a.time}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
