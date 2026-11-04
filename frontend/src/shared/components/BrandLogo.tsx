import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

interface BrandLogoProps {
  /** Rendered height in px (width follows the logo's aspect ratio). */
  height?: number;
  /** Surface the logo sits on is dark: use the light-text variant of the same logo. */
  onDark?: boolean;
  /** Just the S mark (for slots too small for the wordmark, e.g. a collapsed sidebar). */
  markOnly?: boolean;
  sx?: SxProps<Theme>;
}

/** The SiteSureLabs logo. One place to change the files / light-dark variants. */
export default function BrandLogo({ height = 40, onDark = false, markOnly = false, sx }: BrandLogoProps) {
  const src = markOnly
    ? '/assets/ssl_mark.png'
    : onDark
      ? '/assets/ssl_logo_full_dark.png'
      : '/assets/ssl_logo_full.png';
  return (
    <Box
      component="img"
      src={src}
      alt="Site Sure Labs"
      sx={{ height, width: 'auto', objectFit: 'contain', flexShrink: 0, display: 'block', ...(sx as object) }}
    />
  );
}
