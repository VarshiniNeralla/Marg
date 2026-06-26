import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { ArrowBackRounded } from '@mui/icons-material';
import { colors, motion as themeMotion } from '@theme/tokens';
import { motion as m } from 'framer-motion';

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
      backgroundColor: '#ffffff', // Deep dark theme for premium feel
      color: '#18181b',
    }}>
      {/* ── Subtle background treatment ─────────────────────────────────────── */}
      <Box sx={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0)',
        backgroundSize: '36px 36px',
      }} />
      <Box sx={{
        position: 'absolute', top: '50%', left: '50%', zIndex: 0, pointerEvents: 'none',
        width: '100%', maxWidth: 800, height: 800, transform: 'translate(-50%, -50%)',
        background: 'radial-gradient(circle, rgba(37,99,235,0.15) 0%, transparent 60%)',
        filter: 'blur(60px)',
      }} />

      {/* ── Centered column ─────────────────────────────────────────────────── */}
      <Box sx={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 600, // Increased width
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        {/* Top bar: back link */}
        <Box sx={{ display: 'flex', width: '100%', mb: 3 }}>
          <Box
            component={Link}
            to="/"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 0.75,
              borderRadius: '999px',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#52525b',
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              '&:hover': {
                color: '#18181b',
                backgroundColor: 'rgba(0,0,0,0.05)',
              },
              '&:hover svg': {
                transform: 'translateX(-4px)',
              }
            }}
          >
            <ArrowBackRounded sx={{ fontSize: 18, transition: 'transform 0.2s ease' }} />
            Back to Home
          </Box>
        </Box>

        {/* Card */}
        <m.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          style={{ width: '100%' }}
        >
          <Box sx={{
            width: '100%',
            backgroundColor: '#ffffff',
            border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: '24px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
            px: { xs: 3.5, sm: 5 },
            py: { xs: 3, sm: 3.5 },
          }}>
            {/* Brand */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
              <Box component="img" src="/assets/new_logo.png" alt="My Home Group"
                sx={{ height: 32, width: 'auto', objectFit: 'contain', mb: 1.5 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: '#18181b', letterSpacing: '-0.03em', lineHeight: 1 }}>Prāṅgaṇ</Typography>
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#52525b', letterSpacing: '0.15em', mt: 0.5 }}>BY SITESURELABS</Typography>
              </Box>
            </Box>

            {/* Form content */}
            {children}

            {/* Footer */}
            {footer && (
              <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid rgba(0,0,0,0.08)', textAlign: 'center', fontSize: '0.875rem', color: '#71717a' }}>
                {footer}
              </Box>
            )}
          </Box>
        </m.div>
      </Box>
    </Box>
  );
}

