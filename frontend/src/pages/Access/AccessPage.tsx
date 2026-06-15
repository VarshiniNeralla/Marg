import React from 'react';
import { Box, Typography } from '@mui/material';
import { VpnKeyOutlined } from '@mui/icons-material';
import { colors } from '@theme/tokens';

export default function AccessPage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2, color: colors.textMuted }}>
      <VpnKeyOutlined sx={{ fontSize: 48, color: colors.border }} />
      <Typography sx={{ fontWeight: 600, color: colors.textSecondary }}>Access Control</Typography>
      <Typography sx={{ fontSize: '0.875rem' }}>Roles, permissions, and RBAC — coming soon</Typography>
    </Box>
  );
}
