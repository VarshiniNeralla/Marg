// Design tokens — single source of truth.
// All values sourced from style.md. Do not add tokens not in the guide.

export const colors = {
  // Brand / primary
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primaryActive: '#1e40af',
  primaryGradient: 'linear-gradient(135deg, #2563eb 0%, #1a56db 100%)',
  primarySoft: 'rgba(37, 99, 235, 0.08)',
  primaryRing: 'rgba(37, 99, 235, 0.16)',
  brandRed: '#ed1c24',

  // Surfaces — light mode
  bg: '#f8f9fb',
  bgDeep: '#f1f4f8',
  card: '#ffffff',
  cardHover: '#fafbfc',

  // Surfaces — spatial / dark panels
  ink: '#0a0c10',           // deep background for hero sections
  inkSurface: '#111318',    // card on ink
  inkBorder: 'rgba(255,255,255,0.07)',
  inkMuted: 'rgba(255,255,255,0.35)',
  inkSubdued: 'rgba(255,255,255,0.18)',

  // Text
  text: '#1e293b',
  textMuted: '#64748b',
  textStrong: '#0f172a',
  textBody: '#111827',
  textSecondary: '#334155',
  textTertiary: '#475569',
  textSubdued: '#94a3b8',

  // Borders — use sparingly
  border: '#e8edf3',
  borderLight: '#f0f4f8',

  // Semantic
  success: '#16a34a',
  successBg: 'rgba(22,163,74,0.08)',
  danger: '#dc2626',
  dangerBg: 'rgba(220,38,38,0.08)',
  warning: '#d97706',
  warningBg: 'rgba(217,119,6,0.08)',
  info: '#0891b2',
  infoBg: 'rgba(8,145,178,0.08)',

  // Glass
  glassBg: 'rgba(255, 255, 255, 0.55)',
  glassBgStrong: 'rgba(255, 255, 255, 0.82)',
  glassBorder: 'rgba(255, 255, 255, 0.65)',
  glassBorderSoft: 'rgba(148, 163, 184, 0.18)',
  glassShadow: '0 8px 32px rgba(15, 23, 42, 0.06)',
  glassBlur: 'blur(20px) saturate(180%)',
  navBg: 'rgba(255, 255, 255, 0.88)',

  // White / black
  white: '#ffffff',
  black: '#000000',

  // Project palette (used for cover gradients)
  projectA: 'linear-gradient(135deg, #1e3a5f 0%, #0f2340 100%)',  // deep navy
  projectB: 'linear-gradient(135deg, #1a3a2a 0%, #0f2318 100%)',  // deep forest
  projectC: 'linear-gradient(135deg, #2d1b4e 0%, #1a0f2e 100%)',  // deep plum
  projectD: 'linear-gradient(135deg, #3a1f1a 0%, #221008 100%)',  // deep sienna
} as const;

export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
} as const;

export const radii = {
  sm: '6px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  full: '999px',
} as const;

export const shadows = {
  xs: '0 1px 2px rgba(15, 23, 42, 0.04)',
  sm: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
  md: '0 4px 16px rgba(15, 23, 42, 0.07), 0 1px 3px rgba(15, 23, 42, 0.04)',
  lg: '0 12px 40px rgba(15, 23, 42, 0.10), 0 4px 12px rgba(15, 23, 42, 0.05)',
  xl: '0 24px 64px rgba(15, 23, 42, 0.14), 0 8px 24px rgba(15, 23, 42, 0.06)',
  '2xl': '0 40px 80px rgba(15, 23, 42, 0.18)',
  btn: '0 4px 14px rgba(37, 99, 235, 0.28)',
  glassNav: '0 1px 0 rgba(15, 23, 42, 0.06)',
  dropdown: '0 20px 48px rgba(15, 23, 42, 0.10), 0 4px 12px rgba(15, 23, 42, 0.06)',
  card: '0 2px 8px rgba(15, 23, 42, 0.05)',
  cardHover: '0 8px 32px rgba(15, 23, 42, 0.10)',
} as const;

export const motion = {
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  easeSpring: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  durationFast: '140ms',
  durationNormal: '220ms',
  durationSlow: '320ms',
} as const;

export const breakpoints = {
  mobile: '390px',
  tablet: '640px',
  desktop: '1024px',
  wide: '1280px',
} as const;

export const zIndex = {
  base: 0,
  dropdown: 100,
  sidebar: 200,
  nav: 300,
  modal: 400,
  toast: 500,
} as const;
