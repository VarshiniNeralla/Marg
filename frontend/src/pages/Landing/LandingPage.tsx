import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid } from '@mui/material';
import {
  ViewInArRounded, MapRounded, CameraAltRounded, CheckCircleRounded,
  BugReportRounded, BarChartRounded, ArrowForwardRounded,
  KeyboardArrowDownRounded, StarRounded,
} from '@mui/icons-material';
import { colors, shadows, motion } from '@theme/tokens';

// ── Shared primitives ─────────────────────────────────────────────────────────

const NAV_H = 64;

function GradientText({ children, sx = {} }: { children: React.ReactNode; sx?: object }) {
  return (
    <Box component="span" sx={{
      background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
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
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.75,
      px: 1.5, py: 0.5, borderRadius: '999px',
      border: '1px solid rgba(37,99,235,0.2)',
      backgroundColor: 'rgba(37,99,235,0.06)',
      fontSize: '0.75rem', fontWeight: 600, color: colors.primary,
      letterSpacing: '0.02em',
    }}>
      {children}
    </Box>
  );
}

function CTAButton({ children, to, variant = 'primary', onClick }: {
  children: React.ReactNode; to?: string; variant?: 'primary' | 'ghost'; onClick?: () => void;
}) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 1,
    px: 2.5, py: 1.375, borderRadius: '10px',
    fontSize: '0.9375rem', fontWeight: 600, cursor: 'pointer',
    textDecoration: 'none', transition: `all ${motion.durationFast}`,
    letterSpacing: '-0.01em',
  };
  const styles = variant === 'primary'
    ? { ...base, background: colors.primaryGradient, color: '#fff', boxShadow: shadows.btn, '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 6px 20px rgba(37,99,235,0.38)' } }
    : { ...base, color: colors.textStrong, border: `1.5px solid ${colors.border}`, backgroundColor: 'transparent', '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft } };
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
      backdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'none',
      backgroundColor: scrolled ? 'rgba(255,255,255,0.88)' : 'transparent',
      borderBottom: scrolled ? `1px solid rgba(15,23,42,0.06)` : '1px solid transparent',
      transition: `all ${motion.durationNormal}`,
    }}>
      <Box component={Link} to="/" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mr: 'auto', textDecoration: 'none' }}>
        <Box component="img" src="/assets/new_logo.png" alt="My Home Group" sx={{ height: 32, width: 'auto', objectFit: 'contain', flexShrink: 0 }} />
        <Box>
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>Horizon</Typography>
          <Typography sx={{ fontSize: '0.625rem', fontWeight: 500, color: colors.textSubdued, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}>by SiteSureLabs</Typography>
        </Box>
      </Box>

      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.5 }}>
        <Box component={Link} to="/login" sx={{ px: 2, py: 0.875, borderRadius: '8px', fontSize: '0.9375rem', fontWeight: 500, color: colors.textSecondary, textDecoration: 'none', '&:hover': { color: colors.textStrong } }}>
          Sign in
        </Box>
        <CTAButton to="/register" variant="primary">Register</CTAButton>
      </Box>

      {/* Mobile hamburger */}
      <Box onClick={() => setMenuOpen(v => !v)} sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', gap: 0.5, p: 1, cursor: 'pointer' }}>
        {[0, 1, 2].map(i => (
          <Box key={i} sx={{ width: 22, height: 2, borderRadius: '2px', backgroundColor: colors.textStrong, transition: `all ${motion.durationFast}`,
            ...(menuOpen && i === 0 && { transform: 'rotate(45deg) translate(3px, 3px)' }),
            ...(menuOpen && i === 1 && { opacity: 0 }),
            ...(menuOpen && i === 2 && { transform: 'rotate(-45deg) translate(3px, -3px)' }),
          }} />
        ))}
      </Box>

      {/* Mobile menu */}
      {menuOpen && (
        <Box sx={{ position: 'absolute', top: NAV_H, left: 0, right: 0, backgroundColor: '#fff', borderBottom: `1px solid ${colors.border}`, p: 2, display: 'flex', flexDirection: 'column', gap: 0.5, boxShadow: shadows.lg }}>
          {[['Sign in', '/login']].map(([label, path]) => (
            <Box key={label} component={Link} to={path} onClick={() => setMenuOpen(false)} sx={{ px: 2, py: 1.25, borderRadius: '8px', fontSize: '0.9375rem', color: colors.textSecondary, textDecoration: 'none', '&:hover': { backgroundColor: colors.bgDeep } }}>
              {label}
            </Box>
          ))}
          <Box sx={{ mt: 1 }}>
            <CTAButton to="/register" variant="primary">Register</CTAButton>
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
      {/* Background grid */}
      <Box sx={{
        position: 'absolute', inset: 0, zIndex: 0,
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '40px 40px',
        maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 0%, transparent 80%)',
      }} />
      {/* Glow orb */}
      <Box sx={{ position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)', width: 600, height: 400, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(37,99,235,0.12) 0%, transparent 70%)', filter: 'blur(40px)', pointerEvents: 'none' }} />

      <Box sx={{ position: 'relative', zIndex: 1, maxWidth: 860, mx: 'auto' }}>
        {/* <Pill>
          <StarRounded sx={{ fontSize: 12 }} />
          Now in public beta · Used by 40+ construction firms
        </Pill> */}

        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          <Box component="img" src="/assets/new_logo.png" alt="My Home Group" sx={{ height: 56, width: 'auto', objectFit: 'contain' }} />
        </Box>

        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '2.5rem', sm: '3.5rem', md: '4.5rem' },
          fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.05em',
          color: colors.textStrong, mb: 1,
        }}>
          Horizon
        </Typography>

        <Typography sx={{
          fontSize: '0.875rem', fontWeight: 600, color: colors.textSubdued,
          letterSpacing: '0.07em', textTransform: 'uppercase', mb: 3,
        }}>
          by SiteSureLabs
        </Typography>

        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.25rem', sm: '1.5rem', md: '1.75rem' },
          fontWeight: 500, color: colors.textMuted, lineHeight: 1.35,
          letterSpacing: '-0.02em', mb: 4,
        }}>
          The <GradientText>Digital Twin</GradientText> Platform for Construction
        </Typography>

        <Typography sx={{ fontSize: { xs: '1rem', md: '1.125rem' }, color: colors.textMuted, maxWidth: 560, mx: 'auto', lineHeight: 1.7, mb: 5 }}>
          360° virtual tours, floor plan mapping, capture reviews, and real-time construction analytics - all in one platform purpose-built for construction teams.
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          <CTAButton to="/register" variant="primary">
            Register <ArrowForwardRounded sx={{ fontSize: 16 }} />
          </CTAButton>
        </Box>
{/* 
        <Typography sx={{ mt: 3, fontSize: '0.8125rem', color: colors.textSubdued }}>
          No credit card required · 14-day free trial · Cancel anytime
        </Typography> */}
      </Box>

      {/* Dashboard mockup */}
      <Box sx={{ mt: 8, maxWidth: 1100, mx: 'auto', position: 'relative', zIndex: 1 }}>
        <Box sx={{ borderRadius: '20px', overflow: 'hidden', boxShadow: '0 40px 80px rgba(15,23,42,0.18), 0 0 0 1px rgba(15,23,42,0.06)', background: '#fff' }}>
          {/* Browser chrome */}
          <Box sx={{ height: 44, backgroundColor: '#f8f9fb', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', px: 2, gap: 1 }}>
            {['#ef4444','#f59e0b','#10b981'].map((c, i) => <Box key={i} sx={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: c }} />)}
            <Box sx={{ ml: 1, flex: 1, maxWidth: 320, height: 22, borderRadius: '6px', backgroundColor: '#e5e7eb', display: 'flex', alignItems: 'center', px: 1.5 }}>
              <Typography sx={{ fontSize: '0.6875rem', color: '#9ca3af' }}>horizon.sitesurelabs.com/dashboard</Typography>
            </Box>
          </Box>
          {/* Dashboard preview */}
          <Box sx={{ display: 'flex', height: 480 }}>
            {/* Sidebar */}
            <Box sx={{ width: 200, backgroundColor: '#0f172a', p: 2, flexShrink: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, px: 1 }}>
                <Box component="img" src="/assets/new_logo.png" alt="Horizon" sx={{ height: 20, width: 'auto', objectFit: 'contain', filter: 'brightness(0) invert(1)', flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: '#fff' }}>Horizon</Typography>
              </Box>
              {['Dashboard','Projects','Captures','Tours','Floor Plans','Defects','Analytics'].map((item, i) => (
                <Box key={item} sx={{ px: 1.5, py: 0.875, borderRadius: '6px', mb: 0.25, backgroundColor: i === 0 ? 'rgba(37,99,235,0.25)' : 'transparent', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: i === 0 ? '#60a5fa' : 'rgba(255,255,255,0.25)' }} />
                  <Typography sx={{ fontSize: '0.75rem', color: i === 0 ? '#93c5fd' : 'rgba(255,255,255,0.45)', fontWeight: i === 0 ? 600 : 400 }}>{item}</Typography>
                </Box>
              ))}
            </Box>
            {/* Main content */}
            <Box sx={{ flex: 1, p: 3, backgroundColor: '#f8f9fb', overflowY: 'hidden' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5, mb: 2 }}>
                {[
                  { label: 'Total Captures', value: '1,284', color: '#2563eb' },
                  { label: 'Reviews Pending', value: '23', color: '#d97706' },
                  { label: 'Tours Published', value: '89', color: '#16a34a' },
                  { label: 'Open Defects', value: '7', color: '#dc2626' },
                ].map(({ label, value, color }) => (
                  <Box key={label} sx={{ backgroundColor: '#fff', borderRadius: '10px', p: 1.5, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                    <Typography sx={{ fontSize: '0.6875rem', color: '#64748b', mb: 0.5 }}>{label}</Typography>
                    <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</Typography>
                  </Box>
                ))}
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 1.5 }}>
                <Box sx={{ backgroundColor: '#fff', borderRadius: '10px', p: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', height: 180 }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', mb: 1.5 }}>Capture Volume</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, height: 120 }}>
                    {[40, 65, 50, 80, 70, 90, 75, 95].map((h, i) => (
                      <Box key={i} sx={{ flex: 1, borderRadius: '4px 4px 0 0', background: i === 7 ? colors.primaryGradient : '#e0e7ff', height: `${h}%` }} />
                    ))}
                  </Box>
                </Box>
                <Box sx={{ backgroundColor: '#fff', borderRadius: '10px', p: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', mb: 1.5 }}>Projects</Typography>
                  {['My Home Udyan'].map((name, i) => (
                    <Box key={name} sx={{ mb: 1.25 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.375 }}>
                        <Typography sx={{ fontSize: '0.6875rem', color: '#475569' }}>{name}</Typography>
                        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: '#2563eb' }}>{[68, 100, 72][i]}%</Typography>
                      </Box>
                      <Box sx={{ height: 4, borderRadius: '99px', backgroundColor: '#e0e7ff' }}>
                        <Box sx={{ height: '100%', width: `${[68, 100, 72][i]}%`, borderRadius: '99px', background: colors.primaryGradient }} />
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
        {/* Shadow blur */}
        <Box sx={{ position: 'absolute', bottom: -20, left: '10%', right: '10%', height: 40, background: 'rgba(37,99,235,0.12)', filter: 'blur(24px)', borderRadius: '50%' }} />
      </Box>

      {/* Scroll hint */}
      <Box sx={{ mt: 6, display: 'flex', justifyContent: 'center', animation: 'bounce 2s infinite', '@keyframes bounce': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(6px)' } } }}>
        <KeyboardArrowDownRounded sx={{ color: colors.textSubdued, fontSize: 24 }} />
      </Box>
    </Box>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: <ViewInArRounded sx={{ fontSize: 28 }} />, color: '#2563eb', bg: 'rgba(37,99,235,0.08)', title: '360° Virtual Tours', desc: 'Immersive equirectangular panoramas with room-to-room hotspot navigation. Powered by Photo Sphere Viewer v5.' },
  { icon: <MapRounded sx={{ fontSize: 28 }} />, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', title: 'Floor Plan Mapping', desc: 'Upload PDF/PNG floor plans and overlay interactive SVG room markers with live capture status indicators.' },
  { icon: <CameraAltRounded sx={{ fontSize: 28 }} />, color: '#0891b2', bg: 'rgba(8,145,178,0.08)', title: 'Capture Management', desc: 'Multi-file drag-drop upload pipeline. Supports .jpg .jpeg .png .dng .insp .insv with per-file progress tracking.' },
  { icon: <CheckCircleRounded sx={{ fontSize: 28 }} />, color: '#16a34a', bg: 'rgba(22,163,74,0.08)', title: 'Review Workflows', desc: '6-state review lifecycle: Uploaded → Assigned → Reviewing → Changes Requested → Approved → Published.' },
  { icon: <BugReportRounded sx={{ fontSize: 28 }} />, color: '#dc2626', bg: 'rgba(220,38,38,0.08)', title: 'Defect Tracking', desc: 'Create, filter, and assign defects by severity. Link defects to specific captures, floors, and rooms.' },
  { icon: <BarChartRounded sx={{ fontSize: 28 }} />, color: '#d97706', bg: 'rgba(217,119,6,0.08)', title: 'Analytics Dashboard', desc: 'KPI tiles, bar charts, team productivity metrics, and project completion tracking across your portfolio.' },
];

function FeaturesSection() {
  return (
    <Box sx={{ py: { xs: 8, md: 12 }, px: { xs: 3, md: 6 }, maxWidth: 1200, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: { xs: 6, md: 8 } }}>
        <Pill>Platform Features</Pill>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2rem', md: '2.75rem' }, fontWeight: 800, letterSpacing: '-0.04em', color: colors.textStrong, mt: 2, mb: 1.5 }}>
          Everything your construction team needs
        </Typography>
        <Typography sx={{ fontSize: '1.0625rem', color: colors.textMuted, maxWidth: 540, mx: 'auto', lineHeight: 1.7 }}>
          A complete digital twin platform — from first site capture to final handover delivery.
        </Typography>
      </Box>
      <Grid container spacing={3}>
        {FEATURES.map(f => (
          <Grid key={f.title} size={{ xs: 12, sm: 6, md: 4 }}>
            <Box sx={{ p: 3, borderRadius: '20px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, height: '100%', transition: `all ${motion.durationNormal}`, '&:hover': { boxShadow: shadows.lg, transform: 'translateY(-3px)', borderColor: f.color + '40' } }}>
              <Box sx={{ width: 52, height: 52, borderRadius: '14px', backgroundColor: f.bg, color: f.color, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2 }}>
                {f.icon}
              </Box>
              <Typography sx={{ fontSize: '1.0625rem', fontWeight: 700, color: colors.textStrong, mb: 1, letterSpacing: '-0.02em' }}>{f.title}</Typography>
              <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, lineHeight: 1.65 }}>{f.desc}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

// ── Workflow ──────────────────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { num: '01', title: 'Capture', desc: 'Field teams upload 360° panoramas directly from the site. Supports all major 360 camera formats.', color: '#2563eb' },
  { num: '02', title: 'Review', desc: 'QA reviewers are assigned captures. Approve, request changes, or reject with detailed notes.', color: '#7c3aed' },
  { num: '03', title: 'Publish', desc: 'Approved captures are published as virtual tours with room-to-room navigation hotspots.', color: '#16a34a' },
  { num: '04', title: 'Explore', desc: 'Clients and stakeholders explore every room in immersive 360° from any device, anywhere.', color: '#0891b2' },
  { num: '05', title: 'Analyze', desc: 'Track coverage progress, team performance, and defect resolution across your entire portfolio.', color: '#d97706' },
];

function WorkflowSection() {
  return (
    <Box sx={{ py: { xs: 8, md: 12 }, backgroundColor: colors.ink, position: 'relative', overflow: 'hidden' }}>
      {/* Background glow */}
      <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 800, height: 400, background: 'radial-gradient(ellipse, rgba(37,99,235,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <Box sx={{ px: { xs: 3, md: 6 }, maxWidth: 1200, mx: 'auto', position: 'relative', zIndex: 1 }}>
        <Box sx={{ textAlign: 'center', mb: { xs: 6, md: 8 } }}>
          <Pill>How It Works</Pill>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2rem', md: '2.75rem' }, fontWeight: 800, letterSpacing: '-0.04em', color: '#fff', mt: 2, mb: 1.5 }}>
            From site to screen in five steps
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: { md: 'stretch' } }}>
          {WORKFLOW_STEPS.map((step, i) => (
            <Box key={step.num} sx={{ flex: 1, position: 'relative' }}>
              {/* Connector line */}
              {i < WORKFLOW_STEPS.length - 1 && (
                <Box sx={{ display: { xs: 'none', md: 'block' }, position: 'absolute', top: 26, right: -1, width: 2, height: 2, zIndex: 2 }}>
                  <ArrowForwardRounded sx={{ fontSize: 16, color: 'rgba(255,255,255,0.2)', position: 'absolute', right: -24, top: -8 }} />
                </Box>
              )}
              <Box sx={{ p: 2.5, borderRadius: '16px', border: '1px solid rgba(255,255,255,0.07)', backgroundColor: 'rgba(255,255,255,0.04)', height: '100%' }}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '10px', backgroundColor: step.color + '22', mb: 2 }}>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 800, color: step.color }}>{step.num}</Typography>
                </Box>
                <Typography sx={{ fontSize: '1.0625rem', fontWeight: 700, color: '#fff', mb: 1, letterSpacing: '-0.02em' }}>{step.title}</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.65 }}>{step.desc}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// ── Testimonials ──────────────────────────────────────────────────────────────

const TESTIMONIALS = [
  { name: 'Rajesh Nair', role: 'Head of Projects, My Home Constructions', quote: 'Horizon completely transformed how we deliver virtual handovers. What took 3 months of coordination now takes a week. The review workflow alone saved us from 4 major defects.' },
  { name: 'Priya Sharma', role: 'Project Lead, Prestige Group', quote: 'The floor plan mapping feature is exceptional. Our clients can now walk through every apartment virtually before possession. Tour view count went from 0 to 1,200 in the first month.' },
  { name: 'Arjun Mehta', role: 'QA Director, Brigade Group', quote: 'The capture review workflow is exactly what we needed. Assigning reviewers, tracking status, requesting re-uploads — all in one place. Our QA cycle time dropped by 60%.' },
];

// function TestimonialsSection() {
//   return (
//     <Box sx={{ py: { xs: 8, md: 12 }, px: { xs: 3, md: 6 }, maxWidth: 1200, mx: 'auto' }}>
//       <Box sx={{ textAlign: 'center', mb: { xs: 6, md: 8 } }}>
//         <Pill>Customer Stories</Pill>
//         <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2rem', md: '2.75rem' }, fontWeight: 800, letterSpacing: '-0.04em', color: colors.textStrong, mt: 2 }}>
//           Loved by construction teams
//         </Typography>
//       </Box>
//       <Grid container spacing={3}>
//         {TESTIMONIALS.map(t => (
//           <Grid key={t.name} size={{ xs: 12, md: 4 }}>
//             <Box sx={{ p: 3, borderRadius: '20px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, height: '100%', display: 'flex', flexDirection: 'column' }}>
//               <Box sx={{ display: 'flex', gap: 0.5, mb: 2.5 }}>
//                 {[0,1,2,3,4].map(i => <StarRounded key={i} sx={{ fontSize: 16, color: '#f59e0b' }} />)}
//               </Box>
//               <Typography sx={{ fontSize: '1rem', color: colors.textSecondary, lineHeight: 1.7, flex: 1, mb: 2.5, fontStyle: 'italic' }}>
//                 "{t.quote}"
//               </Typography>
//               <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
//                 <Box sx={{ width: 40, height: 40, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
//                   <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff' }}>{t.name[0]}</Typography>
//                 </Box>
//                 <Box>
//                   <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{t.name}</Typography>
//                   <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{t.role}</Typography>
//                 </Box>
//               </Box>
//             </Box>
//           </Grid>
//         ))}
//       </Grid>
//     </Box>
//   );
// }

// ── FAQ ───────────────────────────────────────────────────────────────────────

const FAQS = [
  { q: 'What camera formats are supported?', a: 'Horizon supports .jpg, .jpeg, .png for standard photos and .dng (DNG raw), .insp/.insv (Insta360) for 360° cameras. RAW and Insta360 files go through our processing pipeline before becoming viewable panoramas.' },
  { q: 'How does the review workflow work?', a: 'Captures go through a 6-state lifecycle: Uploaded → Assigned → Reviewing → Changes Requested → Approved → Published. Reviewers can approve, request re-uploads, or reject with detailed notes.' },
  { q: 'Can I invite my entire construction team?', a: 'Yes. You can invite unlimited team members with role-based permissions: Admin, Manager, Reviewer, and Viewer. Each role has specific access to captures, tours, analytics, and settings.' },
  { q: 'Is data stored securely?', a: 'All media files are stored on Cloudinary with private delivery URLs. Metadata is stored on MongoDB Atlas with tenant isolation. Access tokens expire in 15 minutes; refresh tokens are httpOnly cookies.' },
  { q: 'Do clients need an account to view tours?', a: 'Published tours can be shared via direct link with no login required. Unpublished or in-review tours require authentication.' },
  { q: 'What happens during the free trial?', a: 'You get full platform access for 14 days including unlimited captures, tours, and team members. No credit card required. After 14 days you can choose a plan or export your data.' },
];

function FAQSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Box sx={{ py: { xs: 8, md: 12 }, px: { xs: 3, md: 6 }, backgroundColor: colors.bgDeep }}>
      <Box sx={{ maxWidth: 720, mx: 'auto' }}>
        <Box sx={{ textAlign: 'center', mb: { xs: 6, md: 8 } }}>
          <Pill>FAQ</Pill>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2rem', md: '2.5rem' }, fontWeight: 800, letterSpacing: '-0.04em', color: colors.textStrong, mt: 2 }}>
            Common questions
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {FAQS.map((faq, i) => {
            const isOpen = open === i;
            return (
            <Box key={i} sx={{ borderRadius: '14px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, overflow: 'hidden', transition: 'box-shadow 220ms ease, border-color 220ms ease', boxShadow: isOpen ? '0 12px 30px rgba(15,23,42,0.08)' : 'none' }}>
              <Box onClick={() => setOpen(isOpen ? null : i)} sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', transition: 'background-color 180ms ease', '&:hover': { backgroundColor: colors.bgDeep } }}>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, pr: 2 }}>{faq.q}</Typography>
                <Box sx={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 260ms cubic-bezier(0.4, 0, 0.2, 1)', flexShrink: 0 }}>
                  <KeyboardArrowDownRounded sx={{ fontSize: 20, color: colors.textMuted }} />
                </Box>
              </Box>
              <Box sx={{ maxHeight: isOpen ? 220 : 0, opacity: isOpen ? 1 : 0, overflow: 'hidden', transition: 'max-height 320ms cubic-bezier(0.4, 0, 0.2, 1), opacity 220ms ease' }}>
                <Box sx={{ px: 3, pb: isOpen ? 2.5 : 0, transform: isOpen ? 'translateY(0)' : 'translateY(-4px)', transition: 'padding-bottom 260ms ease, transform 260ms ease' }}>
                  <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, lineHeight: 1.7 }}>{faq.a}</Typography>
                </Box>
              </Box>
            </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

// ── CTA Banner ────────────────────────────────────────────────────────────────

function CTABanner() {
  return (
    <Box sx={{ py: { xs: 8, md: 12 }, px: { xs: 3, md: 6 }, textAlign: 'center', background: colors.primaryGradient, position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)', backgroundSize: '32px 32px' }} />
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2rem', md: '2.75rem' }, fontWeight: 800, letterSpacing: '-0.04em', color: '#fff', mb: 1.5 }}>
          Ready to digitise your construction site?
        </Typography>
        <Typography sx={{ fontSize: '1.0625rem', color: 'rgba(255,255,255,0.75)', mb: 4, maxWidth: 480, mx: 'auto' }}>
          Join 40+ construction teams already using Horizon to deliver better handovers.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Box component={Link} to="/register" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 3, py: 1.5, borderRadius: '10px', backgroundColor: '#fff', color: colors.primary, fontWeight: 700, fontSize: '1rem', textDecoration: 'none', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', '&:hover': { transform: 'translateY(-1px)' }, transition: `all ${motion.durationFast}` }}>
            Register <ArrowForwardRounded sx={{ fontSize: 16 }} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <Box component="footer" sx={{ backgroundColor: colors.ink, pt: 8, pb: 4, px: { xs: 3, md: 6 } }}>
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
        <Grid container spacing={4} sx={{ mb: 6 }}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
              <Box component="img" src="/assets/new_logo.png" alt="My Home Group" sx={{ height: 28, width: 'auto', objectFit: 'contain', filter: 'brightness(0) invert(1)', flexShrink: 0 }} />
              <Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.1 }}>Horizon</Typography>
                <Typography sx={{ fontSize: '0.5625rem', fontWeight: 500, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>by SiteSureLabs</Typography>
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.45)', lineHeight: 1.7, maxWidth: 280 }}>
              The digital twin platform for construction teams. Capture, review, and publish immersive virtual tours of every project.
            </Typography>
          </Grid>
          {[
            { title: 'Product', links: [['Features', '/features'], ['Pricing', '/pricing'], ['Changelog', '/'], ['Status', '/']] },
            { title: 'Company', links: [['About', '/'], ['Contact', '/contact'], ['Blog', '/'], ['Careers', '/']] },
            { title: 'Legal', links: [['Privacy', '/'], ['Terms', '/'], ['Security', '/'], ['Cookie Policy', '/']] },
          ].map(col => (
            <Grid key={col.title} size={{ xs: 6, md: 2.5 }}>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.07em', textTransform: 'uppercase', mb: 2 }}>{col.title}</Typography>
              {col.links.map(([label, path]) => (
                <Box key={label} component={Link} to={path} sx={{ display: 'block', mb: 1, fontSize: '0.9375rem', color: 'rgba(255,255,255,0.5)', textDecoration: 'none', '&:hover': { color: '#fff' }, transition: `color ${motion.durationFast}` }}>
                  {label}
                </Box>
              ))}
            </Grid>
          ))}
          <Grid size={{ xs: 12, md: 3 }}>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.07em', textTransform: 'uppercase', mb: 2 }}>Get started</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box component={Link} to="/login" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem', textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(255,255,255,0.06)', color: '#fff' }, transition: `all ${motion.durationFast}` }}>
                Sign in to your account
              </Box>
              <Box component={Link} to="/register" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', '&:hover': { opacity: 0.9 }, transition: `opacity ${motion.durationFast}` }}>
                <ArrowForwardRounded sx={{ fontSize: 14 }} /> Register
              </Box>
            </Box>
          </Grid>
        </Grid>
        <Box sx={{ borderTop: '1px solid rgba(255,255,255,0.07)', pt: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.3)' }}>
            © 2026 SiteSureLabs · Horizon. Built for construction teams.
          </Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.3)' }}>
            Made with care in Hyderabad, India
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: colors.bg }}>
      <Navbar />
      <Hero />
      <FeaturesSection />
      <WorkflowSection />
      <FAQSection />
      <CTABanner />
      <Footer />
    </Box>
  );
}
