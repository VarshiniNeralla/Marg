import React from 'react';
import {
  TextField,
  InputAdornment,
  IconButton,
  type TextFieldProps,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { colors } from '@theme/tokens';

export interface InputProps extends Omit<TextFieldProps, 'variant'> {
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  isPassword?: boolean;
}

export default function Input({
  startIcon,
  endIcon,
  isPassword = false,
  type,
  sx,
  ...rest
}: InputProps) {
  const [showPassword, setShowPassword] = React.useState(false);

  const resolvedType =
    isPassword ? (showPassword ? 'text' : 'password') : type;

  const endAdornment = isPassword ? (
    <InputAdornment position="end">
      <IconButton
        onClick={() => setShowPassword((v) => !v)}
        edge="end"
        size="small"
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        sx={{ color: colors.textMuted, '&:hover': { color: colors.primary } }}
      >
        {showPassword ? (
          <VisibilityOff fontSize="small" />
        ) : (
          <Visibility fontSize="small" />
        )}
      </IconButton>
    </InputAdornment>
  ) : endIcon ? (
    <InputAdornment position="end">{endIcon}</InputAdornment>
  ) : undefined;

  return (
    <TextField
      variant="outlined"
      type={resolvedType}
      fullWidth
      slotProps={{
        input: {
          startAdornment: startIcon ? (
            <InputAdornment position="start" sx={{ color: colors.textMuted }}>
              {startIcon}
            </InputAdornment>
          ) : undefined,
          endAdornment,
        },
      }}
      sx={{
        '& .MuiOutlinedInput-root': {
          borderRadius: '12px',
          backgroundColor: colors.white,
          fontSize: '1rem',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: '#E5E7EB',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: '#d1d5db',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: colors.primary,
            borderWidth: '1.5px',
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 3px ${colors.primaryRing}`,
          },
        },
        ...sx,
      }}
      {...rest}
    />
  );
}
