import React from 'react';
import { Box, Typography, Grid } from '@mui/material';
import {
  CameraAltRounded, ViewInArRounded, CheckCircleRounded,
  AccessTimeRounded
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';

// ── Reusable surface ───────────────────────────────────────────────────────────
function Card({ title, subtitle, right, children }: { title?: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ p: 3, borderRadius: '18px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {(title || right) && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 4 }}>
          <Box>
            {title && <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em' }}>{title}</Typography>}
            {subtitle && <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mt: 0.25 }}>{subtitle}</Typography>}
          </Box>
          {right}
        </Box>
      )}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>{children}</Box>
    </Box>
  );
}

function StatTile({ icon, label, value, sub, color, bg }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub: string; color: string; bg: string }) {
  return (
    <Box sx={{ p: 2.5, borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, transition: `transform ${motion.durationFast} ${motion.easeOut}, box-shadow ${motion.durationFast}`, '&:hover': { transform: 'translateY(-2px)', boxShadow: `0 4px 12px rgba(0,0,0,0.05)` } }}>
      <Box sx={{ width: 38, height: 38, borderRadius: '10px', backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color, mb: 2, '& svg': { fontSize: 20 } }}>{icon}</Box>
      <Typography sx={{ fontSize: '1.875rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1, mb: 0.5 }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textSecondary }}>{label}</Typography>
      {sub && <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued, mt: 0.25 }}>{sub}</Typography>}
    </Box>
  );
}

function CaptureVolumeChart() {
  const captures = useWorkflowStore(s => s.captures);
  
  const weeks = Array.from({length: 8}, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (7 - i) * 7);
    return {
      week: `${d.toLocaleString('default', { month: 'short' })} W${Math.ceil(d.getDate() / 7)}`,
      count: 0,
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()),
      end: new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay() + 7)
    };
  });

  captures.forEach(c => {
    const d = new Date(c.capturedAt || (c as any).timestamp || Date.now());
    for (const w of weeks) {
      if (d >= w.start && d < w.end) {
        w.count++;
        break;
      }
    }
  });

  const maxCount = Math.max(...weeks.map(w => w.count), 1);
  const total = captures.length;

  return (
    <Card title="Capture Volume" subtitle="8-week trend across all projects" right={<Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: '#16a34a', letterSpacing: '-0.03em' }}>{total} Total</Typography>}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 160 }}>
        {weeks.map((w, i) => (
          <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.textSubdued }}>{w.count}</Typography>
            <Box sx={{ width: '100%', borderRadius: '6px 6px 0 0', height: `${(w.count / maxCount) * 110}px`, background: i === weeks.length - 1 ? colors.primaryGradient : 'rgba(37,99,235,0.16)', minHeight: 8, transition: `height ${motion.durationSlow} ${motion.easeOut}`, '&:hover': { filter: 'brightness(1.1)' } }} />
            <Typography sx={{ fontSize: '0.625rem', color: colors.textSubdued, textAlign: 'center' }}>{w.week}</Typography>
          </Box>
        ))}
      </Box>
    </Card>
  );
}

function ApprovalTrendChart() {
  const captures = useWorkflowStore(s => s.captures);

  const weeks = Array.from({length: 8}, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (7 - i) * 7);
    return {
      week: `${d.toLocaleString('default', { month: 'short' })} W${Math.ceil(d.getDate() / 7)}`,
      total: 0,
      approved: 0,
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()),
      end: new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay() + 7)
    };
  });

  captures.forEach(c => {
    if (c.status === 'processed' || c.status === 'rejected') {
      const d = new Date(c.capturedAt || (c as any).timestamp || Date.now());
      for (const w of weeks) {
        if (d >= w.start && d < w.end) {
          w.total++;
          if (c.status === 'processed') w.approved++;
          break;
        }
      }
    }
  });

  const rates = weeks.map(w => w.total > 0 ? Math.round((w.approved / w.total) * 100) : 0);
  const maxRev = 100;
  const overallApproved = weeks.reduce((acc, w) => acc + w.approved, 0);
  const overallTotal = weeks.reduce((acc, w) => acc + w.total, 0);
  const overallRate = overallTotal > 0 ? Math.round((overallApproved / overallTotal) * 100) : 0;

  return (
    <Card title="Review Approval Rate" subtitle="First-pass weekly trend" right={<Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: colors.primary, letterSpacing: '-0.03em' }}>{overallRate}%</Typography>}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 140 }}>
        {rates.map((v, i) => (
          <Box key={i} sx={{ flex: 1, height: `${(v / maxRev) * 118}px`, borderRadius: '4px 4px 0 0', backgroundColor: i === rates.length - 1 ? colors.primary : 'rgba(37,99,235,0.18)', minHeight: 6, transition: `height ${motion.durationSlow} ${motion.easeOut}`, '&:hover': { filter: 'brightness(1.1)' } }} />
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5 }}>
        <Typography sx={{ fontSize: '0.625rem', color: colors.textSubdued, fontWeight: 500 }}>{weeks[0].week}</Typography>
        <Typography sx={{ fontSize: '0.625rem', color: colors.textSubdued, fontWeight: 500 }}>{weeks[weeks.length-1].week}</Typography>
      </Box>
    </Card>
  );
}

export default function AnalyticsPage() {
  const captures = useWorkflowStore(s => s.captures);
  const tours = useWorkflowStore(s => s.tours);

  const totalCaptures = captures.length;
  const approved = captures.filter(c => c.status === 'processed').length;
  const pending  = captures.filter(c => c.status === 'review').length;
  const publishedTours = tours.filter(t => t.status === 'published').length;

  const KPIs = [
    { key: 'captures', icon: <CameraAltRounded />,  label: 'Total Captures',  value: totalCaptures, sub: '', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
    { key: 'pending',  icon: <AccessTimeRounded />,  label: 'Pending Review',  value: pending,        sub: '', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    { key: 'tours',    icon: <ViewInArRounded />,    label: 'Published Tours', value: publishedTours, sub: '', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  ];

  return (
    <Box sx={{ maxWidth: 1160, mx: 'auto', p: 1, animation: `fadeIn ${motion.durationNormal} ${motion.easeOut}`, '@keyframes fadeIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } } }}>
      {/* Header */}
      <Box sx={{ mb: 5 }}>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 1 }}>Dashboard Analytics</Typography>
        <Typography sx={{ fontSize: '1rem', color: colors.textMuted }}>Your construction intelligence and operational performance at a glance.</Typography>
      </Box>

      {/* KPI strip */}
      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        {KPIs.map(k => (
          <Grid key={k.key} size={{ xs: 12, sm: 4, md: 4 }}>
            <StatTile {...k} />
          </Grid>
        ))}
      </Grid>

      {/* Charts Row */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <CaptureVolumeChart />
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <ApprovalTrendChart />
        </Grid>
      </Grid>
    </Box>
  );
}
