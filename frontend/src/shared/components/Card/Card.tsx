import React from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';
import { colors, radii, shadows, motion } from '@theme/tokens';

export interface CardProps {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
  onClick?: () => void;
  hoverable?: boolean;
  padding?: string | number;
  // Optional 3px top accent bar (admin-metric-card pattern from style guide)
  accentColor?: string;
}

export default function Card({
  children,
  sx,
  onClick,
  hoverable = false,
  padding = '20px 24px',
  accentColor,
}: CardProps) {
  return (
    <Box
      onClick={onClick}
      sx={{
        backgroundColor: colors.card,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.md,              // 12px
        boxShadow: shadows.sm,
        padding,
        position: 'relative',
        overflow: 'hidden',
        transition: hoverable
          ? `box-shadow ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}`
          : undefined,
        cursor: onClick || hoverable ? 'pointer' : 'default',
        ...(hoverable && {
          '&:hover': {
            boxShadow: shadows.md,
            transform: 'translateY(-1px)',
          },
        }),
        // 3px top accent bar — matches admin metric card pattern
        ...(accentColor && {
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            background: accentColor,
            borderRadius: `${radii.md} ${radii.md} 0 0`,
          },
        }),
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
