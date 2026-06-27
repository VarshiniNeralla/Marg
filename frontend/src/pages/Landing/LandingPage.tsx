import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid } from '@mui/material';
import {
  ViewInArRounded, MapRounded, CameraAltRounded, CheckCircleRounded,
  BugReportRounded, BarChartRounded, ArrowForwardRounded,
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
  { icon: <ViewInArRounded />, title: '360° Virtual Tours', desc: 'Room-to-room hotspot navigation in immersive equirectangular panoramas.', colSpan: 2, rowSpan: 1 },
  { icon: <MapRounded />, title: 'Floor Plan Mapping', desc: 'Overlay interactive SVG markers on PDF/PNG plans with live capture status.', colSpan: 1, rowSpan: 2 },
  { icon: <CameraAltRounded />, title: 'Capture Management', desc: 'Drag-drop multi-file uploads with per-file progress tracking.', colSpan: 1, rowSpan: 1 },
  { icon: <CheckCircleRounded />, title: 'Review Workflows', desc: '6-stage lifecycle from upload to publish — assign, review, approve.', colSpan: 1, rowSpan: 1 },
  { icon: <BugReportRounded />, title: 'Defect Tracking', desc: 'Log, filter, and assign defects by severity, floor, and room.', colSpan: 1, rowSpan: 1 },
  { icon: <BarChartRounded />, title: 'Analytics Dashboard', desc: 'KPIs, charts, and team productivity across your full portfolio.', colSpan: 2, rowSpan: 1 },
];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 100, damping: 20 } },
};

function FeaturesSection() {
  return (
    <Box sx={{ py: { xs: 8, md: 16 }, px: { xs: 3, md: 6 }, maxWidth: 1200, mx: 'auto' }}>
      <m.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.8 }}
      >
        <Box sx={{ textAlign: 'center', mb: { xs: 5, md: 12 } }}>
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
          gridAutoRows: { xs: 'auto', md: 'minmax(220px, auto)' },
          gap: { xs: 2, md: 3 },
        }}>
          {FEATURES.map((f, i) => (
            <m.div key={f.title} variants={itemVariants} style={{ height: '100%' }}>
              <Box sx={{
                gridColumn: { xs: 'span 1', md: `span ${f.colSpan}` },
                gridRow: { xs: 'span 1', md: `span ${f.rowSpan}` },
                p: { xs: 2.5, sm: 3.5, md: 5 }, borderRadius: { xs: '20px', md: '32px' },
                border: '1px solid rgba(0,0,0,0.08)', 
                backgroundColor: 'rgba(255,255,255,0.02)',
                backdropFilter: 'blur(20px)',
                height: '100%',
                display: 'flex', flexDirection: 'column',
                transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                position: 'relative', overflow: 'hidden',
                '&:hover': {
                  borderColor: 'rgba(0,0,0,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  transform: 'translateY(-4px)',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                },
                '&::after': { // subtle inner glow
                  content: '""', position: 'absolute', inset: 0,
                  background: 'radial-gradient(circle at 50% 0%, rgba(0,0,0,0.06) 0%, transparent 70%)',
                  opacity: 0, transition: 'opacity 0.4s', pointerEvents: 'none',
                },
                '&:hover::after': { opacity: 1 },
              }}>
                <Box sx={{
                  width: { xs: 44, md: 56 }, height: { xs: 44, md: 56 }, borderRadius: { xs: '12px', md: '16px' },
                  backgroundColor: 'rgba(0,0,0,0.06)', color: '#18181b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', mb: { xs: 2, md: 4 },
                  border: '1px solid rgba(0,0,0,0.1)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2) inset',
                }}>
                  {React.cloneElement(f.icon, { sx: { fontSize: { xs: 22, md: 28 } } })}
                </Box>
                <Typography sx={{
                  fontSize: { xs: '1.0625rem', md: f.colSpan === 2 ? '1.5rem' : '1.25rem' },
                  fontWeight: 700, color: '#18181b', mb: { xs: 1, md: 2 }, letterSpacing: '-0.03em'
                }}>
                  {f.title}
                </Typography>
                <Typography sx={{
                  fontSize: { xs: '0.875rem', md: '1rem' }, color: '#52525b', lineHeight: 1.6,
                  maxWidth: { xs: '100%', md: f.colSpan === 2 ? '80%' : '100%' }
                }}>
                  {f.desc}
                </Typography>
              </Box>
            </m.div>
          ))}
        </Box>
      </m.div>
    </Box>
  );
}

// ── Workflow ──────────────────────────────────────────────────────────────────

function WorkflowSection() {
  const steps = ['Capture', 'Review', 'Publish', 'Explore'];
  return (
    <Box sx={{ py: { xs: 10, md: 16 }, borderTop: '1px solid rgba(0,0,0,0.05)', backgroundColor: '#fafafa', position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ px: { xs: 3, md: 6 }, maxWidth: 1200, mx: 'auto', position: 'relative', zIndex: 1 }}>
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8 }}
        >
          <Box sx={{ textAlign: 'center', mb: { xs: 8, md: 12 } }}>
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2rem', md: '3rem' }, fontWeight: 800, letterSpacing: '-0.04em', color: '#18181b', mb: 2 }}>
              A seamless flow.
            </Typography>
          </Box>
        </m.div>

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: 'center', justifyContent: 'center' }}>
          {steps.map((step, i) => (
            <React.Fragment key={step}>
              <m.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                style={{ flex: 1, width: '100%' }}
              >
                <Box sx={{ 
                  p: 3, borderRadius: '20px', 
                  border: '1px solid rgba(0,0,0,0.05)', 
                  backgroundColor: 'rgba(0,0,0,0.02)', 
                  textAlign: 'center'
                }}>
                  <Typography sx={{ fontSize: '0.875rem', color: '#71717a', mb: 1 }}>Step 0{i + 1}</Typography>
                  <Typography sx={{ fontSize: '1.25rem', fontWeight: 600, color: '#18181b' }}>{step}</Typography>
                </Box>
              </m.div>
              {i < steps.length - 1 && (
                <Box sx={{ display: { xs: 'none', md: 'block' }, color: '#3f3f46' }}>
                  <ArrowForwardRounded />
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

function Footer() {
  return (
    <Box component="footer" sx={{ backgroundColor: '#ffffff', borderTop: '1px solid rgba(0,0,0,0.05)', pt: 12, pb: 6, px: { xs: 3, md: 6 } }}>
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', gap: { xs: 6, md: 2 }, mb: 10 }}>
          <Box sx={{ maxWidth: 320 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 3 }}>
              <Box component="img" src="/assets/new_logo.png" alt="My Home Group" sx={{ height: 32, width: 'auto', objectFit: 'contain' }} />
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: '#18181b', letterSpacing: '-0.03em', lineHeight: 1 }}>Prāṅgaṇ</Typography>
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#52525b', letterSpacing: '0.15em', mt: 0.5 }}>BY SITESURELABS</Typography>
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.9375rem', color: '#52525b', lineHeight: 1.7 }}>
              The visual operating system for modern construction teams.
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: { xs: 6, sm: 10, md: 14 }, flexWrap: 'wrap' }}>
            {[
              { title: 'Product', links: ['Features', 'Pricing', 'Changelog'] },
              { title: 'Company', links: ['About', 'Contact', 'Blog'] },
              { title: 'Legal', links: ['Privacy', 'Terms', 'Security'] },
            ].map(col => (
              <Box key={col.title}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: '#18181b', mb: 3 }}>{col.title}</Typography>
                {col.links.map(label => (
                  <Box key={label} component={Link} to="#" sx={{ display: 'block', mb: 2, fontSize: '0.9375rem', color: '#52525b', textDecoration: 'none', transition: 'color 0.2s', '&:hover': { color: '#18181b' } }}>
                    {label}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
        <Box sx={{ borderTop: '1px solid rgba(0,0,0,0.05)', pt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ fontSize: '0.875rem', color: '#71717a' }}>© 2026 SiteSureLabs</Typography>
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
