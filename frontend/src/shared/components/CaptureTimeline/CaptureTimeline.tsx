import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { CameraAltRounded, CheckCircleRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig, type CaptureSnapshot } from '@/data/mockData';

interface CaptureTimelineProps {
  series: CaptureSnapshot[];
  activeId: string;
  onSelect: (snapshot: CaptureSnapshot) => void;
  compareIds?: [string | null, string | null];
  /** When true, nodes show A/B select affordance with a highlight ring on hover */
  compareMode?: boolean;
}

function splitDateTime(label: string): { date: string; time: string } {
  const s = (label || '').trim();
  if (!s) return { date: '—', time: '' };
  // "12 Aug 2026, 10:30 am" or ISO-ish with T / space
  const comma = s.indexOf(',');
  if (comma > 0) {
    return { date: s.slice(0, comma).trim(), time: s.slice(comma + 1).trim() };
  }
  const tIdx = s.search(/\s\d{1,2}:\d{2}/);
  if (tIdx > 0) {
    return { date: s.slice(0, tIdx).trim(), time: s.slice(tIdx).trim() };
  }
  return { date: s, time: '' };
}

export default function CaptureTimeline({ series: rawSeries, activeId, onSelect, compareIds, compareMode }: CaptureTimelineProps) {
  const seen = new Set<string>();
  const series = rawSeries.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)));

  if (!series.length) return null;

  if (series.length === 1) {
    const only = series[0];
    const { date, time } = splitDateTime(only.dateLabel || only.date || '');
    return (
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.25,
          borderRadius: '14px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
        }}
      >
        <Box
          sx={{
            width: 40, height: 40, borderRadius: '12px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#16a34a', boxShadow: '0 2px 10px rgba(22,163,74,0.28)',
          }}
        >
          <CheckCircleRounded sx={{ fontSize: 20, color: '#fff' }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.625, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: '#15803d', lineHeight: 1.2 }}>
              Latest capture
            </Typography>
            <Box sx={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: '#86efac', flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: '#4ade80' }}>
              Only visit so far
            </Typography>
          </Box>
          <Typography noWrap sx={{ fontSize: '0.8125rem', color: colors.textStrong, fontWeight: 700, lineHeight: 1.35, mt: 0.125 }}>
            {date}{time ? ` · ${time}` : ''}
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative', width: '100%' }}>
      <Box sx={{
        position: 'absolute',
        top: 24,
        left: 28,
        right: 28,
        height: 2,
        borderRadius: '2px',
        backgroundColor: colors.borderLight,
        zIndex: 0,
      }} />

      <Box sx={{
        display: 'flex',
        gap: 1.25,
        position: 'relative',
        zIndex: 1,
        overflowX: 'auto',
        scrollbarWidth: 'thin',
        px: 0.5,
        pt: 0.5,
        pb: 0.375,
        maskImage: 'linear-gradient(90deg, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)',
      }}>
        {series.map((snap, i) => {
          const isActive = snap.id === activeId;
          const sc = statusConfig.reviewStatus[snap.reviewStatus];
          const compareSlot = compareIds
            ? (compareIds[0] === snap.id ? 'A' : compareIds[1] === snap.id ? 'B' : null)
            : null;
          const isInCompare = !!compareSlot;
          const nodeColor = isActive
            ? colors.primary
            : isInCompare
              ? (compareSlot === 'A' ? '#7c3aed' : '#d97706')
              : sc.color;
          const { date, time } = splitDateTime(snap.dateLabel || snap.date || `Visit ${i + 1}`);

          return (
            <Tooltip
              key={snap.id}
              title={
                <Box sx={{ textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>
                    {date}{time ? ` · ${time}` : ''}
                  </Typography>
                  {snap.isLatest && <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.7)' }}>Latest capture</Typography>}
                  {compareMode && !isInCompare && <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.7)' }}>Click to assign</Typography>}
                </Box>
              }
              placement="top"
              arrow
            >
              <Box
                onClick={() => onSelect(snap)}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 0.625,
                  cursor: 'pointer',
                  minWidth: 92,
                  flex: '0 0 auto',
                  px: 0.5,
                  transition: `transform ${motion.durationFast} ${motion.easeOut}`,
                  '&:hover': { transform: 'translateY(-1px)' },
                  '&:hover .tl-node': {
                    transform: 'scale(1.08)',
                    borderColor: compareMode ? '#7c3aed' : colors.primary,
                    boxShadow: compareMode
                      ? '0 0 0 4px rgba(124,58,237,0.15), 0 4px 10px rgba(15,23,42,0.16)'
                      : `0 0 0 4px ${colors.primaryRing}, 0 4px 10px rgba(15,23,42,0.16)`,
                  },
                }}
              >
                <Box
                  className="tl-node"
                  sx={{
                    position: 'relative',
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: isActive || isInCompare ? nodeColor : snap.gradient,
                    border: `2.5px solid ${isActive || isInCompare ? nodeColor : '#fff'}`,
                    boxShadow: isActive
                      ? `0 0 0 4px ${colors.primaryRing}, 0 2px 8px rgba(15,23,42,0.12)`
                      : isInCompare
                        ? `0 0 0 4px ${compareSlot === 'A' ? 'rgba(124,58,237,0.2)' : 'rgba(217,119,6,0.2)'}, 0 2px 8px rgba(15,23,42,0.10)`
                        : '0 1px 4px rgba(15,23,42,0.10)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: `all ${motion.durationNormal} ${motion.easeOut}`,
                  }}
                >
                  {isInCompare ? (
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
                      {compareSlot}
                    </Typography>
                  ) : snap.isLatest ? (
                    <CheckCircleRounded sx={{ fontSize: 17, color: '#fff' }} />
                  ) : (
                    <CameraAltRounded sx={{ fontSize: 15, color: 'rgba(255,255,255,0.85)' }} />
                  )}
                  {snap.isLatest && !isInCompare && (
                    <Box sx={{
                      position: 'absolute', top: -3, right: -3,
                      width: 10, height: 10, borderRadius: '50%',
                      backgroundColor: '#16a34a', border: '2px solid #fff',
                    }} />
                  )}
                </Box>

                <Box sx={{ textAlign: 'center', minWidth: 0, maxWidth: 96 }}>
                  <Typography sx={{
                    fontSize: '0.6875rem',
                    fontWeight: isActive || isInCompare ? 700 : 600,
                    color: isActive
                      ? colors.primary
                      : isInCompare
                        ? (compareSlot === 'A' ? '#7c3aed' : '#d97706')
                        : colors.textStrong,
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {date}
                  </Typography>
                  {time ? (
                    <Typography sx={{
                      fontSize: '0.625rem',
                      fontWeight: 500,
                      color: colors.textMuted,
                      lineHeight: 1.25,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      mt: 0.15,
                    }}>
                      {time}
                    </Typography>
                  ) : null}
                  {snap.isLatest ? (
                    <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: '#16a34a', mt: 0.15, letterSpacing: '0.02em' }}>
                      LATEST
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}
