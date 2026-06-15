import React from 'react';
import { Box, Typography } from '@mui/material';
import { colors, motion } from '@theme/tokens';
import Button from '../Button/Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  compact?: boolean;
}

export default function EmptyState({
  icon, title, description, action, secondaryAction, compact = false,
}: EmptyStateProps) {
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: compact ? '32px 24px' : '56px 24px', gap: 1.5,
    }}>
      {icon && (
        <Box sx={{
          width: compact ? 48 : 64, height: compact ? 48 : 64, borderRadius: '50%',
          backgroundColor: colors.primarySoft, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: colors.primary, mb: 0.5,
          '& svg': { fontSize: compact ? 22 : 28 },
        }}>
          {icon}
        </Box>
      )}

      <Box>
        <Typography sx={{ fontSize: compact ? '0.9375rem' : '1.0625rem', fontWeight: 700, color: colors.textStrong, mb: 0.5, letterSpacing: '-0.02em' }}>
          {title}
        </Typography>
        {description && (
          <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, maxWidth: 360, lineHeight: 1.6 }}>
            {description}
          </Typography>
        )}
      </Box>

      {(action || secondaryAction) && (
        <Box sx={{ mt: 0.5, display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'center' }}>
          {action && (
            <Button variant="primary" size="medium" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Box onClick={secondaryAction.onClick} sx={{
              display: 'inline-flex', alignItems: 'center', px: 2, py: 0.875, borderRadius: '8px',
              border: `1.5px solid ${colors.border}`, color: colors.textSecondary, fontWeight: 500,
              fontSize: '0.875rem', cursor: 'pointer', '&:hover': { borderColor: colors.primary, color: colors.primary },
              transition: `all ${motion.durationFast}`,
            }}>
              {secondaryAction.label}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
