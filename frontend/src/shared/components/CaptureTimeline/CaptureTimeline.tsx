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

export default function CaptureTimeline({ series: rawSeries, activeId, onSelect, compareIds, compareMode }: CaptureTimelineProps) {
  // Defensive: never render duplicate capture nodes. The timeline is one node per
  // distinct capture id — if the upstream array ever contains a repeated id (e.g.
  // a double-fired append), collapse it so the rail count always matches the real
  // capture history.
  const seen = new Set<string>();
  const series = rawSeries.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)));

  if (!series.length) return null;

  // Single capture → no scrubber, just a compact "Latest" badge.
  if (series.length === 1) {
    const only = series[0];
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.25, borderRadius: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
        <Box sx={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 8px rgba(22,163,74,0.3)' }}>
          <CheckCircleRounded sx={{ fontSize: 18, color: '#fff' }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#15803d', lineHeight: 1.2 }}>Latest capture</Typography>
          <Typography noWrap sx={{ fontSize: '0.6875rem', color: colors.textMuted, lineHeight: 1.3 }}>
            {only.dateLabel || 'Just captured'}
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative' }}>
      {/* Rail line — top offset accounts for the 6px pt on the nodes row */}
      <Box sx={{
        position: 'absolute',
        top: 24,
        left: 20,
        right: 20,
        height: 2,
        borderRadius: '2px',
        backgroundColor: colors.borderLight,
        zIndex: 0,
      }} />

      {/* Nodes — pt:0.75 gives the hover ring + scale transform room to breathe */}
      <Box sx={{
        display: 'flex',
        justifyContent: series.length === 1 ? 'center' : 'space-between',
        position: 'relative',
        zIndex: 1,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        pt: 0.75,
        pb: 0.5,
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

          return (
            <Tooltip
              key={snap.id}
              title={
                <Box sx={{ textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>{snap.dateLabel || `Visit ${i + 1}`}</Typography>
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
                  gap: 0.5,
                  cursor: 'pointer',
                  minWidth: 44,
                  flex: series.length > 1 ? 1 : undefined,
                  '&:hover .tl-node': {
                    transform: 'scale(1.12)',
                    borderColor: compareMode ? '#7c3aed' : colors.primary,
                    boxShadow: compareMode
                      ? '0 0 0 4px rgba(124,58,237,0.15), 0 2px 8px rgba(15,23,42,0.14)'
                      : `0 0 0 4px ${colors.primaryRing}, 0 2px 8px rgba(15,23,42,0.14)`,
                  },
                }}
              >
                {/* Node */}
                <Box
                  className="tl-node"
                  sx={{
                    position: 'relative',
                    width: 36,
                    height: 36,
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
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
                      {compareSlot}
                    </Typography>
                  ) : snap.isLatest ? (
                    <CheckCircleRounded sx={{ fontSize: 15, color: '#fff' }} />
                  ) : (
                    <CameraAltRounded sx={{ fontSize: 14, color: 'rgba(255,255,255,0.85)' }} />
                  )}

                  {/* Latest pulse dot (only when not in compare slot) */}
                  {snap.isLatest && !isInCompare && (
                    <Box sx={{
                      position: 'absolute',
                      top: -3,
                      right: -3,
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      backgroundColor: '#16a34a',
                      border: '2px solid #fff',
                    }} />
                  )}
                </Box>

                {/* Index label — always shown, compact */}
                <Typography sx={{
                  fontSize: '0.625rem',
                  fontWeight: isActive || isInCompare ? 700 : 500,
                  color: isActive
                    ? colors.primary
                    : isInCompare
                    ? (compareSlot === 'A' ? '#7c3aed' : '#d97706')
                    : colors.textSubdued,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  transition: `color ${motion.durationFast}`,
                }}>
                  {snap.isLatest ? 'Latest' : `#${i + 1}`}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}
