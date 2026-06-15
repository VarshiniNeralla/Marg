import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { colors } from '@theme/tokens';

interface LoadingScreenProps {
  message?: string;
  fullscreen?: boolean;
}

export default function LoadingScreen({
  message,
  fullscreen = true,
}: LoadingScreenProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minHeight: fullscreen ? '100vh' : '240px',
        background: fullscreen ? colors.bg : 'transparent',
      }}
    >
      <CircularProgress
        size={36}
        thickness={3}
        sx={{ color: colors.primary }}
      />
      {message && (
        <p style={{
          fontSize: '0.875rem',
          color: colors.textMuted,
          margin: 0,
        }}>
          {message}
        </p>
      )}
    </Box>
  );
}
