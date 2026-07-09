import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import {
  ArrowBackRounded, MapRounded, ViewInArRounded, BarChartRounded,
} from '@mui/icons-material';
import { motion as m } from 'framer-motion';

interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: 'card' | 'split';
}

const BRAND_BULLETS = [
  { icon: MapRounded, text: 'Pin captures on floor plans' },
  { icon: ViewInArRounded, text: 'Publish immersive 360° tours' },
  { icon: BarChartRounded, text: 'Track progress with analytics' },
];

function BackLink() {
  return (
    <Box
      component={Link}
      to="/"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        pl: 0,
        pr: 1.25,
        py: 0.625,
        borderRadius: '999px',
        fontSize: { xs: '0.8125rem', md: '0.875rem' },
        fontWeight: 500,
        color: '#71717a',
        textDecoration: 'none',
        transition: 'all 0.2s ease',
        '&:hover': {
          color: '#18181b',
          backgroundColor: 'rgba(0,0,0,0.04)',
        },
        '&:hover svg': { transform: 'translateX(-3px)' },
      }}
    >
      <ArrowBackRounded sx={{ fontSize: 17, transition: 'transform 0.2s ease', ml: -0.25 }} />
      Back to Home
    </Box>
  );
}

function BrandMark({ centered = false }: { centered?: boolean }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: centered ? 'center' : 'flex-start' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: centered ? 0 : 2 }}>
        <Box component="img" src="/assets/new_logo.png" alt="My Home Group"
          sx={{ height: { xs: 26, md: 32 }, width: 'auto', objectFit: 'contain' }} />
        <Box>
          <Typography sx={{
            fontSize: { xs: '1.125rem', md: '1.375rem' },
            fontWeight: 800,
            color: '#18181b',
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
          }}>
            SiteVision
          </Typography>
          <Typography sx={{
            fontSize: '0.55rem',
            fontWeight: 700,
            color: '#a1a1aa',
            letterSpacing: '0.14em',
            mt: 0.25,
          }}>
            BY SITESURELABS
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function SplitBrandPanel() {
  return (
    <Box sx={{
      display: { xs: 'none', md: 'flex' },
      flexDirection: 'column',
      justifyContent: 'space-between',
      p: { md: 6, lg: 8 },
      position: 'relative',
      overflow: 'hidden',
      background: 'linear-gradient(160deg, #fafafa 0%, #f4f4f5 45%, #ffffff 100%)',
      borderRight: '1px solid rgba(0,0,0,0.06)',
    }}>
      <Box sx={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)',
        backgroundSize: '32px 32px',
        pointerEvents: 'none',
      }} />
      <Box sx={{
        position: 'absolute',
        top: '-10%',
        right: '-10%',
        width: 360,
        height: 360,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(37,99,235,0.12) 0%, transparent 70%)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />
      <Box sx={{
        position: 'absolute',
        bottom: '5%',
        left: '-5%',
        width: 280,
        height: 280,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />

      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <BrandMark />
      </Box>

      <Box sx={{ position: 'relative', zIndex: 1, maxWidth: 380 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { md: '2rem', lg: '2.25rem' },
          fontWeight: 800,
          letterSpacing: '-0.04em',
          color: '#18181b',
          lineHeight: 1.15,
          mb: 2,
        }}>
          Your site, captured and shared in 360°.
        </Typography>
        <Typography sx={{ fontSize: '1rem', color: '#71717a', lineHeight: 1.6, mb: 4 }}>
          The visual operating system for modern construction teams.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
          {BRAND_BULLETS.map(({ icon: Icon, text }) => (
            <Box key={text} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{
                width: 36,
                height: 36,
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.04)',
                border: '1px solid rgba(0,0,0,0.06)',
                color: '#52525b',
              }}>
                <Icon sx={{ fontSize: 18 }} />
              </Box>
              <Typography sx={{ fontSize: '0.9375rem', color: '#3f3f46', fontWeight: 500 }}>
                {text}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      <Typography sx={{ position: 'relative', zIndex: 1, fontSize: '0.8125rem', color: '#a1a1aa' }}>
        © 2026 SiteSureLabs
      </Typography>
    </Box>
  );
}

export default function AuthCard({ title, subtitle, children, footer, variant = 'card' }: AuthCardProps) {
  if (variant === 'split') {
    return (
      <Box sx={{
        minHeight: '100dvh',
        display: { md: 'grid' },
        gridTemplateColumns: { md: '1fr 1fr' },
        backgroundColor: '#ffffff',
        color: '#18181b',
      }}>
        <SplitBrandPanel />

        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: { xs: '100dvh', md: '100dvh' },
          px: { xs: 3, sm: 4, md: 6, lg: 8 },
          py: { xs: 3, md: 4 },
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Mobile background */}
          <Box sx={{
            display: { xs: 'block', md: 'none' },
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)',
            backgroundSize: '28px 28px',
            pointerEvents: 'none',
          }} />

          {/* Back link — pinned top-left of panel */}
          <Box sx={{
            position: 'absolute',
            top: { xs: 20, md: 28 },
            left: { xs: 24, sm: 32, md: 48, lg: 64 },
            zIndex: 2,
          }}>
            <BackLink />
          </Box>

          <Box sx={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            maxWidth: { xs: 400, md: 440 },
            mx: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            pt: { xs: 5, md: 0 },
          }}>
            {/* Mobile brand */}
            <Box sx={{ display: { xs: 'flex', md: 'none' }, justifyContent: 'center', mb: 2.5, width: '100%' }}>
              <BrandMark centered />
            </Box>

            <m.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              style={{ width: '100%' }}
            >
              <Box sx={{
                mb: { xs: 2.5, md: 3.5 },
                textAlign: 'center',
                width: '100%',
              }}>
                <Typography sx={{
                  fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
                  fontSize: { xs: '1.5rem', md: '1.75rem' },
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  color: '#18181b',
                  mb: 0.5,
                }}>
                  {title}
                </Typography>
                {subtitle && (
                  <Typography sx={{ fontSize: { xs: '0.875rem', md: '0.9375rem' }, color: '#71717a', lineHeight: 1.5 }}>
                    {subtitle}
                  </Typography>
                )}
              </Box>

              <Box sx={{
                width: '100%',
                backgroundColor: '#ffffff',
                border: { xs: '1px solid rgba(0,0,0,0.07)', md: 'none' },
                borderRadius: { xs: '18px', md: 0 },
                boxShadow: { xs: '0 8px 24px rgba(0,0,0,0.05)', md: 'none' },
                px: { xs: 2, sm: 2.5, md: 0 },
                py: { xs: 2, md: 0 },
              }}>
                {children}
              </Box>

              {footer && (
                <Box sx={{ mt: 3, pt: 2.5, borderTop: '1px solid rgba(0,0,0,0.06)', textAlign: 'center', fontSize: '0.875rem', color: '#71717a', width: '100%' }}>
                  {footer}
                </Box>
              )}
            </m.div>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Classic card layout (forgot password, etc.) ──
  return (
    <Box sx={{
      minHeight: '100dvh',
      width: '100%',
      display: 'flex',
      alignItems: { xs: 'flex-start', sm: 'center' },
      justifyContent: 'center',
      px: { xs: 2, sm: 3 },
      py: { xs: 1.5, sm: 3 },
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#ffffff',
      color: '#18181b',
    }}>
      <Box sx={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0)',
        backgroundSize: '36px 36px',
      }} />
      <Box sx={{
        position: 'absolute', top: '50%', left: '50%', zIndex: 0, pointerEvents: 'none',
        width: '100%', maxWidth: 800, height: 800, transform: 'translate(-50%, -50%)',
        background: 'radial-gradient(circle, rgba(37,99,235,0.12) 0%, transparent 60%)',
        filter: 'blur(60px)',
      }} />

      <Box sx={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 480,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <Box sx={{ display: 'flex', width: '100%', mb: { xs: 1.5, sm: 2.5 } }}>
          <BackLink />
        </Box>

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
            borderRadius: '20px',
            boxShadow: '0 16px 32px rgba(0,0,0,0.06)',
            px: { xs: 2.5, sm: 4 },
            py: { xs: 2.5, sm: 3.5 },
          }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: { xs: 2, sm: 2.5 } }}>
              <BrandMark centered />
            </Box>

            <Box sx={{ mb: 2.5, textAlign: 'center' }}>
              <Typography sx={{
                fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
                fontSize: '1.375rem',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: '#18181b',
                mb: 0.5,
              }}>
                {title}
              </Typography>
              {subtitle && (
                <Typography sx={{ fontSize: '0.875rem', color: '#71717a' }}>{subtitle}</Typography>
              )}
            </Box>

            {children}

            {footer && (
              <Box sx={{ mt: 3, pt: 2.5, borderTop: '1px solid rgba(0,0,0,0.06)', textAlign: 'center', fontSize: '0.875rem', color: '#71717a' }}>
                {footer}
              </Box>
            )}
          </Box>
        </m.div>
      </Box>
    </Box>
  );
}
