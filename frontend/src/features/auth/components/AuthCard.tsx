import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { ArrowBackRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <Box sx={{
      minHeight: '100vh',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      px: 3,
      py: 3,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#fafafa',
    }}>
      {/* ── Subtle background treatment ─────────────────────────────────────── */}
      {/* Faint grid */}
      <Box sx={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.025) 1px, transparent 0)',
        backgroundSize: '36px 36px',
      }} />
      {/* Soft radial glow behind the card */}
      <Box sx={{
        position: 'absolute', top: '50%', left: '50%', zIndex: 0, pointerEvents: 'none',
        width: 720, height: 720, transform: 'translate(-50%, -50%)',
        background: 'radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 60%)',
        filter: 'blur(20px)',
      }} />

      {/* ── Centered column ─────────────────────────────────────────────────── */}
      <Box sx={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 640,
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
      }}>
        {/* Top bar: back link */}
        <Box sx={{ display: 'flex', mb: 1.5 }}>
          <Box
            component={Link}
            to="/"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.875,
              pl: 0.5,
              pr: 1.5,
              py: 0.5,
              borderRadius: '999px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: colors.textMuted,
              textDecoration: 'none',
              border: '1px solid transparent',
              transition: `all ${motion.durationNormal} ${motion.easeOut}`,
              '& .back-icon': {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: '#fff',
                border: '1px solid rgba(15,23,42,0.08)',
                boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
                transition: `all ${motion.durationNormal} ${motion.easeOut}`,
              },
              '& .back-icon svg': {
                fontSize: 15,
                transition: `transform ${motion.durationNormal} ${motion.easeOut}`,
              },
              '&:hover': {
                color: colors.textStrong,
                borderColor: 'rgba(15,23,42,0.08)',
                backgroundColor: 'rgba(15,23,42,0.02)',
              },
              '&:hover .back-icon': {
                backgroundColor: colors.textStrong,
                borderColor: colors.textStrong,
                color: '#fff',
              },
              '&:hover .back-icon svg': {
                transform: 'translateX(-2px)',
              },
            }}
          >
            <Box className="back-icon">
              <ArrowBackRounded />
            </Box>
            Back to Home
          </Box>
        </Box>

        {/* Card */}
        <Box sx={{
          width: '100%',
          backgroundColor: '#fff',
          border: '1px solid rgba(15,23,42,0.07)',
          borderRadius: '20px',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 40px rgba(15,23,42,0.06)',
          px: { xs: 3.5, sm: 5.5 },
          py: { xs: 2.5, sm: 3 },
        }}>
          {/* Brand — inside the card, centered, at the very top */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 1.75 }}>
            <Box component="img" src="/assets/new_logo.png" alt="My Home Group"
              sx={{ height: 30, width: 'auto', objectFit: 'contain', mb: 1 }} />
            <Typography sx={{
              fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
              fontWeight: 800, fontSize: '1.125rem', color: colors.textStrong,
              letterSpacing: '-0.04em', lineHeight: 1.1,
            }}>
              Prāṅgaṇ
            </Typography>
            <Typography sx={{
              fontSize: '0.5625rem', fontWeight: 500, color: colors.textSubdued,
              letterSpacing: '0.12em', textTransform: 'uppercase', mt: 0.25,
            }}>
              by SiteSureLabs
            </Typography>
          </Box>

          {/* Heading block — centered */}
          <Box sx={{ mb: 3, textAlign: 'center' }}>
            <Typography sx={{
              fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
              fontWeight: 700, fontSize: '1.375rem',
              color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.15, mb: subtitle ? 0.5 : 0,
            }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, lineHeight: 1.5 }}>
                {subtitle}
              </Typography>
            )}
          </Box>

          {/* Form content */}
          {children}

          {/* Footer */}
          {footer && (
            <Box sx={{ mt: 2.5, pt: 2.5, borderTop: '1px solid rgba(15,23,42,0.06)', textAlign: 'center', fontSize: '0.875rem', color: colors.textMuted }}>
              {footer}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
