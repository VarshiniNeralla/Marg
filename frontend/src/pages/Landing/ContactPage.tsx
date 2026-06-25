import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid } from '@mui/material';
import {
  EmailRounded, PhoneRounded, LocationOnRounded, ArrowForwardRounded, CheckCircleRounded,
  AccessTimeRounded, CalendarMonthRounded, SupportAgentRounded,
} from '@mui/icons-material';
import { colors, shadows, motion } from '@theme/tokens';

const NAV_H = 64;

// Shared input style — matches auth pages
const fieldSx = {
  width: '100%',
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px',
    fontSize: '0.9375rem',
    fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
    backgroundColor: '#fff',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#d1d5db' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: '1.5px' },
    '&.Mui-focused': { boxShadow: `0 0 0 3px ${colors.primaryRing}` },
  },
  '& .MuiInputBase-input': {
    fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
    '&::placeholder': { color: '#9ca3af', opacity: 1 },
  },
  '& .MuiInputLabel-root': { display: 'none' },
};

const labelSx = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#374151',
  fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
  mb: '6px',
};

function StyledInput({ id, type = 'text', placeholder, value, onChange, multiline, rows }: {
  id: string; type?: string; placeholder: string; value: string;
  onChange: (v: string) => void; multiline?: boolean; rows?: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Box
      component={multiline ? 'textarea' : 'input'}
      id={id}
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value)}
      rows={rows}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      sx={{
        width: '100%',
        boxSizing: 'border-box',
        px: 1.75,
        py: multiline ? 1.5 : 0,
        height: multiline ? 'auto' : '48px',
        borderRadius: '10px',
        border: `1.5px solid ${focused ? colors.primary : '#e5e7eb'}`,
        outline: focused ? `3px solid ${colors.primaryRing}` : 'none',
        outlineOffset: '0px',
        fontSize: '0.9375rem',
        fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
        color: colors.textStrong,
        backgroundColor: '#fff',
        resize: multiline ? 'vertical' : 'none',
        transition: `border-color ${motion.durationFast}, box-shadow ${motion.durationFast}`,
        '&::placeholder': { color: '#9ca3af' },
        '&:hover': { borderColor: focused ? colors.primary : '#d1d5db' },
        display: 'block',
      }}
    />
  );
}

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
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>Prāṅgaṇ</Typography>
          <Typography sx={{ fontSize: '0.625rem', fontWeight: 500, color: colors.textSubdued, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1 }}>by SiteSureLabs</Typography>
        </Box>
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.5, mr: 4 }}>
        {[['Features', '/features'], ['Pricing', '/pricing'], ['Contact', '/contact']].map(([l, p]) => (
          <Box key={l} component={Link} to={p} sx={{ px: 1.5, py: 0.875, borderRadius: '8px', fontSize: '0.9375rem', fontWeight: 500, color: l === 'Contact' ? colors.primary : colors.textSecondary, textDecoration: 'none', '&:hover': { color: colors.textStrong, backgroundColor: 'rgba(15,23,42,0.04)' }, transition: `all ${motion.durationFast}` }}>{l}</Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box component={Link} to="/login" sx={{ px: 2, py: 0.875, borderRadius: '8px', fontSize: '0.9375rem', fontWeight: 500, color: colors.textSecondary, textDecoration: 'none', '&:hover': { color: colors.textStrong } }}>Sign in</Box>
        <Box component={Link} to="/register" sx={{ px: 2.5, py: 1, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontWeight: 600, fontSize: '0.9375rem', textDecoration: 'none', boxShadow: shadows.btn }}>Register</Box>
      </Box>
    </Box>
  );
}

const CONTACT_REASONS = ['Product demo', 'Enterprise pricing', 'Technical support', 'Partnership', 'General question'];

const OFFICES = [
  { city: 'Hyderabad', address: 'Plot 42, Hi-Tech City, Madhapur, Hyderabad — 500081', phone: '+91 40 6789 0123' },
  { city: 'Mumbai', address: 'WeWork BKC, G Block, Bandra Kurla Complex, Mumbai — 400051', phone: '+91 22 6789 0124' },
];

const RESPONSE_STATS = [
  { icon: <AccessTimeRounded sx={{ fontSize: 18 }} />, label: 'Avg. response', value: '< 4 hrs' },
  { icon: <CalendarMonthRounded sx={{ fontSize: 18 }} />, label: 'Demo available', value: 'Same week' },
  { icon: <SupportAgentRounded sx={{ fontSize: 18 }} />, label: 'Support hours', value: 'Mon–Sat 9–7 IST' },
];

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', company: '', phone: '', reason: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleChange(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => { setLoading(false); setSubmitted(true); }, 1200);
  }

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: colors.bg }}>
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <Box sx={{ pt: `${NAV_H + 56}px`, pb: 8, px: { xs: 3, md: 6 }, maxWidth: 1100, mx: 'auto', textAlign: 'center' }}>
        <Pill>Contact Us</Pill>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '2.25rem', md: '3.25rem' }, fontWeight: 800, letterSpacing: '-0.05em', color: colors.textStrong, mt: 2, mb: 1.25, lineHeight: 1.1 }}>
          Talk to the team
        </Typography>
        <Typography sx={{ fontSize: '1.0625rem', color: colors.textMuted, maxWidth: 460, mx: 'auto', lineHeight: 1.7 }}>
          Whether you want a demo, have a pricing question, or need help — we're fast to respond.
        </Typography>

        {/* Response stats row */}
        <Box sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: { xs: 1.5, md: 3 }, mt: 5 }}>
          {RESPONSE_STATS.map(s => (
            <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2.5, py: 1.5, borderRadius: '14px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, boxShadow: shadows.sm, minWidth: 180 }}>
              <Box sx={{ width: 36, height: 36, borderRadius: '9px', backgroundColor: colors.primarySoft, color: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {s.icon}
              </Box>
              <Box sx={{ textAlign: 'left' }}>
                <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.07em', lineHeight: 1 }}>{s.label}</Typography>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, lineHeight: 1.4 }}>{s.value}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── Two-column layout ─────────────────────────────────────────────── */}
      <Box sx={{ pb: 12, px: { xs: 3, md: 6 }, maxWidth: 1100, mx: 'auto' }}>
        <Grid container spacing={4} sx={{ alignItems: 'flex-start' }}>

          {/* LEFT — form */}
          <Grid size={{ xs: 12, md: 7 }}>
            {submitted ? (
              <Box sx={{ p: { xs: 4, md: 5 }, borderRadius: '20px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, textAlign: 'center', boxShadow: shadows.md }}>
                <Box sx={{ width: 72, height: 72, borderRadius: '50%', backgroundColor: 'rgba(22,163,74,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2.5 }}>
                  <CheckCircleRounded sx={{ fontSize: 36, color: colors.success }} />
                </Box>
                <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.03em', mb: 1 }}>Message sent</Typography>
                <Typography sx={{ fontSize: '1rem', color: colors.textMuted, mb: 4, maxWidth: 340, mx: 'auto', lineHeight: 1.7 }}>
                  Our team will get back to you within 4 business hours.
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Box onClick={() => setSubmitted(false)} sx={{ px: 2.5, py: 1.125, borderRadius: '10px', border: `1.5px solid ${colors.border}`, color: colors.textStrong, fontWeight: 600, fontSize: '0.9375rem', cursor: 'pointer', '&:hover': { borderColor: colors.primary, color: colors.primary }, transition: `all ${motion.durationFast}` }}>Send another</Box>
                  <Box component={Link} to="/register" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2.5, py: 1.125, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontWeight: 600, fontSize: '0.9375rem', textDecoration: 'none', boxShadow: shadows.btn }}>
                    Register <ArrowForwardRounded sx={{ fontSize: 16 }} />
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box component="form" onSubmit={handleSubmit} sx={{ p: { xs: 3, md: 4 }, borderRadius: '20px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, boxShadow: shadows.sm }}>
                {/* Form header */}
                <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.25rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em', mb: 0.5 }}>Send us a message</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 3.5 }}>Fill in the form and we'll get back to you shortly.</Typography>

                {/* Name + Email row */}
                <Grid container spacing={2} sx={{ mb: 0 }}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Box sx={{ mb: 2.5 }}>
                      <Box component="label" htmlFor="c-name" sx={labelSx}>Full name <Box component="span" sx={{ color: colors.danger }}>*</Box></Box>
                      <StyledInput id="c-name" placeholder="Rajesh Nair" value={form.name} onChange={v => handleChange('name', v)} />
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Box sx={{ mb: 2.5 }}>
                      <Box component="label" htmlFor="c-email" sx={labelSx}>Work email <Box component="span" sx={{ color: colors.danger }}>*</Box></Box>
                      <StyledInput id="c-email" type="email" placeholder="rajesh@company.com" value={form.email} onChange={v => handleChange('email', v)} />
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Box sx={{ mb: 2.5 }}>
                      <Box component="label" htmlFor="c-company" sx={labelSx}>Company</Box>
                      <StyledInput id="c-company" placeholder="My Home Constructions" value={form.company} onChange={v => handleChange('company', v)} />
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Box sx={{ mb: 2.5 }}>
                      <Box component="label" htmlFor="c-phone" sx={labelSx}>Phone</Box>
                      <StyledInput id="c-phone" placeholder="+91 98765 43210" value={form.phone} onChange={v => handleChange('phone', v)} />
                    </Box>
                  </Grid>
                </Grid>

                {/* Reason chips */}
                <Box sx={{ mb: 2.5 }}>
                  <Typography sx={{ ...labelSx, mb: 1 }}>Reason for contacting</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {CONTACT_REASONS.map(r => (
                      <Box key={r} onClick={() => handleChange('reason', form.reason === r ? '' : r)} sx={{ px: 1.75, py: 0.625, borderRadius: '8px', border: `1.5px solid ${form.reason === r ? colors.primary : '#e5e7eb'}`, backgroundColor: form.reason === r ? colors.primarySoft : '#fff', color: form.reason === r ? colors.primary : colors.textTertiary, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', transition: `all ${motion.durationFast}`, '&:hover': { borderColor: colors.primary, color: colors.primary } }}>
                        {r}
                      </Box>
                    ))}
                  </Box>
                </Box>

                {/* Message */}
                <Box sx={{ mb: 3.5 }}>
                  <Box component="label" htmlFor="c-message" sx={labelSx}>Message <Box component="span" sx={{ color: colors.danger }}>*</Box></Box>
                  <StyledInput id="c-message" placeholder="Tell us about your project, team size, and what you'd like to achieve…" value={form.message} onChange={v => handleChange('message', v)} multiline rows={5} />
                </Box>

                {/* Submit */}
                <Box component="button" type="submit" disabled={loading} sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, width: '100%',
                  height: '52px', borderRadius: '12px',
                  background: colors.primaryGradient, color: '#fff',
                  fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
                  fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em',
                  border: 'none', cursor: 'pointer',
                  boxShadow: shadows.btn, opacity: loading ? 0.7 : 1,
                  transition: `all ${motion.durationFast}`,
                  '&:hover:not(:disabled)': { transform: 'translateY(-1px)', boxShadow: '0 6px 20px rgba(37,99,235,0.38)' },
                  '&:active:not(:disabled)': { transform: 'translateY(0)' },
                }}>
                  {loading ? 'Sending…' : (<>Send message <ArrowForwardRounded sx={{ fontSize: 16 }} /></>)}
                </Box>
              </Box>
            )}
          </Grid>

          {/* RIGHT — sidebar */}
          <Grid size={{ xs: 12, md: 5 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

              {/* Direct contact */}
              <Box sx={{ p: 3, borderRadius: '20px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, boxShadow: shadows.sm }}>
                <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em', mb: 2.5 }}>Reach us directly</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                  {[
                    { icon: <EmailRounded sx={{ fontSize: 16 }} />, label: 'Email', value: 'hello@sitesurelabs.com', href: 'mailto:hello@sitesurelabs.com', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
                    { icon: <PhoneRounded sx={{ fontSize: 16 }} />, label: 'Phone', value: '+91 40 6789 0123', href: 'tel:+914067890123', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
                  ].map(({ icon, label, value, href, color, bg }) => (
                    <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 36, height: 36, borderRadius: '9px', backgroundColor: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {icon}
                      </Box>
                      <Box>
                        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.07em', lineHeight: 1 }}>{label}</Typography>
                        <Box component="a" href={href} sx={{ fontSize: '0.9375rem', fontWeight: 500, color: colors.textStrong, textDecoration: 'none', '&:hover': { color: colors.primary }, transition: `color ${motion.durationFast}` }}>{value}</Box>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Offices */}
              <Box sx={{ p: 3, borderRadius: '20px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, boxShadow: shadows.sm }}>
                <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em', mb: 2.5 }}>Our offices</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {OFFICES.map((office, i) => (
                    <Box key={office.city} sx={{ pb: i < OFFICES.length - 1 ? 2 : 0, mb: i < OFFICES.length - 1 ? 2 : 0, borderBottom: i < OFFICES.length - 1 ? `1px solid ${colors.borderLight}` : 'none' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.625 }}>
                        <LocationOnRounded sx={{ fontSize: 14, color: colors.primary }} />
                        <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong }}>{office.city}</Typography>
                      </Box>
                      <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, lineHeight: 1.6, mb: 0.25 }}>{office.address}</Typography>
                      <Typography sx={{ fontSize: '0.8125rem', color: colors.textTertiary }}>{office.phone}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Demo CTA */}
              <Box sx={{ p: 3, borderRadius: '20px', background: `linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)`, position: 'relative', overflow: 'hidden', boxShadow: shadows.md }}>
                <Box sx={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)', backgroundSize: '24px 24px' }} />
                <Box sx={{ position: 'absolute', top: '-30%', right: '-10%', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(37,99,235,0.25) 0%, transparent 70%)', filter: 'blur(20px)' }} />
                <Box sx={{ position: 'relative', zIndex: 1 }}>
                  <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', mb: 0.625 }}>See Prāṅgaṇ live</Typography>
                  <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)', mb: 2.5, lineHeight: 1.65 }}>30-minute tailored demo with your use case — book a slot this week.</Typography>
                  <Box component={Link} to="/register" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.875, px: 2, py: 0.875, borderRadius: '8px', backgroundColor: '#fff', color: colors.primary, fontWeight: 700, fontSize: '0.875rem', textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(255,255,255,0.92)' }, transition: `background-color ${motion.durationFast}` }}>
                    Book a demo <ArrowForwardRounded sx={{ fontSize: 14 }} />
                  </Box>
                </Box>
              </Box>

            </Box>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}
