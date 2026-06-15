import React from 'react';
import { Box, Typography } from '@mui/material';
import { PeopleOutlined } from '@mui/icons-material';
import { colors } from '@theme/tokens';

export default function UsersPage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2, color: colors.textMuted }}>
      <PeopleOutlined sx={{ fontSize: 48, color: colors.border }} />
      <Typography sx={{ fontWeight: 600, color: colors.textSecondary }}>Users</Typography>
      <Typography sx={{ fontSize: '0.875rem' }}>Team member management — coming soon</Typography>
    </Box>
  );
}
