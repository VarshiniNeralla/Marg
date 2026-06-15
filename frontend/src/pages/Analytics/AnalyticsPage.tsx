import React from 'react';
import { Box, Typography } from '@mui/material';
import { BarChartOutlined } from '@mui/icons-material';
import { colors } from '@theme/tokens';

export default function AnalyticsPage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2, color: colors.textMuted }}>
      <BarChartOutlined sx={{ fontSize: 48, color: colors.border }} />
      <Typography sx={{ fontWeight: 600, color: colors.textSecondary }}>Analytics</Typography>
      <Typography sx={{ fontSize: '0.875rem' }}>Tour views, engagement metrics, and reports — coming soon</Typography>
    </Box>
  );
}
