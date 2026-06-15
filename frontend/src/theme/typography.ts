// Typography tokens from style guide.
// Brand nav/chrome uses Google Sans Flex; general UI uses Inter.

export const typography = {
  fontFamily: '"Google Sans Flex", "Google Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontFamilyBrand: '"Google Sans Flex", "Google Sans", Inter, Roboto, sans-serif',

  htmlFontSize: 16,
  fontSize: 14,

  h1: {
    fontFamily: '"Google Sans Flex", "Google Sans", Inter, Roboto, sans-serif',
    fontSize: '1.5rem',       // --text-page-title
    fontWeight: 600,
    lineHeight: 1.15,         // --leading-tight
    letterSpacing: '-0.02em', // --tracking-tight
    color: '#0f172a',         // textStrong
  },
  h2: {
    fontFamily: '"Google Sans Flex", "Google Sans", Inter, Roboto, sans-serif',
    fontSize: '1.25rem',      // --text-section
    fontWeight: 600,
    lineHeight: 1.3,          // --leading-snug
    letterSpacing: '-0.02em',
    color: '#0f172a',
  },
  h3: {
    fontFamily: '"Google Sans Flex", "Google Sans", Inter, Roboto, sans-serif',
    fontSize: '1.0625rem',    // --text-card-title
    fontWeight: 500,
    lineHeight: 1.3,
    letterSpacing: '-0.02em',
    color: '#1e293b',
  },
  h4: {
    fontSize: '1rem',
    fontWeight: 600,
    lineHeight: 1.5,
    color: '#1e293b',
  },
  h5: {
    fontSize: '0.875rem',
    fontWeight: 600,
    lineHeight: 1.5,
    color: '#1e293b',
  },
  h6: {
    fontSize: '0.75rem',
    fontWeight: 600,
    lineHeight: 1.5,
    color: '#64748b',
  },
  body1: {
    fontSize: '1rem',         // --text-body
    lineHeight: 1.5,          // --leading-normal
    color: '#1e293b',
  },
  body2: {
    fontSize: '0.875rem',     // --text-secondary
    lineHeight: 1.5,
    color: '#64748b',
  },
  caption: {
    fontSize: '0.75rem',      // --text-caption
    lineHeight: 1.5,
    color: '#94a3b8',
  },
  button: {
    fontSize: '0.875rem',
    fontWeight: 500,
    letterSpacing: '0.01em',
    textTransform: 'none' as const,
  },
  overline: {
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: '#64748b',
  },
};
