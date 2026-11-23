import React from 'react';
import { Box, Typography } from '@mui/material';
import { colors } from '@theme/tokens';
import type {
  ProjectActivityRow, ProjectFloorRow, ProjectOverviewTotals, ProjectTowerRow,
} from '@/services/constructionProgressService';
import { activityDisplayName } from '@/utils/activityNames';

// Plain CSS and SVG charts. The repo has no chart library, so none is added.
const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', track: '#eef1f5' };

export const STATUS_COLOR = {
  completed: colors.success,
  in_progress: colors.warning,
  not_started: colors.danger,
  no_photos: '#9ca3af',
} as const;

export function pctColor(pct: number | null | undefined): string {
  if (pct == null) return '#9ca3af';
  if (pct >= 75) return colors.success;
  if (pct >= 40) return colors.warning;
  return colors.danger;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function ChartCard({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <Box data-testid={testId} sx={{ p: 2, borderRadius: '14px', border: `1.5px solid ${P.border}`, backgroundColor: '#fff', minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong, mb: 1.5 }}>{title}</Typography>
      {children}
    </Box>
  );
}

/** A thin progress bar with a number. */
export function Bar({ pct, color, label }: { pct: number | null | undefined; color?: string; label?: string }) {
  const v = pct == null ? 0 : clamp(pct);
  return (
    <Box
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)}
      aria-label={label ?? 'Progress'}
      sx={{ height: 8, borderRadius: 4, backgroundColor: P.track, overflow: 'hidden', width: '100%' }}
    >
      <Box sx={{ width: `${v}%`, height: '100%', backgroundColor: color ?? pctColor(pct), borderRadius: 4 }} />
    </Box>
  );
}

function BarRow({ label, pct, sub }: { label: string; pct: number; sub?: string }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr) 44px', sm: '150px minmax(0,1fr) 44px' }, gap: { xs: 0.5, sm: 1.5 }, alignItems: 'center', mb: 1 }}>
      <Typography sx={{ fontSize: '0.8125rem', color: P.strong, gridColumn: { xs: '1', sm: 'auto' } }} noWrap title={label}>
        {label}{sub ? <Box component="span" sx={{ color: P.muted }}> {sub}</Box> : null}
      </Typography>
      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.strong, textAlign: 'right', gridColumn: { xs: '2', sm: '3' }, gridRow: { xs: '1', sm: 'auto' } }}>
        {`${Math.round(pct)}%`}
      </Typography>
      <Box sx={{ gridColumn: { xs: '1 / -1', sm: '2' }, gridRow: { xs: '2', sm: 'auto' } }}><Bar pct={pct} label={label} /></Box>
    </Box>
  );
}

export function TowerChart({ towers }: { towers: ProjectTowerRow[] }) {
  if (!towers.length) return <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>No towers yet.</Typography>;
  return <>{towers.map(t => <BarRow key={t.towerId} label={t.towerName} pct={t.progressPct} sub={`(${t.floors} floors)`} />)}</>;
}

export function ActivityChart({ activities }: { activities: ProjectActivityRow[] }) {
  if (!activities.length) return <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>No activity results yet.</Typography>;
  return <>{activities.map(a => <BarRow key={a.activityId} label={activityDisplayName(a.activityId, a.name)} pct={a.progressPct ?? 0} sub={a.progressPct == null ? '(not seen)' : `(${a.floorsObserved})`} />)}</>;
}

/** One stacked bar for the four statuses plus a legend with counts. */
export function StatusSplit({ totals }: { totals: ProjectOverviewTotals }) {
  const parts = [
    { id: 'completed', label: 'Completed', n: totals.completed },
    { id: 'in_progress', label: 'In progress', n: totals.inProgress },
    { id: 'not_started', label: 'Not started', n: totals.notStarted },
    { id: 'no_photos', label: 'No photos', n: totals.noPhotos },
  ] as const;
  const sum = parts.reduce((s, p) => s + p.n, 0);
  if (!sum) return <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>No floors yet.</Typography>;
  return (
    <>
      <Box sx={{ display: 'flex', height: 18, borderRadius: 9, overflow: 'hidden', backgroundColor: P.track }} role="img"
        aria-label={parts.map(p => `${p.label} ${p.n}`).join(', ')}>
        {parts.filter(p => p.n > 0).map(p => (
          <Box key={p.id} sx={{ width: `${(p.n / sum) * 100}%`, backgroundColor: STATUS_COLOR[p.id] }} />
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1.5 }}>
        {parts.map(p => (
          <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '3px', backgroundColor: STATUS_COLOR[p.id] }} />
            <Typography sx={{ fontSize: '0.8125rem', color: P.strong }}>{p.label}: <strong>{p.n}</strong></Typography>
          </Box>
        ))}
      </Box>
    </>
  );
}

/** Each floor is a dot: how much was photographed (across) against how much is done (up). */
export function CoverageScatter({ floors }: { floors: ProjectFloorRow[] }) {
  const pts = floors.filter(f => f.status !== 'no_photos' && f.status !== 'not_analysed' && typeof f.coveragePct === 'number' && typeof f.progressPct === 'number');
  if (!pts.length) return <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>No analysed floors yet.</Typography>;
  const W = 300, H = 220, L = 34, B = 28, T = 8, R = 8;
  const x = (v: number) => L + (clamp(v) / 100) * (W - L - R);
  const y = (v: number) => H - B - (clamp(v) / 100) * (H - B - T);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Coverage against progress for each floor" style={{ maxWidth: 420, display: 'block' }}>
      {[0, 25, 50, 75, 100].map(g => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke={P.border} />
          <text x={L - 6} y={y(g) + 3} fontSize="9" textAnchor="end" fill={P.muted}>{g}</text>
          <text x={x(g)} y={H - B + 12} fontSize="9" textAnchor="middle" fill={P.muted}>{g}</text>
        </g>
      ))}
      <text x={(L + W - R) / 2} y={H - 4} fontSize="10" textAnchor="middle" fill={P.muted}>Coverage %</text>
      <text x={10} y={(H - B + T) / 2} fontSize="10" textAnchor="middle" fill={P.muted} transform={`rotate(-90 10 ${(H - B + T) / 2})`}>Progress %</text>
      {pts.map(f => (
        <circle key={f.floorId} cx={x(f.coveragePct as number)} cy={y(f.progressPct as number)} r={5}
          fill={STATUS_COLOR[(f.status in STATUS_COLOR ? f.status : 'in_progress') as keyof typeof STATUS_COLOR]} fillOpacity={0.8}>
          <title>{`${f.towerName} ${f.floorName}: progress ${Math.round(f.progressPct as number)}%, coverage ${Math.round(f.coveragePct as number)}%`}</title>
        </circle>
      ))}
    </svg>
  );
}
