import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid } from '@mui/material';
import {
  ViewInArRounded, MapRounded, CameraAltRounded, CheckCircleRounded,
  PlaceRounded, BarChartRounded, ArrowForwardRounded,
  LanguageRounded, Instagram, LinkedIn, PublishRounded,
} from '@mui/icons-material';
import { colors, shadows, motion as themeMotion } from '@theme/tokens';
import { motion as m, useScroll, useTransform, type Variants } from 'framer-motion';

// ── Shared primitives ─────────────────────────────────────────────────────────

const NAV_H = 64;

function GradientText({ children, sx = {} }: { children: React.ReactNode; sx?: object }) {
  return (
    <Box component="span" sx={{
      background: 'linear-gradient(135deg, #18181b 0%, #71717a 100%)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
      ...sx,
    }}>
      {children}
    </Box>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <Box sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75,
        px: 1.5, py: 0.5, borderRadius: '999px',
        border: '1px solid rgba(0,0,0,0.1)',
        backgroundColor: 'rgba(0,0,0,0.02)',
        backdropFilter: 'blur(10px)',
        fontSize: '0.75rem', fontWeight: 600, color: '#3f3f46',
        letterSpacing: '0.02em',
      }}>
        {children}
      </Box>
    </m.div>
  );
}

function CTAButton({ children, to, variant = 'primary', onClick }: {
  children: React.ReactNode; to?: string; variant?: 'primary' | 'ghost'; onClick?: () => void;
}) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 1,
    px: 3, py: 1.5, borderRadius: '12px',
    fontSize: '0.9375rem', fontWeight: 600, cursor: 'pointer',
    textDecoration: 'none', transition: `all ${themeMotion.durationFast}`,
    letterSpacing: '-0.01em',
  };
  const styles = variant === 'primary'
    ? { ...base, background: '#18181b', color: '#fff', '&:hover': { transform: 'scale(1.02)', background: '#27272a' } }
    : { ...base, color: '#18181b', border: `1px solid rgba(0,0,0,0.1)`, backgroundColor: 'rgba(0,0,0,0.02)', '&:hover': { borderColor: 'rgba(0,0,0,0.08)', backgroundColor: 'rgba(0,0,0,0.06)' } };
  
  if (to) return <Box component={Link} to={to} sx={styles}>{children}</Box>;
  return <Box onClick={onClick} sx={styles}>{children}</Box>;
}

// ── Navbar ────────────────────────────────────────────────────────────────────

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <Box component="nav" sx={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      height: NAV_H, display: 'flex', alignItems: 'center',
      px: { xs: 2, md: 6 },
      backdropFilter: scrolled ? 'blur(12px) saturate(180%)' : 'none',
      backgroundColor: scrolled ? 'rgba(255,255,255,0.85)' : 'transparent',
      borderBottom: scrolled ? `1px solid rgba(0,0,0,0.06)` : '1px solid transparent',
      transition: `all ${themeMotion.durationNormal}`,
    }}>
      <Box component={Link} to="/" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mr: 'auto', textDecoration: 'none' }}>
        <Box component="img" src="/assets/new_logo.png" alt="My Home Group" sx={{ height: 36, width: 'auto', objectFit: 'contain', flexShrink: 0 }} />
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: '#18181b', letterSpacing: '-0.04em', lineHeight: 1 }}>Prāṅgaṇ</Typography>
          <Typography sx={{ fontSize: '0.55rem', fontWeight: 600, color: '#71717a', letterSpacing: '0.12em', mt: 0.3 }}>BY SITESURELABS</Typography>
        </Box>
      </Box>

      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.5 }}>
        <CTAButton to="/login" variant="primary">Sign in</CTAButton>
      </Box>

      {/* Mobile hamburger */}
      <Box onClick={() => setMenuOpen(v => !v)} sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', gap: 0.5, p: 1, cursor: 'pointer' }}>
        {[0, 1, 2].map(i => (
          <Box key={i} sx={{ width: 22, height: 2, borderRadius: '2px', backgroundColor: '#18181b', transition: `all ${themeMotion.durationFast}`,
            ...(menuOpen && i === 0 && { transform: 'rotate(45deg) translate(3px, 3px)' }),
            ...(menuOpen && i === 1 && { opacity: 0 }),
            ...(menuOpen && i === 2 && { transform: 'rotate(-45deg) translate(3px, -3px)' }),
          }} />
        ))}
      </Box>

      {/* Mobile menu */}
      {menuOpen && (
        <Box sx={{ position: 'absolute', top: NAV_H, left: 0, right: 0, backgroundColor: '#ffffff', borderBottom: `1px solid rgba(0,0,0,0.1)`, p: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box component={Link} to="/login" onClick={() => setMenuOpen(false)} sx={{ px: 2, py: 1.25, borderRadius: '8px', fontSize: '0.9375rem', color: '#52525b', textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(0,0,0,0.05)', color: '#18181b' } }}>
            Sign in
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <Box sx={{
      pt: `${NAV_H + 80}px`, pb: '80px', px: { xs: 3, md: 6 },
      textAlign: 'center', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background elements */}
      <Box sx={{
        position: 'absolute', inset: 0, zIndex: 0,
        backgroundColor: '#f8fafc', // Very subtle cool off-white
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)',
        backgroundSize: '40px 40px',
        maskImage: 'radial-gradient(ellipse 70% 50% at 50% 0%, black 0%, transparent 90%)',
      }} />
      <Box sx={{ position: 'absolute', top: '-20%', left: '15%', width: '60%', height: 600, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(37,99,235,0.07) 0%, transparent 60%)', filter: 'blur(80px)', pointerEvents: 'none', zIndex: 0 }} />
      <Box sx={{ position: 'absolute', top: '-10%', right: '10%', width: '50%', height: 500, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(124,58,237,0.06) 0%, transparent 60%)', filter: 'blur(80px)', pointerEvents: 'none', zIndex: 0 }} />

      <Box sx={{ position: 'relative', zIndex: 1, maxWidth: 960, mx: 'auto' }}>
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        >
          <Typography sx={{
            fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
            fontSize: { xs: '3rem', sm: '4rem', md: '5.5rem' },
            fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.05em',
            color: '#18181b', mb: 3,
          }}>
            Construct with <br />
            <Box component="span" sx={{
              background: 'linear-gradient(135deg, #ef4444 0%, #7f1d1d 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>Prāṅgaṇ</Box>
          </Typography>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        >
          <Typography sx={{ fontSize: { xs: '1rem', md: '1.25rem' }, color: '#52525b', maxWidth: 640, mx: 'auto', lineHeight: 1.6, mb: 5 }}>
            360° virtual tours, floor plan mapping, capture reviews, and real-time analytics. The visual operating system for your site.
          </Typography>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
        >
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <CTAButton to="/login" variant="primary">
              Sign In <ArrowForwardRounded sx={{ fontSize: 16 }} />
            </CTAButton>
            {/* <CTAButton to="/contact" variant="ghost">
              Book a Demo
            </CTAButton> */}
          </Box>
        </m.div>
      </Box>

      {/* Dashboard mockup (Bento style) */}
      <m.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
      >
        <Box sx={{ mt: { xs: 6, md: 10 }, maxWidth: 1100, mx: 'auto', position: 'relative', zIndex: 1, perspective: '1000px' }}>
          <Box sx={{
            borderRadius: { xs: '16px', md: '24px' }, overflow: 'hidden',
            border: '1px solid rgba(0,0,0,0.08)',
            backgroundColor: '#ffffff',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 30px 60px -15px rgba(0,0,0,0.1)',
            transform: { xs: 'none', md: 'rotateX(5deg) scale(0.95)' },
            transformOrigin: 'top center',
            transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            '&:hover': { transform: { md: 'rotateX(0deg) scale(1)' } }
          }}>
            {/* Browser chrome */}
            <Box sx={{ height: 48, backgroundColor: '#f4f4f5', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', px: 2, gap: 1.5 }}>
              {['#ef4444','#f59e0b','#10b981'].map((c, i) => <Box key={i} sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: c, opacity: 0.8 }} />)}
            </Box>
            {/* Dashboard preview */}
            <Box sx={{ display: 'flex', height: { xs: 380, sm: 460, md: 520 }, background: '#ffffff' }}>
              {/* Sidebar — hidden on mobile where there's no room */}
              <Box sx={{ display: { xs: 'none', sm: 'block' }, width: { sm: 180, md: 220 }, borderRight: '1px solid rgba(0,0,0,0.05)', p: 2, flexShrink: 0 }}>
                {['Dashboard','Projects','Captures','Tours','Floor Plans','Analytics'].map((item, i) => (
                  <Box key={item} sx={{ px: 2, py: 1.25, borderRadius: '8px', mb: 0.5, backgroundColor: i === 0 ? 'rgba(0,0,0,0.04)' : 'transparent', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: i === 0 ? '#18181b' : 'rgba(0,0,0,0.15)' }} />
                    <Typography sx={{ fontSize: '0.875rem', color: i === 0 ? '#18181b' : '#71717a', fontWeight: i === 0 ? 600 : 400 }}>{item}</Typography>
                  </Box>
                ))}
              </Box>
              {/* Main content */}
              <Box sx={{ flex: 1, minWidth: 0, p: { xs: 2, sm: 3, md: 4 }, overflowY: 'hidden' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, 1fr)' }, gap: { xs: 1.25, sm: 2, md: 3 }, mb: { xs: 2, md: 3 } }}>
                  {[
                    { label: 'Active Projects', value: '12', trend: '+2' },
                    { label: 'Total Captures', value: '1,284', trend: '+14%' },
                    { label: 'Reviews Pending', value: '23', trend: '-5' },
                  ].map(({ label, value, trend }) => (
                    <Box key={label} sx={{ backgroundColor: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.05)', borderRadius: { xs: '10px', md: '16px' }, p: { xs: 1.5, sm: 2, md: 3 }, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: { xs: '0.625rem', sm: '0.75rem', md: '0.875rem' }, color: '#52525b', mb: { xs: 0.5, md: 1 } }}>{label}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: { xs: 0.5, md: 1.5 }, flexWrap: 'wrap' }}>
                        <Typography sx={{ fontSize: { xs: '1.125rem', sm: '1.5rem', md: '2rem' }, fontWeight: 700, color: '#18181b', lineHeight: 1 }}>{value}</Typography>
                        <Typography sx={{ fontSize: { xs: '0.625rem', md: '0.875rem' }, color: trend.startsWith('+') ? '#10b981' : '#a1a1aa' }}>{trend}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
                <Box sx={{ backgroundColor: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.05)', borderRadius: { xs: '10px', md: '16px' }, p: { xs: 2, md: 3 }, height: { xs: 200, sm: 240, md: 280 } }}>
                  <Typography sx={{ fontSize: { xs: '0.875rem', md: '1rem' }, fontWeight: 500, color: '#18181b', mb: { xs: 2, md: 3 } }}>Capture Volume</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: { xs: 1, md: 2 }, height: { xs: 110, sm: 150, md: 180 }, pt: 2 }}>
                    {[40, 65, 50, 80, 70, 90, 75, 100].map((h, i) => (
                      <Box key={i} sx={{ flex: 1, borderRadius: '4px 4px 0 0', background: i === 7 ? 'linear-gradient(180deg, #2563eb 0%, rgba(37,99,235,0.2) 100%)' : 'rgba(0,0,0,0.1)', height: `${h}%`, transition: 'height 0.5s ease', '&:hover': { background: '#2563eb' } }} />
                    ))}
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      </m.div>
    </Box>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: ViewInArRounded,
    title: '360° Virtual Tours',
    desc: 'Room-to-room hotspot navigation in immersive equirectangular panoramas.',
    accent: '#2563eb',
    layout: 'wide' as const,
    grid: { md: { column: '1 / span 2', row: '1' } },
  },
  {
    icon: MapRounded,
    title: 'Floor Plan Mapping',
    desc: 'Overlay interactive SVG markers on PDF/PNG plans with live capture status.',
    accent: '#7c3aed',
    layout: 'tall' as const,
    grid: { md: { column: '3', row: '1 / span 2' } },
  },
  {
    icon: CameraAltRounded,
    title: 'Capture Management',
    desc: 'Drag-drop multi-file uploads with per-file progress tracking.',
    accent: '#0891b2',
    layout: 'default' as const,
    grid: { md: { column: '1', row: '2' } },
  },
  {
    icon: CheckCircleRounded,
    title: 'Review Workflows',
    desc: '6-stage lifecycle from upload to publish — assign, review, approve.',
    accent: '#059669',
    layout: 'default' as const,
    grid: { md: { column: '2', row: '2' } },
  },
  {
    icon: PlaceRounded,
    title: 'Pin-Based Walkthroughs',
    desc: 'Place capture pins on floor plans and publish sequential room-by-room tours.',
    accent: '#dc2626',
    layout: 'default' as const,
    grid: { md: { column: '1', row: '3' } },
  },
  {
    icon: BarChartRounded,
    title: 'Analytics Dashboard',
    desc: 'KPIs, charts, and team productivity across your full portfolio.',
    accent: '#d97706',
    layout: 'wide' as const,
    grid: { md: { column: '2 / span 2', row: '3' } },
  },
];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 120, damping: 22 } },
};

function FeatureCard({ feature, index }: { feature: typeof FEATURES[0]; index: number }) {
  const Icon = feature.icon;
  const isWide = feature.layout === 'wide';
  const isTall = feature.layout === 'tall';

  return (
    <Box sx={{
      position: 'relative',
      height: '100%',
      p: { xs: 2.25, md: isWide ? 2.75 : 2.5 },
      borderRadius: '18px',
      border: '1px solid rgba(0,0,0,0.07)',
      backgroundColor: '#ffffff',
      display: 'flex',
      flexDirection: isWide ? { xs: 'column', sm: 'row' } : 'column',
      alignItems: isWide ? { xs: 'flex-start', sm: 'center' } : 'flex-start',
      gap: isWide ? { xs: 1.75, sm: 2.25 } : 1.5,
      overflow: 'hidden',
      transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: `linear-gradient(90deg, ${feature.accent}, ${feature.accent}88)`,
        opacity: 0.85,
      },
      '&::after': {
        content: '""',
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 80% 60% at 100% 0%, ${feature.accent}10 0%, transparent 65%)`,
        pointerEvents: 'none',
        opacity: 0,
        transition: 'opacity 0.35s',
      },
      '&:hover': {
        borderColor: `${feature.accent}40`,
        transform: 'translateY(-3px)',
        boxShadow: `0 12px 32px ${feature.accent}18, 0 4px 12px rgba(0,0,0,0.06)`,
        '&::after': { opacity: 1 },
        '& .feature-icon': {
          transform: 'scale(1.05)',
          boxShadow: `0 8px 20px ${feature.accent}28`,
        },
      },
    }}>
      {/* Decorative background for tall card */}
      {isTall && (
        <Box sx={{
          position: 'absolute',
          bottom: -8,
          right: -8,
          width: 120,
          height: 120,
          opacity: 0.06,
          backgroundImage: `
            linear-gradient(${feature.accent} 1px, transparent 1px),
            linear-gradient(90deg, ${feature.accent} 1px, transparent 1px)
          `,
          backgroundSize: '16px 16px',
          pointerEvents: 'none',
        }} />
      )}

      {/* Mini chart decoration for analytics wide card */}
      {isWide && feature.title.includes('Analytics') && (
        <Box sx={{
          position: 'absolute',
          bottom: 12,
          right: 16,
          display: { xs: 'none', sm: 'flex' },
          alignItems: 'flex-end',
          gap: 0.5,
          height: 36,
          opacity: 0.15,
          pointerEvents: 'none',
        }}>
          {[35, 55, 42, 68, 50, 75, 60].map((h, i) => (
            <Box key={i} sx={{ width: 6, height: `${h}%`, borderRadius: '3px 3px 0 0', backgroundColor: feature.accent }} />
          ))}
        </Box>
      )}

      <Typography sx={{
        position: 'absolute',
        top: 14,
        right: 16,
        fontSize: '0.6875rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        color: 'rgba(0,0,0,0.18)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {String(index + 1).padStart(2, '0')}
      </Typography>

      <Box
        className="feature-icon"
        sx={{
          flexShrink: 0,
          width: { xs: 40, md: 44 },
          height: { xs: 40, md: 44 },
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: feature.accent,
          backgroundColor: `${feature.accent}12`,
          border: `1px solid ${feature.accent}22`,
          transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.35s',
        }}
      >
        <Icon sx={{ fontSize: { xs: 20, md: 22 } }} />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
        <Typography sx={{
          fontSize: { xs: '0.9375rem', md: isWide ? '1.0625rem' : '0.9375rem' },
          fontWeight: 700,
          color: '#18181b',
          mb: 0.75,
          letterSpacing: '-0.02em',
          lineHeight: 1.3,
          pr: 3,
        }}>
          {feature.title}
        </Typography>
        <Typography sx={{
          fontSize: { xs: '0.8125rem', md: '0.875rem' },
          color: '#71717a',
          lineHeight: 1.55,
          display: '-webkit-box',
          WebkitLineClamp: isTall ? 4 : 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {feature.desc}
        </Typography>
      </Box>
    </Box>
  );
}

function FeaturesSection() {
  return (
    <Box sx={{
      py: { xs: 8, md: 14 },
      px: { xs: 3, md: 6 },
      maxWidth: 1200,
      mx: 'auto',
      position: 'relative',
    }}>
      <Box sx={{
        position: 'absolute',
        inset: 0,
        mx: { md: 3 },
        borderRadius: { md: '32px' },
        background: 'linear-gradient(180deg, #fafafa 0%, #ffffff 100%)',
        border: { md: '1px solid rgba(0,0,0,0.05)' },
        pointerEvents: 'none',
      }} />
      <Box sx={{ position: 'relative', zIndex: 1 }}>
      <m.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.8 }}
      >
        <Box sx={{ textAlign: 'center', mb: { xs: 5, md: 8 } }}>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.875rem', sm: '2.5rem', md: '3.5rem' }, fontWeight: 800, letterSpacing: '-0.04em', color: '#18181b', mb: 2 }}>
            Powerful features. <br /> Elegant experience.
          </Typography>
          <Typography sx={{ fontSize: { xs: '0.9375rem', md: '1.125rem' }, color: '#52525b', maxWidth: 540, mx: 'auto', lineHeight: 1.6 }}>
            Everything you need to manage your site digitally, engineered for performance and precision.
          </Typography>
        </Box>
      </m.div>

      <m.div
        variants={containerVariants}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-50px' }}
      >
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
          gridAutoRows: 'auto',
          gap: { xs: 1.5, md: 2 },
        }}>
          {FEATURES.map((f, i) => (
            <Box
              key={f.title}
              component={m.div}
              variants={itemVariants}
              sx={{
                height: '100%',
                gridColumn: { xs: 'span 1', md: f.grid.md.column },
                gridRow: { xs: 'span 1', md: f.grid.md.row },
              }}
            >
              <FeatureCard feature={f} index={i} />
            </Box>
          ))}
        </Box>
      </m.div>
      </Box>
    </Box>
  );
}

// ── Workflow ──────────────────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { label: 'Locate', desc: 'Open the floor plan and mark capture points', icon: MapRounded, accent: '#7c3aed' },
  { label: 'Capture', desc: 'Shoot 360° at each pin on site', icon: CameraAltRounded, accent: '#0891b2' },
  { label: 'Publish', desc: 'Push the tour live for your team', icon: PublishRounded, accent: '#059669' },
  { label: 'Explore', desc: 'Navigate room by room in 360°', icon: ViewInArRounded, accent: '#2563eb' },
];

function WorkflowStepCard({ step, index, compact = false }: {
  step: typeof WORKFLOW_STEPS[0];
  index: number;
  compact?: boolean;
}) {
  const Icon = step.icon;

  return (
    <m.div
      initial={{ opacity: 0, y: compact ? 10 : 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.07 }}
      style={{ height: '100%', minWidth: 0, width: '100%' }}
    >
      <Box sx={{
        position: 'relative',
        p: compact ? 1.5 : { xs: 2, md: 3 },
        borderRadius: compact ? '12px' : { xs: '16px', md: '18px' },
        border: '1px solid rgba(0,0,0,0.07)',
        backgroundColor: '#ffffff',
        display: 'flex',
        alignItems: compact ? 'center' : 'flex-start',
        gap: compact ? 1.25 : { xs: 1.5, md: 2 },
        height: '100%',
        minHeight: compact ? undefined : { md: 130 },
        overflow: 'hidden',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${step.accent}, ${step.accent}66)`,
        },
        '&:active': compact ? {
          borderColor: `${step.accent}35`,
          backgroundColor: `${step.accent}06`,
        } : {},
        '@media (hover: hover)': {
          '&:hover': {
            borderColor: `${step.accent}35`,
            transform: 'translateY(-2px)',
            boxShadow: `0 10px 28px ${step.accent}16, 0 2px 8px rgba(0,0,0,0.04)`,
          },
        },
      }}>
        <Box sx={{
          flexShrink: 0,
          width: compact ? 30 : { xs: 36, md: 44 },
          height: compact ? 30 : { xs: 36, md: 44 },
          borderRadius: compact ? '8px' : { xs: '10px', md: '12px' },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: step.accent,
          backgroundColor: `${step.accent}12`,
          border: `1px solid ${step.accent}22`,
        }}>
          <Icon sx={{ fontSize: compact ? 15 : { xs: 18, md: 22 } }} />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!compact && (
            <Typography sx={{
              fontSize: { xs: '0.625rem', md: '0.6875rem' },
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: step.accent,
              mb: { xs: 0.35, md: 0.5 },
              lineHeight: 1,
            }}>
              Step {String(index + 1).padStart(2, '0')}
            </Typography>
          )}
          <Typography sx={{
            fontSize: compact ? '0.8125rem' : { xs: '0.9375rem', md: '1.125rem' },
            fontWeight: 700,
            color: '#18181b',
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
            mb: compact ? 0 : { xs: 0.25, md: 0.5 },
          }}>
            {step.label}
          </Typography>
          {!compact && (
            <Typography sx={{ fontSize: { xs: '0.75rem', md: '0.875rem' }, color: '#71717a', lineHeight: 1.45 }}>
              {step.desc}
            </Typography>
          )}
        </Box>

        {compact && (
          <Typography sx={{
            flexShrink: 0,
            fontSize: '0.625rem',
            fontWeight: 700,
            color: 'rgba(0,0,0,0.2)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {String(index + 1).padStart(2, '0')}
          </Typography>
        )}
      </Box>
    </m.div>
  );
}

function WorkflowSection() {
  return (
    <Box sx={{
      py: { xs: 6, md: 12 },
      borderTop: '1px solid rgba(0,0,0,0.05)',
      backgroundColor: '#fafafa',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <Box sx={{ px: { xs: 3, md: 6 }, maxWidth: { xs: '100%', md: 1200 }, mx: 'auto', position: 'relative', zIndex: 1 }}>
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8 }}
        >
          <Box sx={{ textAlign: 'center', mb: { xs: 3.5, md: 7 } }}>
            <Typography sx={{
              fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
              fontSize: { xs: '1.5rem', md: '2.5rem' },
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: '#18181b',
              mb: { xs: 0.75, md: 1 },
            }}>
              A seamless flow.
            </Typography>
            <Typography sx={{ fontSize: { xs: '0.8125rem', md: '1rem' }, color: '#71717a' }}>
              From floor plan to published tour in four steps.
            </Typography>
          </Box>
        </m.div>

        {/* Mobile: compact 2×2 grid */}
        <Box sx={{
          display: { xs: 'grid', md: 'none' },
          gridTemplateColumns: '1fr 1fr',
          gap: 1.25,
        }}>
          {WORKFLOW_STEPS.map((step, i) => (
            <WorkflowStepCard key={step.label} step={step} index={i} compact />
          ))}
        </Box>

        {/* Desktop: horizontal pipeline */}
        <Box sx={{
          display: { xs: 'none', md: 'flex' },
          alignItems: 'stretch',
          gap: 2.5,
          width: '100%',
        }}>
          {WORKFLOW_STEPS.map((step, i) => (
            <React.Fragment key={step.label}>
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex' }}>
                <WorkflowStepCard step={step} index={i} />
              </Box>
              {i < WORKFLOW_STEPS.length - 1 && (
                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'rgba(0,0,0,0.15)', px: 0.5 }}>
                  <ArrowForwardRounded sx={{ fontSize: 20 }} />
                </Box>
              )}
            </React.Fragment>
          ))}
        </Box>
      </Box>
    </Box>
  );
}


// ── CTA Banner ────────────────────────────────────────────────────────────────

function CTABanner() {
  return (
    <Box sx={{ py: { xs: 12, md: 20 }, px: { xs: 3, md: 6 }, textAlign: 'center', background: '#ffffff', position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '100%', maxWidth: 600, height: 300, background: 'radial-gradient(ellipse, rgba(37,99,235,0.15) 0%, transparent 70%)', filter: 'blur(50px)' }} />
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2.5rem', md: '4rem' }, fontWeight: 800, letterSpacing: '-0.04em', color: '#18181b', mb: 3 }}>
            Ready to build?
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <CTAButton to="/login" variant="primary">
              Sign In <ArrowForwardRounded sx={{ fontSize: 16 }} />
            </CTAButton>
          </Box>
        </m.div>
      </Box>
    </Box>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

const SOCIAL_LINKS = [
  { icon: <LanguageRounded />, href: 'https://www.myhomeconstructions.com/', label: 'Website' },
  { icon: <Instagram />, href: 'https://www.instagram.com/myhomeconstructions_/?hl=en', label: 'Instagram' },
  { icon: <LinkedIn />, href: 'https://in.linkedin.com/company/my-home-constructions', label: 'LinkedIn' },
];

function Footer() {
  return (
    <Box component="footer" sx={{
      backgroundColor: '#ffffff',
      borderTop: '1px solid rgba(0,0,0,0.05)',
      pt: { xs: 4, md: 12 },
      pb: { xs: 3, md: 6 },
      px: { xs: 3, md: 6 },
    }}>
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>

        {/* ── Mobile: minimal footer ── */}
        <Box sx={{ display: { xs: 'block', md: 'none' } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box component="img" src="/assets/new_logo.png" alt="My Home Group" sx={{ height: 26, width: 'auto', objectFit: 'contain' }} />
              <Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: '#18181b', letterSpacing: '-0.03em', lineHeight: 1.1 }}>Prāṅgaṇ</Typography>
                <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#a1a1aa', letterSpacing: '0.12em', mt: 0.25 }}>BY SITESURELABS</Typography>
              </Box>
            </Box>
            <Box
              component={Link}
              to="/login"
              sx={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: '#18181b',
                textDecoration: 'none',
                px: 1.75,
                py: 0.75,
                borderRadius: '8px',
                border: '1px solid rgba(0,0,0,0.1)',
                backgroundColor: 'rgba(0,0,0,0.02)',
              }}
            >
              Sign In
            </Box>
          </Box>

          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pt: 2.5,
            borderTop: '1px solid rgba(0,0,0,0.06)',
          }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {SOCIAL_LINKS.map(({ icon, href, label }) => (
                <Box
                  key={label}
                  component="a"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  sx={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32, borderRadius: '8px',
                    color: '#71717a',
                    '& svg': { fontSize: 17 },
                    '&:active': { color: '#18181b' },
                  }}
                >
                  {icon}
                </Box>
              ))}
            </Box>
            <Typography sx={{ fontSize: '0.6875rem', color: '#a1a1aa' }}>© 2026 SiteSureLabs</Typography>
          </Box>
        </Box>

        {/* ── Desktop: full footer ── */}
        <Box sx={{ display: { xs: 'none', md: 'block' } }}>
          <Box sx={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 2,
            mb: 10,
          }}>
            <Box sx={{ maxWidth: 320 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 3 }}>
                <Box component="img" src="/assets/new_logo.png" alt="My Home Group" sx={{ height: 32, width: 'auto', objectFit: 'contain' }} />
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: '#18181b', letterSpacing: '-0.03em', lineHeight: 1 }}>Prāṅgaṇ</Typography>
                  <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#52525b', letterSpacing: '0.15em', mt: 0.5 }}>BY SITESURELABS</Typography>
                </Box>
              </Box>
              <Typography sx={{ fontSize: '0.9375rem', color: '#52525b', lineHeight: 1.7, mb: 4 }}>
                The visual operating system for modern construction teams.
              </Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                {SOCIAL_LINKS.map(({ icon, href, label }) => (
                  <Box
                    key={label}
                    component="a"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 44, height: 44, borderRadius: '12px',
                      border: '1px solid rgba(0,0,0,0.1)', backgroundColor: 'rgba(0,0,0,0.02)',
                      color: '#52525b', transition: 'all 0.2s',
                      '&:hover': { color: '#18181b', borderColor: 'rgba(0,0,0,0.2)', backgroundColor: 'rgba(0,0,0,0.06)' },
                    }}
                  >
                    {icon}
                  </Box>
                ))}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 14 }}>
              <Box>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: '#18181b', mb: 3 }}>Features</Typography>
                {FEATURES.map(f => (
                  <Typography key={f.title} sx={{ display: 'block', mb: 2, fontSize: '0.9375rem', color: '#52525b' }}>
                    {f.title}
                  </Typography>
                ))}
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: '#18181b', mb: 3 }}>Get Started</Typography>
                <Box component={Link} to="/login" sx={{ display: 'block', fontSize: '0.9375rem', color: '#52525b', textDecoration: 'none', transition: 'color 0.2s', '&:hover': { color: '#18181b' } }}>
                  Sign In
                </Box>
              </Box>
            </Box>
          </Box>

          <Box sx={{ borderTop: '1px solid rgba(0,0,0,0.05)', pt: 4 }}>
            <Typography sx={{ fontSize: '0.875rem', color: '#71717a' }}>© 2026 SiteSureLabs</Typography>
          </Box>
        </Box>

      </Box>
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <Box sx={{ minHeight: '100vh', overflowX: 'hidden', backgroundColor: '#ffffff', color: '#18181b', '& ::selection': { background: 'rgba(0,0,0,0.08)' } }}>
      <Navbar />
      <Hero />
      <FeaturesSection />
      <WorkflowSection />
      <CTABanner />
      <Footer />
    </Box>
  );
}
