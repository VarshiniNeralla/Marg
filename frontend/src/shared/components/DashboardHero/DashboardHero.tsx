import React from 'react';
import { Box, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

const P = {
  black:      '#080a0d',
  ink:        '#111318',
  borderDark: 'rgba(255,255,255,0.07)',
  white:      '#ffffff',
};

const EASE = 'cubic-bezier(0.4,0,0.2,1)';
const T = `all 160ms ${EASE}`;

export interface DashboardHeroProps {
  eyebrow: string;
  greeting: string;
  subtitle: string;
  ctaLabel: string;
  ctaIcon: React.ReactNode;
  ctaTo: string;
  accent?: string;
  accentHover?: string;
}

export default function DashboardHero({
  eyebrow,
  greeting,
  subtitle,
  ctaLabel,
  ctaIcon,
  ctaTo,
  accent = '#2563eb',
  accentHover = '#1d4ed8',
}: DashboardHeroProps) {
  return (
    <Box
      sx={{
        position: 'relative', overflow: 'hidden',
        borderRadius: '20px', mb: 3,
        background: `linear-gradient(140deg, ${P.black} 0%, ${P.ink} 60%, #0a0f1a 100%)`,
        border: `1px solid ${P.borderDark}`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.04) inset',
      }}
    >
      {/* Grid noise */}
      <Box sx={{ position: 'absolute', inset: 0, opacity: 0.03, pointerEvents: 'none',
        backgroundImage: `linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)`,
        backgroundSize: '28px 28px' }} />
      {/* Accent radial */}
      <Box sx={{ position: 'absolute', top: -80, left: -80, width: 320, height: 320, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent}26 0%, transparent 65%)`, pointerEvents: 'none' }} />
      {/* Red radial */}
      <Box sx={{ position: 'absolute', bottom: -60, right: 80, width: 240, height: 240, borderRadius: '50%',
        background: `radial-gradient(circle, rgba(220,38,38,0.11) 0%, transparent 65%)`, pointerEvents: 'none' }} />

      <Box sx={{ position: 'relative', px: { xs: 3, md: 5 }, pt: { xs: 3.5, md: 4.5 }, pb: { xs: 3, md: 4 },
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap' }}>
        <Box>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', mb: 1.25 }}>
            {eyebrow}
          </Typography>
          <Typography sx={{
            fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
            fontSize: { xs: '2rem', md: '2.625rem' }, fontWeight: 800,
            color: P.white, letterSpacing: '-0.055em', lineHeight: 1.05, mb: 0.875,
          }}>
            {greeting}
          </Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.38)', letterSpacing: '-0.01em' }}>
            {subtitle}
          </Typography>
        </Box>

        {/* CTA */}
        <Box component={Link} to={ctaTo} sx={{
          display: 'flex', alignItems: 'center', gap: 1.5,
          px: 2.75, py: 1.5, borderRadius: '12px', flexShrink: 0,
          background: `linear-gradient(135deg, ${accent} 0%, ${accentHover} 100%)`,
          color: P.white, textDecoration: 'none',
          fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '-0.01em',
          boxShadow: `0 4px 20px ${accent}80`,
          transition: T,
          '&:hover': { filter: 'brightness(1.08)', boxShadow: `0 6px 28px ${accent}99`, transform: 'translateY(-1px)' },
        }}>
          {ctaIcon}
          {ctaLabel}
        </Box>
      </Box>

      {/* Bottom accent line */}
      <Box sx={{ height: 2, background: `linear-gradient(90deg, ${accent}80 0%, transparent 100%)` }} />
    </Box>
  );
}
