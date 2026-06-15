import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid } from '@mui/material';
import {
  ViewInArRounded, CheckRounded, CloseRounded, ArrowForwardRounded,
  StarRounded,
} from '@mui/icons-material';
import { colors, shadows, motion } from '@theme/tokens';

const NAV_H = 64;

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.5, borderRadius: '999px', border: '1px solid rgba(37,99,235,0.2)', backgroundColor: 'rgba(37,99,235,0.06)', fontSize: '0.75rem', fontWeight: 600, color: colors.primary, letterSpacing: '0.02em' }}>
      {children}
    </Box>
  );
}

function Navbar() {
  return (
    <Box component="nav" sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, height: NAV_H, display: 'flex', alignItems: 'center', px: { xs: 2, md: 6 }, backdropFilter: 'blur(20px) saturate(180%)', backgroundColor: 'rgba(255,255,255,0.88)', borderBottom: `1px solid rgba(15,23,42,0.06)` }}>
      <Box component={Link} to="/" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mr: 'auto', textDecoration: 'none' }}>
        <Box component="img" src="/assets/new_logo.png" alt="My Home Group" sx={{ height: 32, width: 'auto', objectFit: 'contain', flexShrink: 0 }} />
        <Box>
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>Horizon</Typography>
          <Typography sx={{ fontSize: '0.625rem', fontWeight: 500, color: colors.textSubdued, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}>by SiteSureLabs</Typography>
        </Box>
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.5, mr: 4 }}>
        {[['Features', '/features'], ['Pricing', '/pricing'], ['Contact', '/contact']].map(([l, p]) => (
          <Box key={l} component={Link} to={p} sx={{ px: 1.5, py: 0.875, borderRadius: '8px', fontSize: '0.9375rem', fontWeight: 500, color: colors.textSecondary, textDecoration: 'none', '&:hover': { color: colors.textStrong, backgroundColor: 'rgba(15,23,42,0.04)' }, transition: `all ${motion.durationFast}` }}>{l}</Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box component={Link} to="/login" sx={{ px: 2, py: 0.875, borderRadius: '8px', fontSize: '0.9375rem', fontWeight: 500, color: colors.textSecondary, textDecoration: 'none', '&:hover': { color: colors.textStrong } }}>Sign in</Box>
        <Box component={Link} to="/register" sx={{ px: 2.5, py: 1, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontWeight: 600, fontSize: '0.9375rem', textDecoration: 'none', boxShadow: shadows.btn }}>Register</Box>
      </Box>
    </Box>
  );
}

const PLANS = [
  {
    name: 'Starter', monthlyPrice: 0, yearlyPrice: 0, highlight: false,
    tagline: 'For small teams getting started.',
    cta: 'Start free', ctaPath: '/register',
    features: [
      { label: 'Projects', value: '1' },
      { label: 'Captures / month', value: '100' },
      { label: 'Virtual tours', value: '10' },
      { label: 'Team members', value: '3' },
      { label: 'Storage', value: '10 GB' },
      { label: 'Floor plan mapping', value: true },
      { label: 'Review workflows', value: true },
      { label: 'Defect tracking', value: false },
      { label: 'Analytics dashboard', value: false },
      { label: 'API access', value: false },
      { label: 'Custom branding', value: false },
      { label: 'Priority support', value: false },
    ],
  },
  {
    name: 'Professional', monthlyPrice: 49, yearlyPrice: 39, highlight: true,
    tagline: 'For growing construction teams.',
    cta: 'Register', ctaPath: '/register',
    badge: 'Most Popular',
    features: [
      { label: 'Projects', value: '10' },
      { label: 'Captures / month', value: '2,000' },
      { label: 'Virtual tours', value: 'Unlimited' },
      { label: 'Team members', value: '15' },
      { label: 'Storage', value: '100 GB' },
      { label: 'Floor plan mapping', value: true },
      { label: 'Review workflows', value: true },
      { label: 'Defect tracking', value: true },
      { label: 'Analytics dashboard', value: true },
      { label: 'API access', value: true },
      { label: 'Custom branding', value: false },
      { label: 'Priority support', value: false },
    ],
  },
  {
    name: 'Enterprise', monthlyPrice: null, yearlyPrice: null, highlight: false,
    tagline: 'For large firms with complex needs.',
    cta: 'Contact sales', ctaPath: '/contact',
    features: [
      { label: 'Projects', value: 'Unlimited' },
      { label: 'Captures / month', value: 'Unlimited' },
      { label: 'Virtual tours', value: 'Unlimited' },
      { label: 'Team members', value: 'Unlimited' },
      { label: 'Storage', value: 'Custom' },
      { label: 'Floor plan mapping', value: true },
      { label: 'Review workflows', value: true },
      { label: 'Defect tracking', value: true },
      { label: 'Analytics dashboard', value: true },
      { label: 'API access', value: true },
      { label: 'Custom branding', value: true },
      { label: 'Priority support', value: true },
    ],
  },
];

const COMPARISON_ROWS = [
  'Projects', 'Captures / month', 'Virtual tours', 'Team members', 'Storage',
  'Floor plan mapping', 'Review workflows', 'Defect tracking', 'Analytics dashboard',
  'API access', 'Custom branding', 'Priority support',
];

function FeatureValue({ value }: { value: string | boolean }) {
  if (value === true) return <CheckRounded sx={{ fontSize: 18, color: colors.success }} />;
  if (value === false) return <CloseRounded sx={{ fontSize: 18, color: colors.textSubdued }} />;
  return <Typography sx={{ fontSize: '0.875rem', color: colors.textStrong, fontWeight: 500 }}>{value}</Typography>;
}

export default function PricingPage() {
  const [annual, setAnnual] = useState(false);

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: colors.bg }}>
      <Navbar />
      <Box sx={{ pt: `${NAV_H + 64}px`, pb: 12, px: { xs: 3, md: 6 }, maxWidth: 1200, mx: 'auto' }}>
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: { xs: 6, md: 10 } }}>
          <Pill>Pricing</Pill>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2.25rem', md: '3.25rem' }, fontWeight: 800, letterSpacing: '-0.05em', color: colors.textStrong, mt: 2, mb: 1.5 }}>
            Simple, transparent pricing
          </Typography>
          <Typography sx={{ fontSize: '1.0625rem', color: colors.textMuted, maxWidth: 480, mx: 'auto', lineHeight: 1.7, mb: 4 }}>
            No hidden fees. No per-seat surprises. Start free and upgrade when you're ready.
          </Typography>

          {/* Toggle */}
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5, p: 0.5, borderRadius: '12px', backgroundColor: colors.bgDeep, border: `1px solid ${colors.border}` }}>
            {['Monthly', 'Annual'].map((label, i) => (
              <Box key={label} onClick={() => setAnnual(i === 1)} sx={{ px: 2, py: 0.875, borderRadius: '10px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', transition: `all ${motion.durationFast}`, backgroundColor: (i === 1) === annual ? colors.card : 'transparent', color: (i === 1) === annual ? colors.textStrong : colors.textMuted, boxShadow: (i === 1) === annual ? shadows.sm : 'none' }}>
                {label}{i === 1 && <Box component="span" sx={{ ml: 0.75, px: 0.75, py: 0.25, borderRadius: '4px', backgroundColor: 'rgba(22,163,74,0.12)', color: colors.success, fontSize: '0.6875rem', fontWeight: 700 }}>-20%</Box>}
              </Box>
            ))}
          </Box>
        </Box>

        {/* Pricing cards */}
        <Grid container spacing={3} sx={{ mb: 8, alignItems: 'stretch' }}>
          {PLANS.map(plan => (
            <Grid key={plan.name} size={{ xs: 12, md: 4 }}>
              <Box sx={{ p: 3, borderRadius: '20px', border: plan.highlight ? `2px solid ${colors.primary}` : `1px solid ${colors.border}`, backgroundColor: plan.highlight ? colors.card : colors.card, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', boxShadow: plan.highlight ? shadows.lg : 'none' }}>
                {plan.badge && (
                  <Box sx={{ position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)', px: 1.5, py: 0.375, borderRadius: '0 0 8px 8px', background: colors.primaryGradient, fontSize: '0.6875rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <StarRounded sx={{ fontSize: 11 }} /> {plan.badge}
                  </Box>
                )}

                <Typography sx={{ fontSize: '1.125rem', fontWeight: 700, color: colors.textStrong, mb: 0.5 }}>{plan.name}</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 3 }}>{plan.tagline}</Typography>

                <Box sx={{ mb: 3 }}>
                  {plan.monthlyPrice === null ? (
                    <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1 }}>Custom</Typography>
                  ) : plan.monthlyPrice === 0 ? (
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                      <Typography sx={{ fontSize: '2.5rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1 }}>Free</Typography>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                      <Typography sx={{ fontSize: '0.9375rem', fontWeight: 500, color: colors.textMuted }}>₹</Typography>
                      <Typography sx={{ fontSize: '2.5rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1 }}>{annual ? plan.yearlyPrice : plan.monthlyPrice}</Typography>
                      <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>/ mo</Typography>
                    </Box>
                  )}
                  {annual && plan.monthlyPrice !== null && plan.monthlyPrice > 0 && (
                    <Typography sx={{ fontSize: '0.8125rem', color: colors.success, mt: 0.5 }}>Billed annually · saves ₹{(plan.monthlyPrice - (plan.yearlyPrice ?? 0)) * 12}/yr</Typography>
                  )}
                </Box>

                <Box component={Link} to={plan.ctaPath} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 1.375, borderRadius: '10px', mb: 3, background: plan.highlight ? colors.primaryGradient : 'transparent', border: plan.highlight ? 'none' : `1.5px solid ${colors.border}`, color: plan.highlight ? '#fff' : colors.textStrong, fontWeight: 600, fontSize: '0.9375rem', textDecoration: 'none', boxShadow: plan.highlight ? shadows.btn : 'none', '&:hover': plan.highlight ? { opacity: 0.9 } : { borderColor: colors.primary, color: colors.primary }, transition: `all ${motion.durationFast}` }}>
                  {plan.cta} {plan.highlight && <ArrowForwardRounded sx={{ fontSize: 16 }} />}
                </Box>

                <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', flex: 1 }}>
                  {plan.features.map(f => (
                    <Box key={f.label} component="li" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.875, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
                      <Typography sx={{ fontSize: '0.875rem', color: colors.textSecondary }}>{f.label}</Typography>
                      <FeatureValue value={f.value} />
                    </Box>
                  ))}
                </Box>
              </Box>
            </Grid>
          ))}
        </Grid>

        {/* Comparison table */}
        <Box sx={{ mb: 8 }}>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, letterSpacing: '-0.04em', color: colors.textStrong, mb: 4, textAlign: 'center' }}>Full comparison</Typography>
          <Box sx={{ borderRadius: '16px', border: `1px solid ${colors.border}`, overflow: 'hidden', backgroundColor: colors.card }}>
            {/* Header row */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', borderBottom: `1px solid ${colors.border}`, backgroundColor: colors.bgDeep }}>
              <Box sx={{ p: 2 }} />
              {PLANS.map(p => (
                <Box key={p.name} sx={{ p: 2, textAlign: 'center', borderLeft: `1px solid ${colors.border}` }}>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: p.highlight ? colors.primary : colors.textStrong }}>{p.name}</Typography>
                </Box>
              ))}
            </Box>
            {COMPARISON_ROWS.map((row, i) => (
              <Box key={row} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', borderBottom: i < COMPARISON_ROWS.length - 1 ? `1px solid ${colors.borderLight}` : 'none', '&:hover': { backgroundColor: colors.bgDeep } }}>
                <Box sx={{ p: 1.75, display: 'flex', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: '0.875rem', color: colors.textSecondary }}>{row}</Typography>
                </Box>
                {PLANS.map(p => {
                  const feat = p.features.find(f => f.label === row);
                  return (
                    <Box key={p.name} sx={{ p: 1.75, borderLeft: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <FeatureValue value={feat?.value ?? false} />
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Box>

        {/* FAQ */}
        <Box sx={{ maxWidth: 680, mx: 'auto', textAlign: 'center' }}>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.04em', color: colors.textStrong, mb: 1.5 }}>Questions about pricing?</Typography>
          <Typography sx={{ fontSize: '1rem', color: colors.textMuted, mb: 3 }}>We're happy to talk through your team's specific needs.</Typography>
          <Box component={Link} to="/contact" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 3, py: 1.5, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontWeight: 700, fontSize: '1rem', textDecoration: 'none', boxShadow: shadows.btn }}>
            Contact our team <ArrowForwardRounded sx={{ fontSize: 16 }} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
