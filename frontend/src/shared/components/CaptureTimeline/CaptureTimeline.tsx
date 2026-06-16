import React from 'react';
import { Box, Typography } from '@mui/material';
import { CameraAltRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig, type CaptureSnapshot } from '@/data/mockData';

interface CaptureTimelineProps {
  series: CaptureSnapshot[];
  activeId: string;
  onSelect: (snapshot: CaptureSnapshot) => void;
  /** When set, marks two snapshots as the A/B comparison selection. */
  compareIds?: [string | null, string | null];
}

// Horizontal dated scrubber. Each node is a capture snapshot of the SAME room
// over time (May 01 → May 15 → Jun 01 …). Clicking switches the active capture.
export default function CaptureTimeline({ series, activeId, onSelect, compareIds }: CaptureTimelineProps) {
  if (!series.length) return null;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          Capture Timeline
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>
          {series.length} captures · {series[0].dateLabel} → {series[series.length - 1].dateLabel}
        </Typography>
      </Box>

      <Box sx={{ position: 'relative', px: 1 }}>
        {/* The connecting rail */}
        <Box sx={{ position: 'absolute', top: 19, left: 16, right: 16, height: 2, backgroundColor: colors.borderLight, zIndex: 0 }} />

        <Box sx={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 1, overflowX: 'auto', gap: 1, pb: 0.5 }}>
          {series.map((snap) => {
            const isActive = snap.id === activeId;
            const sc = statusConfig.reviewStatus[snap.reviewStatus];
            const compareSlot = compareIds
              ? (compareIds[0] === snap.id ? 'A' : compareIds[1] === snap.id ? 'B' : null)
              : null;

            return (
              <Box
                key={snap.id}
                onClick={() => onSelect(snap)}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 0.875,
                  cursor: 'pointer',
                  minWidth: 64,
                  flex: 1,
                  '&:hover .tl-dot': { transform: 'scale(1.12)', borderColor: colors.primary },
                  '&:hover .tl-date': { color: colors.textStrong },
                }}
              >
                {/* Node dot */}
                <Box
                  className="tl-dot"
                  sx={{
                    position: 'relative',
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: snap.gradient,
                    border: `2.5px solid ${isActive ? colors.primary : compareSlot ? sc.color : '#fff'}`,
                    boxShadow: isActive
                      ? `0 0 0 4px ${colors.primaryRing}, 0 2px 8px rgba(15,23,42,0.12)`
                      : '0 2px 8px rgba(15,23,42,0.10)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: `all ${motion.durationNormal} ${motion.easeOut}`,
                  }}
                >
                  <CameraAltRounded sx={{ fontSize: 15, color: 'rgba(255,255,255,0.85)' }} />
                  {/* Compare A/B badge */}
                  {compareSlot && (
                    <Box sx={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', backgroundColor: sc.color, color: '#fff', fontSize: '0.5625rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #fff' }}>
                      {compareSlot}
                    </Box>
                  )}
                  {/* Latest pulse marker */}
                  {snap.isLatest && !compareSlot && (
                    <Box sx={{ position: 'absolute', top: -4, right: -4, width: 10, height: 10, borderRadius: '50%', backgroundColor: '#16a34a', border: '2px solid #fff' }} />
                  )}
                </Box>

                {/* Date */}
                <Typography className="tl-date" sx={{ fontSize: '0.75rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.textStrong : colors.textMuted, lineHeight: 1, transition: `color ${motion.durationFast}` }}>
                  {snap.dateLabel}
                </Typography>

                {/* Progress mini-bar */}
                <Box sx={{ width: 40, height: 3, borderRadius: '2px', backgroundColor: colors.borderLight, overflow: 'hidden' }}>
                  <Box sx={{ width: `${snap.progress}%`, height: '100%', backgroundColor: isActive ? colors.primary : sc.color, transition: `width ${motion.durationNormal}` }} />
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
