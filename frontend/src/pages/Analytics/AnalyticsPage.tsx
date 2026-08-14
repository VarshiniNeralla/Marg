import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid, MenuItem, Select, type SelectChangeEvent } from '@mui/material';
import {
  RateReviewRounded, MapRounded, ArrowBackRounded,
  CameraAltRounded, ViewInArRounded, PlaceRounded, InsightsRounded,
  FolderRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, getRoleLandingPath } from '@store/authStore';
import {
  constructionProgressService,
  type FloorSummary,
} from '@/services/constructionProgressService';

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
  const width = 100;
  const padX = 4;
  const padTop = 10;
  const padBottom = 20;
  const plotH = height - padTop - padBottom;
  const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const safeMax = Math.max(maxValue, 1);

  const points = data.map((d, i) => ({
    x: padX + step * i,
    y: padTop + plotH - (Math.max(0, d.value) / safeMax) * plotH,
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
        {hovered !== null && points[hovered] && (
          <line
            x1={points[hovered].x} x2={points[hovered].x}
            y1={padTop} y2={padTop + plotH}
            stroke={accent} strokeOpacity={0.25} strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </Box>

      {hovered !== null && points[hovered] && (
        <Box
          sx={{
            position: 'absolute',
            left: `${(points[hovered].x / width) * 100}%`,
            top: points[hovered].y,
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: accent, border: `1.5px solid ${colors.card}`,
            boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }}
        />
      )}

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
                visibility: hovered === i || i % 2 === 0 ? 'visible' : 'hidden',
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

function Card({ title, subtitle, right, children }: {
  title?: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Box sx={{
      p: 3, borderRadius: '18px', backgroundColor: colors.card,
      border: `1px solid ${colors.borderLight}`, height: '100%',
      display: 'flex', flexDirection: 'column', overflow: 'visible',
    }}>
      {(title || right) && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2.5, gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            {title && (
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em' }}>
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mt: 0.25 }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {right}
        </Box>
      )}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>{children}</Box>
    </Box>
  );
}

function StatTile({
  icon, label, value, sub, color, bg, to,
}: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string;
  color: string; bg: string; to?: string;
}) {
  return (
    <Box
      {...(to ? { component: Link, to } : {})}
      sx={{
        borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`,
        p: 2, overflow: 'hidden', position: 'relative', textDecoration: 'none',
        display: 'flex', flexDirection: { xs: 'row' }, alignItems: 'center', gap: 1.75,
        '@media (min-width: 480px)': { flexDirection: 'column', alignItems: 'flex-start', gap: 1.25, p: 2.25 },
        transition: 'box-shadow 150ms, transform 150ms',
        ...(to ? { cursor: 'pointer', '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.07)', transform: 'translateY(-1px)' } } : {
          '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.07)', transform: 'translateY(-1px)' },
        }),
      }}
    >
      <Box sx={{
        display: 'none', position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        borderRadius: '16px 16px 0 0', backgroundColor: color, opacity: 0.7,
        '@media (min-width: 480px)': { display: 'block' },
      }} />
      <Box sx={{
        width: 36, height: 36, borderRadius: '10px', backgroundColor: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0,
        '& svg': { fontSize: 18 },
      }}>
        {icon}
      </Box>
      <Box sx={{
        flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between', gap: 0, minWidth: 0,
        '@media (min-width: 480px)': {
          flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 0.375, width: '100%',
        },
      }}>
        <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textMuted }}>{label}</Typography>
        <Box sx={{ textAlign: 'right', '@media (min-width: 480px)': { textAlign: 'left' } }}>
          <Typography sx={{
            fontSize: '1.25rem', '@media (min-width: 480px)': { fontSize: '1.5rem' },
            fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.03em', lineHeight: 1,
          }}>
            {value}
          </Typography>
          {sub && <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.375 }}>{sub}</Typography>}
        </Box>
      </Box>
    </Box>
  );
}

function buildWeekBuckets(count = 8) {
  const weeks: Array<{
    label: string;
    start: Date;
    end: Date;
  }> = [];
  const now = new Date();
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setHours(0, 0, 0, 0);
  startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay());

  for (let i = count - 1; i >= 0; i -= 1) {
    const start = new Date(startOfThisWeek);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    weeks.push({
      label: `${start.toLocaleString('default', { month: 'short' })} ${start.getDate()}`,
      start,
      end,
    });
  }
  return weeks;
}

function parseCaptureDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function HorizontalBar({
  label, valueLabel, pct, color, to,
}: {
  label: string; valueLabel: string; pct: number; color: string; to?: string;
}) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <Box
      {...(to ? { component: Link, to } : {})}
      sx={{
        py: 1.25, textDecoration: 'none', display: 'block',
        borderBottom: `1px solid ${colors.borderLight}`,
        '&:last-child': { borderBottom: 'none' },
        ...(to ? { '&:hover .bar-label': { color: colors.primary } } : {}),
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
        <Typography className="bar-label" noWrap sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textMuted, flexShrink: 0 }}>
          {valueLabel}
        </Typography>
      </Box>
      <Box sx={{ height: 8, borderRadius: '999px', backgroundColor: colors.bg, overflow: 'hidden' }}>
        <Box sx={{
          width: `${width}%`, height: '100%', borderRadius: '999px',
          backgroundColor: color, transition: 'width 280ms ease',
        }} />
      </Box>
    </Box>
  );
}

export default function AnalyticsPage() {
  const user = useAuthStore(s => s.user);
  const overviewPath = getRoleLandingPath(user?.role);

  const projects = useWorkflowStore(s => s.projects);
  const towers = useWorkflowStore(s => s.towers);
  const floors = useWorkflowStore(s => s.floors);
  const tours = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const captures = useWorkflowStore(s => s.captures);
  const pins = useWorkflowStore(s => s.capturePins);

  const [projectId, setProjectId] = useState('all');
  const [progressFloors, setProgressFloors] = useState<FloorSummary[]>([]);
  const [progressLoading, setProgressLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setProgressLoading(true);
    constructionProgressService.listFloors()
      .then(list => { if (!cancelled) setProgressFloors(list); })
      .catch(() => { if (!cancelled) setProgressFloors([]); })
      .finally(() => { if (!cancelled) setProgressLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const activeProjects = useMemo(
    () => projects.filter(p => !p.archived && p.status === 'active'),
    [projects],
  );

  const scoped = useMemo(() => {
    const matchProject = (id?: string | null) =>
      !projectId || projectId === 'all' || id === projectId;

    const scopedProjects = projectId === 'all'
      ? projects.filter(p => !p.archived)
      : projects.filter(p => p.id === projectId);
    const projectIds = new Set(scopedProjects.map(p => p.id));
    const scopedTowers = towers.filter(t => projectIds.has(t.projectId));
    const towerIds = new Set(scopedTowers.map(t => t.id));
    const scopedFloors = floors.filter(f => towerIds.has(f.towerId));
    const floorIds = new Set(scopedFloors.map(f => f.id));
    const scopedPlans = floorPlans.filter(fp =>
      matchProject(fp.projectId) || floorIds.has(fp.floorId),
    );
    const scopedCaptures = captures.filter(c => matchProject(c.projectId));
    const scopedTours = tours.filter(t => matchProject(t.projectId));
    const scopedPins = pins.filter(p =>
      matchProject(p.projectId) || floorIds.has(p.floorId),
    );
    const scopedProgress = progressFloors.filter(f => matchProject(f.projectId));

    return {
      projects: scopedProjects,
      floors: scopedFloors,
      floorPlans: scopedPlans,
      captures: scopedCaptures,
      tours: scopedTours,
      pins: scopedPins,
      progress: scopedProgress,
    };
  }, [projectId, projects, towers, floors, floorPlans, captures, tours, pins, progressFloors]);

  const insights = useMemo(() => {
    const pendingCaptures = scoped.captures.filter(c => c.status === 'review').length;
    const publishedTours = scoped.tours.filter(t => t.status === 'published');
    const tourSignOffBacklog = publishedTours.filter(t => !t.managerReviewed).length;
    const pinsWithCapture = scoped.pins.filter(p => (p.captureIds?.length ?? 0) > 0).length;
    const pinCoverage = scoped.pins.length > 0
      ? Math.round((pinsWithCapture / scoped.pins.length) * 100)
      : 0;
    const floorsMapped = new Set(scoped.floorPlans.map(fp => fp.floorId)).size;
    const floorPlanCoverage = scoped.floors.length > 0
      ? Math.round((floorsMapped / scoped.floors.length) * 100)
      : 0;
    const analyzed = scoped.progress.filter(f => f.analyzed);
    const avgProgress = analyzed.length
      ? Math.round(
        analyzed.reduce((sum, f) => sum + (f.overallProgressPct ?? 0), 0) / analyzed.length,
      )
      : 0;

    return {
      pendingCaptures,
      publishedTours: publishedTours.length,
      tourSignOffBacklog,
      pinsTotal: scoped.pins.length,
      pinsWithCapture,
      pinCoverage,
      floorsMapped,
      floorsTotal: scoped.floors.length,
      floorPlanCoverage,
      analyzedFloors: analyzed.length,
      progressFloorsTotal: scoped.progress.length,
      avgProgress,
      captureTotal: scoped.captures.length,
    };
  }, [scoped]);

  const captureTrend = useMemo(() => {
    const weeks = buildWeekBuckets(8);
    const counts = weeks.map(() => 0);
    for (const c of scoped.captures) {
      const d = parseCaptureDate(c.capturedAt || c.uploadedAt);
      if (!d) continue;
      const idx = weeks.findIndex(w => d >= w.start && d < w.end);
      if (idx >= 0) counts[idx] += 1;
    }
    return weeks.map((w, i) => ({
      label: w.label,
      value: counts[i],
      displayValue: String(counts[i]),
    }));
  }, [scoped.captures]);

  const tourTrend = useMemo(() => {
    const weeks = buildWeekBuckets(8);
    const published = weeks.map(() => 0);
    for (const t of scoped.tours.filter(x => x.status === 'published')) {
      const capture = scoped.captures.find(c => c.id === t.captureId);
      const d = parseCaptureDate(capture?.capturedAt || t.lastCapture) ?? new Date();
      const idx = weeks.findIndex(w => d >= w.start && d < w.end);
      if (idx >= 0) published[idx] += 1;
    }
    return weeks.map((w, i) => ({
      label: w.label,
      value: published[i],
      displayValue: String(published[i]),
    }));
  }, [scoped.tours, scoped.captures]);

  const projectCoverage = useMemo(() => {
    const rows = scoped.projects.map(p => {
      const pCaptures = scoped.captures.filter(c => c.projectId === p.id).length;
      const pTours = scoped.tours.filter(t => t.projectId === p.id && t.status === 'published').length;
      const pPins = scoped.pins.filter(pin => pin.projectId === p.id);
      const capturedPins = pPins.filter(pin => (pin.captureIds?.length ?? 0) > 0).length;
      const pFloors = floors.filter(f => towers.some(t => t.id === f.towerId && t.projectId === p.id));
      const mapped = new Set(
        floorPlans.filter(fp => fp.projectId === p.id).map(fp => fp.floorId),
      ).size;
      const pinPct = pPins.length ? Math.round((capturedPins / pPins.length) * 100) : 0;
      const mapPct = pFloors.length ? Math.round((mapped / pFloors.length) * 100) : 0;
      const score = Math.round((pinPct * 0.55) + (mapPct * 0.45));
      return {
        id: p.id,
        name: p.name,
        captures: pCaptures,
        tours: pTours,
        pins: pPins.length,
        capturedPins,
        pinPct,
        mapped,
        floors: pFloors.length,
        mapPct,
        score,
      };
    }).sort((a, b) => b.score - a.score || b.captures - a.captures);
    return rows;
  }, [scoped, floors, towers, floorPlans]);

  const progressLeaders = useMemo(() => {
    return [...scoped.progress]
      .filter(f => f.analyzed && f.overallProgressPct != null)
      .sort((a, b) => (b.overallProgressPct ?? 0) - (a.overallProgressPct ?? 0))
      .slice(0, 6);
  }, [scoped.progress]);

  const [captureHover, setCaptureHover] = useState<ChartPoint | null>(null);
  const [tourHover, setTourHover] = useState<ChartPoint | null>(null);
  const maxCapture = Math.max(...captureTrend.map(d => d.value), 1);
  const maxTour = Math.max(...tourTrend.map(d => d.value), 1);

  const KPIs = [
    {
      key: 'pending',
      icon: <RateReviewRounded />,
      label: 'Captures to Review',
      value: insights.pendingCaptures,
      sub: 'awaiting manager review',
      color: '#d97706',
      bg: 'rgba(217,119,6,0.08)',
      to: '/captures',
    },
    {
      key: 'tours',
      icon: <ViewInArRounded />,
      label: 'Published Tours',
      value: insights.publishedTours,
      sub: insights.tourSignOffBacklog > 0
        ? `${insights.tourSignOffBacklog} awaiting sign-off`
        : 'all signed off',
      color: '#2563eb',
      bg: 'rgba(37,99,235,0.08)',
      to: '/tours',
    },
    {
      key: 'pins',
      icon: <PlaceRounded />,
      label: 'Capture Points Done',
      value: `${insights.pinCoverage}%`,
      sub: `${insights.pinsWithCapture} of ${insights.pinsTotal} points captured`,
      color: '#16a34a',
      bg: 'rgba(22,163,74,0.08)',
      to: '/floor-plans',
    },
    {
      key: 'plans',
      icon: <MapRounded />,
      label: 'Floors Mapped',
      value: `${insights.floorPlanCoverage}%`,
      sub: `${insights.floorsMapped} of ${insights.floorsTotal} floors have plans`,
      color: '#7c3aed',
      bg: 'rgba(124,58,237,0.08)',
      to: '/floor-plans',
    },
    {
      key: 'projects',
      icon: <FolderRounded />,
      label: 'Active Projects',
      value: projectId === 'all' ? activeProjects.length : 1,
      sub: `${insights.captureTotal} captures in view`,
      color: '#0891b2',
      bg: 'rgba(8,145,178,0.08)',
      to: '/projects',
    },
    {
      key: 'progress',
      icon: <InsightsRounded />,
      label: 'Site Progress',
      value: progressLoading ? '…' : `${insights.avgProgress}%`,
      sub: progressLoading
        ? 'loading floors…'
        : `${insights.analyzedFloors} floors analyzed`,
      color: '#c2410c',
      bg: 'rgba(194,65,12,0.08)',
      to: '/construction-progress',
    },
  ];

  return (
    <Box sx={{
      maxWidth: 1080, mx: 'auto', p: 1,
      animation: `fadeIn ${motion.durationNormal} ${motion.easeOut}`,
      '@keyframes fadeIn': {
        from: { opacity: 0, transform: 'translateY(10px)' },
        to: { opacity: 1, transform: 'translateY(0)' },
      },
    }}>
      <Box sx={{ mb: { xs: 3.5, md: 4 } }}>
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
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end',
          justifyContent: 'space-between', gap: 2,
        }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{
              fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
              fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
              color: colors.textStrong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
            }}>
              Dashboard Analytics
            </Typography>
            <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
              Live site insights — reviews, capture coverage, tours, and floor finishing progress.
            </Typography>
          </Box>
          <Select
            size="small"
            value={projectId}
            onChange={(e: SelectChangeEvent) => setProjectId(e.target.value)}
            sx={{
              minWidth: 180, borderRadius: '10px', backgroundColor: colors.card,
              fontSize: '0.8125rem', fontWeight: 600,
            }}
          >
            <MenuItem value="all">All projects</MenuItem>
            {projects.filter(p => !p.archived).map(p => (
              <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
            ))}
          </Select>
        </Box>
      </Box>

      <Box sx={{
        display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: { xs: 1.25, md: 1.5 }, mb: 3,
        '@media (min-width: 480px)': { gridTemplateColumns: 'repeat(2, 1fr)' },
        '@media (min-width: 900px)': { gridTemplateColumns: 'repeat(3, 1fr)' },
      }}>
        {KPIs.map(({ key, ...k }) => <StatTile key={key} {...k} />)}
      </Box>

      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card
            title="Capture Volume"
            subtitle={captureHover ? captureHover.label : 'Last 8 weeks of site photos'}
            right={
              <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: '#16a34a', letterSpacing: '-0.03em' }}>
                {captureHover ? captureHover.displayValue : insights.captureTotal}
                {!captureHover && (
                  <Typography component="span" sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textMuted, ml: 0.5 }}>
                    Total
                  </Typography>
                )}
              </Typography>
            }
          >
            <TrendLineChart
              data={captureTrend}
              maxValue={maxCapture}
              height={168}
              accent="#16a34a"
              onHoverChange={setCaptureHover}
            />
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card
            title="Tours Published"
            subtitle={tourHover ? tourHover.label : 'Walkthroughs go-live trend'}
            right={
              <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: colors.primary, letterSpacing: '-0.03em' }}>
                {tourHover ? tourHover.displayValue : insights.publishedTours}
              </Typography>
            }
          >
            <TrendLineChart
              data={tourTrend}
              maxValue={maxTour}
              height={168}
              accent={colors.primary}
              onHoverChange={setTourHover}
            />
          </Card>
        </Grid>
      </Grid>

      <Box sx={{ mb: 2.5 }}>
        <Card
          title="Project Coverage"
          subtitle="How thoroughly each project is mapped and captured"
          right={
            <Box component={Link} to="/projects" sx={{
              fontSize: '0.75rem', fontWeight: 700, color: colors.primary, textDecoration: 'none',
              '&:hover': { textDecoration: 'underline' },
            }}>
              View projects
            </Box>
          }
        >
          {projectCoverage.length === 0 ? (
            <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, py: 3, textAlign: 'center' }}>
              No projects in this view yet.
            </Typography>
          ) : (
            <Box>
              {projectCoverage.slice(0, 8).map(row => (
                <HorizontalBar
                  key={row.id}
                  label={row.name}
                  valueLabel={`${row.score}% · ${row.captures} captures · ${row.tours} tours`}
                  pct={row.score}
                  color="#2563eb"
                  to={`/projects/${row.id}`}
                />
              ))}
            </Box>
          )}
        </Card>
      </Box>

      <Card
        title="Construction Progress"
        subtitle={progressLoading
          ? 'Loading floor finishing analysis…'
          : `${insights.analyzedFloors} analyzed floors · average ${insights.avgProgress}% complete`}
        right={
          <Box component={Link} to="/construction-progress" sx={{
            fontSize: '0.75rem', fontWeight: 700, color: colors.primary, textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' },
          }}>
            Open progress
          </Box>
        }
      >
        {progressLoading ? (
          <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, py: 2 }}>Loading…</Typography>
        ) : progressLeaders.length === 0 ? (
          <Box sx={{ py: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, mb: 0.5 }}>
              No floors analyzed yet
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>
              Run AI progress analysis on a floor to see finishing completion here.
            </Typography>
          </Box>
        ) : (
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: { xs: 0, sm: 3 },
          }}>
            {progressLeaders.map(floor => (
              <HorizontalBar
                key={floor.floorId}
                label={`${floor.projectName} · ${floor.towerName} · ${floor.floorName}`}
                valueLabel={`${Math.round(floor.overallProgressPct ?? 0)}%`}
                pct={floor.overallProgressPct ?? 0}
                color={
                  (floor.overallProgressPct ?? 0) >= 80 ? '#16a34a'
                    : (floor.overallProgressPct ?? 0) >= 40 ? '#d97706'
                      : '#2563eb'
                }
                to={`/construction-progress/${floor.floorId}`}
              />
            ))}
          </Box>
        )}
      </Card>

      <Box sx={{
        mt: 2.5, display: 'flex', flexWrap: 'wrap', gap: 1.25,
      }}>
        {[
          { label: 'Review captures', to: '/captures', icon: <CameraAltRounded sx={{ fontSize: 15 }} /> },
          { label: 'Publish tours', to: '/tours', icon: <ViewInArRounded sx={{ fontSize: 15 }} /> },
          { label: 'Floor plans', to: '/floor-plans', icon: <MapRounded sx={{ fontSize: 15 }} /> },
          { label: 'Construction progress', to: '/construction-progress', icon: <InsightsRounded sx={{ fontSize: 15 }} /> },
        ].map(link => (
          <Box
            key={link.to}
            component={Link}
            to={link.to}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.75,
              px: 1.5, py: 0.875, borderRadius: '10px',
              border: `1.5px solid ${colors.borderLight}`, backgroundColor: colors.card,
              color: colors.textStrong, fontSize: '0.8125rem', fontWeight: 600,
              textDecoration: 'none',
              '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
            }}
          >
            {link.icon} {link.label}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
