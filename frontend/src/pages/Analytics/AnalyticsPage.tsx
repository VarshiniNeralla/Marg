import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid } from '@mui/material';
import {
  RateReviewRounded, CheckCircleRounded, MapRounded, ArrowBackRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, getRoleLandingPath } from '@store/authStore';

// ── Interactive chart primitives ───────────────────────────────────────────────
interface ChartPoint {
  label: string;
  value: number;
  displayValue: string;
}

function TrendLineChart({
  data,
  maxValue,
  height = 168,
  accent,
  onHoverChange,
}: {
  data: ChartPoint[];
  maxValue: number;
  height?: number;
  accent: string;
  onHoverChange?: (point: ChartPoint | null) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const width = 100; // viewBox units — scales with container via preserveAspectRatio
  const padX = 4;
  const padTop = 10;
  const padBottom = 20;
  const plotH = height - padTop - padBottom;
  const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: padX + step * i,
    y: padTop + plotH - (Math.max(0, d.value) / maxValue) * plotH,
    d,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? 0} ${padTop + plotH} L ${points[0]?.x ?? 0} ${padTop + plotH} Z`;
  const gradientId = `trend-fill-${accent.replace('#', '')}`;

  function handleHover(i: number | null) {
    setHovered(i);
    onHoverChange?.(i !== null ? data[i] : null);
  }

  return (
    <Box sx={{ position: 'relative', height, overflow: 'visible' }}>
      {/* faint grid lines */}
      {[0.25, 0.5, 0.75, 1].map(pct => (
        <Box
          key={pct}
          sx={{
            position: 'absolute', left: 0, right: 0,
            bottom: padBottom + plotH * pct,
            height: '1px', backgroundColor: colors.borderLight, opacity: 0.55, pointerEvents: 'none',
          }}
        />
      ))}

      <Box
        component="svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        sx={{ width: '100%', height, display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          stroke={accent}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {hovered !== null && (
          <line
            x1={points[hovered].x} x2={points[hovered].x}
            y1={padTop} y2={padTop + plotH}
            stroke={accent} strokeOpacity={0.25} strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </Box>

      {/* hover dot — rendered in HTML/CSS (not SVG) so it stays perfectly round regardless of the chart's aspect ratio */}
      {hovered !== null && (
        <Box
          sx={{
            position: 'absolute',
            left: `${(points[hovered].x / width) * 100}%`,
            top: points[hovered].y,
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: accent,
            border: `1.5px solid ${colors.card}`,
            boxShadow: `0 1px 4px rgba(0,0,0,0.2)`,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* invisible hit targets + x-axis labels */}
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex' }}>
        {data.map((d, i) => (
          <Box
            key={d.label}
            onMouseEnter={() => handleHover(i)}
            onMouseLeave={() => handleHover(null)}
            onFocus={() => handleHover(i)}
            onBlur={() => handleHover(null)}
            tabIndex={0}
            role="img"
            aria-label={`${d.label}: ${d.displayValue}`}
            sx={{ flex: 1, minWidth: 0, position: 'relative', cursor: 'pointer', outline: 'none' }}
          >
            <Typography
              noWrap
              sx={{
                position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
                fontSize: { xs: '0.5rem', sm: '0.625rem' },
                fontWeight: hovered === i ? 700 : 500,
                color: hovered === i ? colors.textStrong : colors.textSubdued,
                whiteSpace: 'nowrap',
                visibility: hovered === i || i % 2 === 0 ? 'visible' : 'hidden',
                transition: `color ${motion.durationFast}`,
              }}
            >
              {d.label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ── Reusable surface ───────────────────────────────────────────────────────────
function Card({ title, subtitle, right, children }: { title?: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ p: 3, borderRadius: '18px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'visible' }}>
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

function StatTile({ icon, label, value, sub, color, bg }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; color: string; bg: string }) {
  // Mirrors the KPI grid's own 480px breakpoint (below MUI's 600px "sm") so
  // the tile switches from the phone row layout to the card column layout
  // in lockstep with the grid going 1-column -> 3-column, instead of a
  // mismatched window where 3 narrow tiles each still render the wide
  // icon-left/value-right phone layout.
  return (
    <Box sx={{
      borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`,
      p: 2, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: { xs: 'row' }, alignItems: 'center', gap: 1.75,
      '@media (min-width: 480px)': { flexDirection: 'column', alignItems: 'flex-start', gap: 1.25, p: 2.25 },
      transition: `box-shadow 150ms, transform 150ms`,
      '&:hover': { boxShadow: `0 4px 16px rgba(0,0,0,0.07)`, transform: 'translateY(-1px)' },
    }}>
      <Box sx={{
        display: 'none', position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        borderRadius: '16px 16px 0 0', backgroundColor: color, opacity: 0.7,
        '@media (min-width: 480px)': { display: 'block' },
      }} />
      <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0, '& svg': { fontSize: 18 } }}>{icon}</Box>
      <Box sx={{
        flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 0, minWidth: 0,
        '@media (min-width: 480px)': { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 0.375, width: '100%' },
      }}>
        <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textMuted }}>{label}</Typography>
        <Box sx={{ textAlign: 'right', '@media (min-width: 480px)': { textAlign: 'left' } }}>
          <Typography sx={{ fontSize: '1.25rem', '@media (min-width: 480px)': { fontSize: '1.5rem' }, fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</Typography>
          {sub && <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.375 }}>{sub}</Typography>}
        </Box>
      </Box>
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
  const chartData: ChartPoint[] = weeks.map(w => ({
    label: w.week,
    value: w.count,
    displayValue: String(w.count),
  }));
  const [hoverPoint, setHoverPoint] = useState<ChartPoint | null>(null);
  const accent = '#16a34a';

  return (
    <Card
      title="Capture Volume"
      subtitle={hoverPoint ? hoverPoint.label : '8-week trend across all projects'}
      right={
        <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: accent, letterSpacing: '-0.03em' }}>
          {hoverPoint ? hoverPoint.displayValue : total}
          {!hoverPoint && <Typography component="span" sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textMuted, ml: 0.5 }}>Total</Typography>}
        </Typography>
      }
    >
      <TrendLineChart
        data={chartData}
        maxValue={maxCount}
        height={168}
        accent={accent}
        onHoverChange={setHoverPoint}
      />
    </Card>
  );
}

function ReviewRateChart() {
  const tours = useWorkflowStore(s => s.tours);
  const captures = useWorkflowStore(s => s.captures);

  const weeks = Array.from({ length: 8 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (7 - i) * 7);
    return {
      week: `${d.toLocaleString('default', { month: 'short' })} W${Math.ceil(d.getDate() / 7)}`,
      total: 0,
      reviewed: 0,
      start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()),
      end: new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay() + 7),
    };
  });

  const resolveTourDate = (tour: (typeof tours)[number]) => {
    const capture = captures.find(c => c.id === tour.captureId);
    const raw = capture?.capturedAt || tour.lastCapture;
    const parsed = raw ? new Date(raw) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
  };

  tours
    .filter(t => t.status === 'published')
    .forEach(t => {
      const d = resolveTourDate(t);
      for (const w of weeks) {
        if (d >= w.start && d < w.end) {
          w.total++;
          if (t.managerReviewed) w.reviewed++;
          break;
        }
      }
    });

  const rates = weeks.map(w => (w.total > 0 ? Math.round((w.reviewed / w.total) * 100) : 0));
  const overallReviewed = weeks.reduce((acc, w) => acc + w.reviewed, 0);
  const overallTotal = weeks.reduce((acc, w) => acc + w.total, 0);
  const overallRate = overallTotal > 0 ? Math.round((overallReviewed / overallTotal) * 100) : 0;
  const chartData: ChartPoint[] = weeks.map((w, i) => ({
    label: w.week,
    value: rates[i],
    displayValue: `${rates[i]}%`,
  }));
  const [hoverPoint, setHoverPoint] = useState<ChartPoint | null>(null);

  return (
    <Card
      title="Review Rate"
      subtitle={hoverPoint ? hoverPoint.label : 'Walkthroughs marked as done'}
      right={
        <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: colors.primary, letterSpacing: '-0.03em' }}>
          {hoverPoint ? hoverPoint.displayValue : `${overallRate}%`}
        </Typography>
      }
    >
      <TrendLineChart
        data={chartData}
        maxValue={100}
        height={168}
        accent={colors.primary}
        onHoverChange={setHoverPoint}
      />
    </Card>
  );
}

export default function AnalyticsPage() {
  const floors     = useWorkflowStore(s => s.floors);
  const tours      = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const user = useAuthStore(s => s.user);
  const overviewPath = getRoleLandingPath(user?.role);

  const publishedTours = tours.filter(t => t.status === 'published');
  const reviewedCount  = publishedTours.filter(t => t.managerReviewed).length;
  const reviewBacklog  = publishedTours.filter(t => !t.managerReviewed).length;
  const underReview    = tours.filter(t => t.status === 'in_review').length;
  const completionRate = publishedTours.length > 0
    ? Math.round((reviewedCount / publishedTours.length) * 100)
    : 0;
  const floorCoverage  = floors.length > 0
    ? Math.round((floorPlans.length / floors.length) * 100)
    : 0;

  const KPIs = [
    {
      key: 'backlog',
      icon: <RateReviewRounded />,
      label: 'Review Backlog',
      value: reviewBacklog,
      sub: underReview > 0 ? `${underReview} in progress` : 'awaiting sign-off',
      color: '#d97706',
      bg: 'rgba(217,119,6,0.08)',
    },
    {
      key: 'completion',
      icon: <CheckCircleRounded />,
      label: 'Review Completion',
      value: `${completionRate}%`,
      sub: `${reviewedCount} of ${publishedTours.length} done`,
      color: '#059669',
      bg: 'rgba(5,150,105,0.08)',
    },
    {
      key: 'coverage',
      icon: <MapRounded />,
      label: 'Floor Coverage',
      value: `${floorCoverage}%`,
      sub: `${floorPlans.length} of ${floors.length} floors mapped`,
      color: '#7c3aed',
      bg: 'rgba(124,58,237,0.08)',
    },
  ];

  return (
    <Box sx={{ maxWidth: 1080, mx: 'auto', p: 1, animation: `fadeIn ${motion.durationNormal} ${motion.easeOut}`, '@keyframes fadeIn': { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } } }}>
      {/* Header */}
      <Box sx={{ mb: { xs: 3.5, md: 5 } }}>
        <Box component={Link} to={overviewPath} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
        </Box>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5 }}>Dashboard Analytics</Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Operational trends — review progress, capture volume, and site coverage.</Typography>
      </Box>

      {/* Management KPIs — the row layout kicks in at 480px (below MUI's
          600px "sm" breakpoint) so tablet-width viewports, including a
          narrower split-view or portrait window, get 3 columns instead of
          falling back to the stacked phone layout. */}
      <Box sx={{
        display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr' }, gap: { xs: 1.25, md: 1.5 }, mb: 4,
        '@media (min-width: 480px)': { gridTemplateColumns: 'repeat(3, 1fr)' },
      }}>
        {KPIs.map(({ key, ...k }) => <StatTile key={key} {...k} />)}
      </Box>

      {/* Charts Row */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <CaptureVolumeChart />
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <ReviewRateChart />
        </Grid>
      </Grid>
    </Box>
  );
}
