import { colors } from './tokens';

// MUI palette built from style guide tokens.
export const palette = {
  mode: 'light' as const,
  primary: {
    main: colors.primary,
    dark: colors.primaryHover,
    contrastText: colors.white,
  },
  secondary: {
    main: colors.textSecondary,
    contrastText: colors.white,
  },
  error: {
    main: colors.danger,
    light: colors.dangerBg,
    contrastText: colors.white,
  },
  warning: {
    main: colors.warning,
    light: colors.warningBg,
    contrastText: colors.white,
  },
  success: {
    main: colors.success,
    light: colors.successBg,
    contrastText: colors.white,
  },
  background: {
    default: colors.bg,
    paper: colors.card,
  },
  text: {
    primary: colors.text,
    secondary: colors.textMuted,
    disabled: colors.textSubdued,
  },
  divider: colors.border,
};
