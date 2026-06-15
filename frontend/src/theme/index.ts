import { createTheme } from '@mui/material/styles';
import { palette } from './palette';
import { typography } from './typography';
import { muiShadows } from './shadows';
import { radii, colors, motion } from './tokens';

const theme = createTheme({
  palette,
  typography,
  shadows: muiShadows,
  shape: {
    borderRadius: 12, // --radius-md default
  },
  components: {
    // ── Button ──────────────────────────────────────────────────────────
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: radii.sm,     // 8px — style guide buttons
          fontWeight: 500,
          fontSize: '0.875rem',
          textTransform: 'none',
          letterSpacing: '0.01em',
          transition: `all ${motion.durationNormal} ${motion.easeOut}`,
          '&:focus-visible': {
            outline: `2px solid ${colors.primary}`,
            outlineOffset: '2px',
          },
        },
        contained: {
          background: colors.primaryGradient,
          boxShadow: colors.primaryRing,
          '&:hover': {
            background: `linear-gradient(135deg, ${colors.primaryHover} 0%, ${colors.primaryActive} 100%)`,
            boxShadow: '0 4px 14px rgba(37, 99, 235, 0.32)',
          },
        },
        outlined: {
          borderColor: colors.border,
          color: colors.text,
          backgroundColor: colors.white,
          '&:hover': {
            borderColor: colors.primary,
            color: colors.primary,
            backgroundColor: colors.primarySoft,
          },
        },
        text: {
          color: colors.textMuted,
          '&:hover': {
            backgroundColor: colors.primarySoft,
            color: colors.primary,
          },
        },
        sizeLarge: {
          padding: '10px 24px',
          fontSize: '1rem',
        },
        sizeMedium: {
          padding: '8px 20px',
        },
        sizeSmall: {
          padding: '4px 12px',
          fontSize: '0.8125rem',
        },
      },
    },

    // ── TextField / Input ────────────────────────────────────────────────
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: radii.sm,     // 8px
          backgroundColor: colors.white,
          fontSize: '1rem',           // iOS zoom prevention
          transition: `border-color ${motion.durationFast} ${motion.easeOut}`,
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
          '&.Mui-error .MuiOutlinedInput-notchedOutline': {
            borderColor: colors.danger,
          },
          '&.Mui-error.Mui-focused': {
            boxShadow: `0 0 0 3px rgba(220, 38, 38, 0.16)`,
          },
        },
        notchedOutline: {
          borderColor: colors.border,
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '0.875rem',
          color: colors.textMuted,
          '&.Mui-focused': {
            color: colors.primary,
          },
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
          HorizoninTop: '4px',
        },
      },
    },

    // ── Card ─────────────────────────────────────────────────────────────
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: radii.md,     // 12px
          border: `1px solid ${colors.border}`,
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
          backgroundColor: colors.card,
          transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}`,
          '&:hover': {
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
          },
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: '20px 24px',
          '&:last-child': {
            paddingBottom: '20px',
          },
        },
      },
    },

    // ── Paper ─────────────────────────────────────────────────────────────
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        rounded: {
          borderRadius: radii.md,
        },
        elevation1: {
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
        },
      },
    },

    // ── Dialog / Modal ────────────────────────────────────────────────────
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: radii.lg,     // 16px
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.18)',
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: '1.0625rem',
          fontWeight: 600,
          color: colors.textStrong,
          padding: '20px 24px 12px',
        },
      },
    },

    // ── Drawer ─────────────────────────────────────────────────────────────
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: `1px solid ${colors.border}`,
          backgroundColor: colors.card,
        },
      },
    },

    // ── Menu / Dropdown ────────────────────────────────────────────────────
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: radii.md,
          border: `1px solid ${colors.border}`,
          boxShadow: '0 24px 48px rgba(15, 23, 42, 0.08)',
          HorizoninTop: '4px',
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.875rem',
          borderRadius: '6px',
          Horizonin: '0 4px',
          '&:hover': {
            backgroundColor: colors.primarySoft,
            color: colors.primary,
          },
          '&.Mui-selected': {
            backgroundColor: colors.primarySoft,
            color: colors.primary,
            '&:hover': {
              backgroundColor: colors.primaryRing,
            },
          },
        },
      },
    },

    // ── Chip ──────────────────────────────────────────────────────────────
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: radii.full,   // pill
          fontSize: '0.75rem',
          fontWeight: 500,
          height: '24px',
        },
      },
    },

    // ── Tooltip ───────────────────────────────────────────────────────────
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: colors.textStrong,
          fontSize: '0.75rem',
          borderRadius: '6px',
          padding: '5px 10px',
        },
      },
    },

    // ── Table ─────────────────────────────────────────────────────────────
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            backgroundColor: colors.bg,
            color: colors.textMuted,
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            borderBottom: `1px solid ${colors.border}`,
          },
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: `${colors.bg}80`,
          },
          '& .MuiTableCell-body': {
            borderBottom: `1px solid ${colors.border}`,
            fontSize: '0.875rem',
            color: colors.text,
          },
        },
      },
    },

    // ── Breadcrumbs ────────────────────────────────────────────────────────
    MuiBreadcrumbs: {
      styleOverrides: {
        root: {
          fontSize: '0.8125rem',
          color: colors.textMuted,
        },
        separator: {
          color: colors.borderLight,
        },
      },
    },

    // ── Alert ─────────────────────────────────────────────────────────────
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: radii.sm,
          fontSize: '0.875rem',
        },
      },
    },

    // ── AppBar ────────────────────────────────────────────────────────────
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: colors.navBg,
          backdropFilter: 'blur(18px) saturate(160%)',
          borderBottom: `1px solid ${colors.glassBorderSoft}`,
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.055)',
          color: colors.text,
        },
      },
    },

    // ── CssBaseline ───────────────────────────────────────────────────────
    MuiCssBaseline: {
      styleOverrides: `
        @import url('https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Google+Sans+Flex:wght@300..700&family=Inter:wght@300;400;500;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; }

        body {
          font-family: "Google Sans Flex", "Google Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background-color: #f1f5f9;
          color: #1e293b;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        /* iOS zoom prevention — inputs must be at least 16px on mobile */
        @media (max-width: 640px) {
          input, select, textarea { font-size: 16px !important; }
        }

        /* Minimum touch target */
        .tap-44 { min-width: 44px; min-height: 44px; }

        /* Safe areas */
        .safe-top    { padding-top: env(safe-area-inset-top); }
        .safe-bottom { padding-bottom: env(safe-area-inset-bottom); }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

        /* Reduced motion */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }

        img, svg, video, canvas { max-width: 100%; }

        a { color: inherit; text-decoration: none; }
      `,
    },
  },
});

export default theme;
export { colors, spacing, radii, shadows, motion, breakpoints, zIndex } from './tokens';
