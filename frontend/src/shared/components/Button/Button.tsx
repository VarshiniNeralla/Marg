import React from 'react';
import {
  Button as MuiButton,
  CircularProgress,
  type ButtonProps as MuiButtonProps,
} from '@mui/material';
import { colors, radii, motion } from '@theme/tokens';

export interface ButtonProps extends Omit<MuiButtonProps, 'variant'> {
  variant?: 'primary' | 'secondary' | 'outlined' | 'ghost' | 'danger';
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'start' | 'end';
}

const variantMap: Record<
  NonNullable<ButtonProps['variant']>,
  { muiVariant: MuiButtonProps['variant']; sx: object }
> = {
  primary: {
    muiVariant: 'contained',
    sx: {
      background: colors.primaryGradient,
      color: colors.white,
      '&:hover': {
        background: `linear-gradient(135deg, ${colors.primaryHover} 0%, ${colors.primaryActive} 100%)`,
        boxShadow: '0 4px 14px rgba(37, 99, 235, 0.32)',
      },
    },
  },
  secondary: {
    muiVariant: 'outlined',
    sx: {
      borderColor: colors.border,
      color: colors.text,
      background: colors.white,
      '&:hover': {
        borderColor: colors.primary,
        color: colors.primary,
        background: colors.primarySoft,
      },
    },
  },
  outlined: {
    muiVariant: 'outlined',
    sx: {
      borderColor: colors.primary,
      color: colors.primary,
      '&:hover': {
        background: colors.primarySoft,
      },
    },
  },
  ghost: {
    muiVariant: 'text',
    sx: {
      color: colors.textMuted,
      '&:hover': { background: colors.primarySoft, color: colors.primary },
    },
  },
  danger: {
    muiVariant: 'contained',
    sx: {
      background: `linear-gradient(180deg, #ef4444 0%, #dc2626 100%)`,
      color: colors.white,
      '&:hover': {
        background: `linear-gradient(180deg, #dc2626 0%, #b91c1c 100%)`,
      },
    },
  },
};

export default function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  icon,
  iconPosition = 'start',
  sx,
  ...rest
}: ButtonProps) {
  const { muiVariant, sx: variantSx } = variantMap[variant];

  return (
    <MuiButton
      variant={muiVariant}
      disabled={disabled || loading}
      startIcon={!loading && icon && iconPosition === 'start' ? icon : undefined}
      endIcon={!loading && icon && iconPosition === 'end' ? icon : undefined}
      sx={{
        borderRadius: radii.sm,
        fontWeight: 500,
        textTransform: 'none',
        transition: `all ${motion.durationNormal} ${motion.easeOut}`,
        position: 'relative',
        minWidth: loading ? '100px' : undefined,
        ...variantSx,
        ...sx,
      }}
      {...rest}
    >
      {loading ? (
        <>
          <CircularProgress
            size={14}
            thickness={3}
            sx={{
              color: variant === 'primary' || variant === 'danger'
                ? 'rgba(255,255,255,0.8)'
                : colors.primary,
              mr: 1,
            }}
          />
          Loading…
        </>
      ) : (
        children
      )}
    </MuiButton>
  );
}
