import React from 'react';
import { Box, Typography } from '@mui/material';
import { SettingsOutlined } from '@mui/icons-material';
import { colors } from '@theme/tokens';

export default function SettingsPage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2, color: colors.textMuted }}>
      <SettingsOutlined sx={{ fontSize: 48, color: colors.border }} />
      <Typography sx={{ fontWeight: 600, color: colors.textSecondary }}>Settings</Typography>
      <Typography sx={{ fontSize: '0.875rem' }}>Profile, notifications, and preferences — coming soon</Typography>
    </Box>
  );
}
