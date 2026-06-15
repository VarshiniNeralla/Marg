import React from 'react';
import { Outlet } from 'react-router-dom';
import { Box } from '@mui/material';
import { colors } from '@theme/tokens';

export default function LandingLayout() {
  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: colors.bg }}>
      <Outlet />
    </Box>
  );
}
