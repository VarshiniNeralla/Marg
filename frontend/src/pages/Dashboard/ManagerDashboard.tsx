import { Box, Typography, Grid } from '@mui/material';
import {
  RateReviewRounded, CheckCircleRounded, CameraAltRounded,
  ViewInArRounded, ArrowForwardRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import PageHeader from '@shared/components/PageHeader/PageHeader';

export default function ManagerDashboard() {
  const user      = useAuthStore((s) => s.user);
  const captures  = useWorkflowStore(s => s.captures);
  const tours     = useWorkflowStore(s => s.tours);

  const pendingReviews = captures.filter(c => c.status === 'review');
  const reviewed       = captures.filter(c => c.status === 'processed');
  const publishedTours = tours.filter(t => t.status === 'published');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const kpis = [
    {
      label: 'Pending Reviews',
      value: pendingReviews.length,
      sub: 'awaiting your action',
      color: '#d97706',
      bg: 'rgba(217,119,6,0.08)',
      icon: <RateReviewRounded />,
      to: '/reviews',
    },
    {
      label: 'Reviewed',
      value: reviewed.length,
      sub: 'captures processed',
      color: '#059669',
      bg: 'rgba(5,150,105,0.08)',
      icon: <CheckCircleRounded />,
      to: '/captures',
    },
    {
      label: 'Published Tours',
      value: publishedTours.length,
      sub: 'live for clients',
      color: '#2563eb',
      bg: 'rgba(37,99,235,0.08)',
      icon: <ViewInArRounded />,
      to: '/tours',
    },
    {
      label: 'Total Captures',
      value: captures.length,
      sub: 'across all projects',
      color: '#7c3aed',
      bg: 'rgba(124,58,237,0.08)',
      icon: <CameraAltRounded />,
      to: '/captures',
    },
  ];

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <PageHeader
        title={`${greeting}, ${user?.name?.split(' ')[0] ?? 'Manager'}`}
        subtitle="Review queue and project progress"
        breadcrumbs={[{ label: 'Overview' }]}
        actions={
          <Box
            component={Link}
            to="/reviews"
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.75,
              px: { xs: 1.5, sm: 2.5 }, py: { xs: 0.75, sm: 1 }, borderRadius: '10px',
              background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
              color: '#fff', fontSize: { xs: '0.75rem', sm: '0.875rem' }, fontWeight: 600,
              textDecoration: 'none', boxShadow: '0 4px 14px rgba(124,58,237,0.28)',
            }}
          >
            <RateReviewRounded sx={{ fontSize: 17 }} />
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Open Reviews</Box>
            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Reviews</Box>
          </Box>
        }
      />

      {/* KPI row */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {kpis.map((s) => (
          <Grid key={s.label} size={{ xs: 6, sm: 6, md: 3 }}>
            <Box
              component={Link}
              to={s.to}
              sx={{
                position: 'relative', overflow: 'hidden',
                p: { xs: 2, sm: 2.25 }, borderRadius: '16px',
                border: `1px solid ${colors.borderLight}`,
                backgroundColor: colors.card,
                textDecoration: 'none', display: 'block',
                transition: `box-shadow 150ms, transform 150ms`,
                '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' },
              }}
            >
              {/* top accent bar */}
              <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0', backgroundColor: s.color, opacity: 0.7 }} />
              <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: s.bg, color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1.5, '& svg': { fontSize: 18 } }}>
                {s.icon}
              </Box>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textMuted, mb: 0.375 }}>{s.label}</Typography>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, lineHeight: 1, letterSpacing: '-0.03em' }}>{s.value}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.375 }}>{s.sub}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        {/* Published Tours — full width, top priority */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ p: { xs: 2, sm: 3 }, borderRadius: '16px', border: `1px solid ${colors.border}`, backgroundColor: colors.card }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>
                Published Tours
              </Typography>
              <Box component={Link} to="/tours" sx={{ fontSize: '0.8125rem', color: colors.primary, textDecoration: 'none', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.5, '&:hover': { opacity: 0.75 } }}>
                All tours <ArrowForwardRounded sx={{ fontSize: 14 }} />
              </Box>
            </Box>

            {publishedTours.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <ViewInArRounded sx={{ fontSize: 36, color: colors.textSubdued, mb: 0.75 }} />
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>No published tours yet.</Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {publishedTours.map(t => (
                  <Box
                    key={t.id}
                    component={Link}
                    to={`/tours/${t.id}`}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      p: { xs: 1.25, sm: 1.5 }, borderRadius: '12px',
                      border: `1px solid ${colors.borderLight}`,
                      textDecoration: 'none', width: '100%',
                      '&:hover': { backgroundColor: colors.bg, borderColor: colors.border },
                      transition: `background ${motion.durationFast}, border-color ${motion.durationFast}`,
                    }}
                  >
                    <Box sx={{ width: 42, height: 42, borderRadius: '10px', background: t.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ViewInArRounded sx={{ fontSize: 18, color: 'rgba(255,255,255,0.85)' }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{t.roomName}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{t.towerName} · {t.floorLabel}</Typography>
                    </Box>
                    <Box sx={{ px: 1.25, py: 0.375, borderRadius: '6px', backgroundColor: 'rgba(37,99,235,0.08)', color: '#2563eb', fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0 }}>
                      Live
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Grid>

      </Grid>
    </Box>
  );
}
