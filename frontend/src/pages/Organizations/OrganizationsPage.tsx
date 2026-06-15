import React from 'react';
import { Box, Typography } from '@mui/material';
import { BusinessOutlined } from '@mui/icons-material';
import { colors } from '@theme/tokens';

export default function OrganizationsPage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2, color: colors.textMuted }}>
      <BusinessOutlined sx={{ fontSize: 48, color: colors.border }} />
      <Typography sx={{ fontWeight: 600, color: colors.textSecondary }}>Organizations</Typography>
      <Typography sx={{ fontSize: '0.875rem' }}>Multi-tenant organization management — coming soon</Typography>
    </Box>
  );
}
