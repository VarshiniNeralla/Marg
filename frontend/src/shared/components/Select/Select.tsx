import React from 'react';
import {
  FormControl,
  InputLabel,
  Select as MuiSelect,
  MenuItem,
  FormHelperText,
  type SelectProps as MuiSelectProps,
} from '@mui/material';
import { colors, radii } from '@theme/tokens';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<MuiSelectProps, 'onChange'> {
  label?: string;
  options: SelectOption[];
  helperText?: string;
  error?: boolean;
  onChange?: (value: string | number) => void;
  fullWidth?: boolean;
}

export default function Select({
  label,
  options,
  helperText,
  error,
  onChange,
  fullWidth = true,
  sx,
  ...rest
}: SelectProps) {
  return (
    <FormControl fullWidth={fullWidth} error={error} sx={sx}>
      {label && <InputLabel sx={{ fontSize: '0.875rem', color: colors.textMuted }}>{label}</InputLabel>}
      <MuiSelect
        label={label}
        onChange={(e) => onChange?.(e.target.value as string | number)}
        sx={{
          borderRadius: radii.sm,
          fontSize: '1rem',
          backgroundColor: colors.white,
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: colors.primary,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: colors.primary,
            borderWidth: '1.5px',
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 3px ${colors.primaryRing}`,
          },
        }}
        {...rest}
      >
        {options.map((opt) => (
          <MenuItem
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            sx={{ fontSize: '0.875rem' }}
          >
            {opt.label}
          </MenuItem>
        ))}
      </MuiSelect>
      {helperText && (
        <FormHelperText sx={{ fontSize: '0.75rem' }}>{helperText}</FormHelperText>
      )}
    </FormControl>
  );
}
