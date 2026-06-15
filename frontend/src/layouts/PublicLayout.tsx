import React from 'react';
import { Outlet } from 'react-router-dom';
import { Box } from '@mui/material';
import { colors } from '@theme/tokens';

interface PublicLayoutProps {
  children?: React.ReactNode;
}

// Minimal wrapper for auth pages. No nav chrome — just a centered surface
// on the app background. Auth cards float centered on #f1f5f9.

export default function PublicLayout({ children }: PublicLayoutProps) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: colors.bg,          // #f1f5f9
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Subtle top accent bar with brand red */}
      <Box
        sx={{
          height: '3px',
          background: `linear-gradient(90deg, ${colors.primary} 0%, ${colors.brandRed} 100%)`,
          flexShrink: 0,
        }}
      />

      {/* Page content */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {children ?? <Outlet />}
      </Box>
    </Box>
  );
}
