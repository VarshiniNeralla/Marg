import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { TimelineRounded } from '@mui/icons-material';
import { colors, shadows } from '@theme/tokens';
import { constructionProgressService, type TimelinePoint } from '@/services/constructionProgressService';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

const CHART_W = 640;
const CHART_H = 160;
const PAD_X = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 24;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function ProgressTimelineChart({ floorId }: { floorId: string }) {
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<TimelinePoint[]>([]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    constructionProgressService.getTimeline(floorId)
      .then(result => { if (!cancelled) setPoints(result); })
      .catch(() => { if (!cancelled) setPoints([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [floorId]);

  const { linePath, areaPath, coords } = useMemo(() => {
    if (points.length === 0) return { linePath: '', areaPath: '', coords: [] as { x: number; y: number }[] };
    const innerW = CHART_W - PAD_X * 2;
    const innerH = CHART_H - PAD_TOP - PAD_BOTTOM;
    const n = points.length;
    const xs = points.map((_, i) => PAD_X + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1)));
    const ys = points.map(p => PAD_TOP + innerH * (1 - Math.max(0, Math.min(100, p.overallProgressPct)) / 100));
    const c = xs.map((x, i) => ({ x, y: ys[i] }));
    const line = c.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const area = `${line} L ${c[c.length - 1].x} ${PAD_TOP + innerH} L ${c[0].x} ${PAD_TOP + innerH} Z`;
    return { linePath: line, areaPath: area, coords: c };
  }, [points]);

  if (loading) {
    return (
      <Box sx={{ p: 3, borderRadius: '14px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={20} sx={{ color: colors.primary }} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, borderRadius: '14px', backgroundColor: P.white, border: `1.5px solid ${P.border}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <TimelineRounded sx={{ fontSize: 18, color: P.muted }} />
        <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }}>
          Progress Trend
        </Typography>
      </Box>

      {points.length < 2 ? (
        <Typography sx={{ fontSize: '0.8125rem', color: P.muted, py: 2 }}>
          {points.length === 0
            ? 'No history yet — this is the first analysis for this floor.'
            : 'Only one analysis so far — re-analyze this floor over time to see a trend.'}
        </Typography>
      ) : (
        <Box sx={{ position: 'relative', width: '100%', maxWidth: CHART_W }}>
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" height={CHART_H} style={{ display: 'block' }}>
            {[0, 25, 50, 75, 100].map(v => {
              const y = PAD_TOP + (CHART_H - PAD_TOP - PAD_BOTTOM) * (1 - v / 100);
              return (
                <line key={v} x1={PAD_X} x2={CHART_W - PAD_X} y1={y} y2={y}
                  stroke={colors.borderLight} strokeWidth={1} />
              );
            })}
            <path d={areaPath} fill={colors.primary} opacity={0.1} />
            <path d={linePath} fill="none" stroke={colors.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {coords.map((c, i) => (
              <circle
                key={i}
                cx={c.x} cy={c.y} r={hoverIdx === i ? 6 : 5}
                fill={colors.primary} stroke="#fff" strokeWidth={2}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            ))}
          </svg>

          {hoverIdx != null && coords[hoverIdx] && (
            <Box
              sx={{
                position: 'absolute',
                left: `${(coords[hoverIdx].x / CHART_W) * 100}%`,
                top: coords[hoverIdx].y - 44,
                transform: 'translateX(-50%)',
                px: 1.25, py: 0.75, borderRadius: '8px',
                backgroundColor: colors.inkSurface, color: '#fff',
                fontSize: '0.75rem', whiteSpace: 'nowrap', pointerEvents: 'none',
                boxShadow: shadows.dropdown,
              }}
            >
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>
                {Math.round(points[hoverIdx].overallProgressPct)}%
              </Typography>
              <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.7)' }}>
                {formatDate(points[hoverIdx].snapshotDate)}
              </Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
            <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>{formatDate(points[0].snapshotDate)}</Typography>
            {points.length > 1 && (
              <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>
                {formatDate(points[points.length - 1].snapshotDate)}
              </Typography>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
