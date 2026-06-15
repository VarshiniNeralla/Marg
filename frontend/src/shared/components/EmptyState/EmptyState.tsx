import React from 'react';
import { Box, Typography } from '@mui/material';
import { colors } from '@theme/tokens';
import Button from '../Button/Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 24px',
        gap: 1.5,
      }}
    >
      {icon && (
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            backgroundColor: colors.primarySoft,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.primary,
            mb: 0.5,
          }}
        >
          {icon}
        </Box>
      )}

      <Typography
        sx={{
          fontSize: '1rem',
          fontWeight: 600,
          color: colors.textStrong,
        }}
      >
        {title}
      </Typography>

      {description && (
        <Typography
          sx={{
            fontSize: '0.875rem',
            color: colors.textMuted,
            maxWidth: 360,
            lineHeight: 1.5,
          }}
        >
          {description}
        </Typography>
      )}

      {action && (
        <Box sx={{ mt: 1 }}>
          <Button variant="primary" size="medium" onClick={action.onClick}>
            {action.label}
          </Button>
        </Box>
      )}
    </Box>
  );
}
