import React from 'react';
import { Box, Typography } from '@mui/material';
import { HistoryRounded, CameraAltRounded, TrendingUpRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig, type RoomHistory } from '@/data/mockData';

interface RoomHistoryPanelProps {
  history: RoomHistory;
  /** Render without the outer card chrome (when already inside a panel). */
  bare?: boolean;
}

// 7E — Room History: capture count, latest capture, progress-over-time, and
// the review-status history for a single room.
export default function RoomHistoryPanel({ history, bare }: RoomHistoryPanelProps) {
  const { captureCount, latest, first, series, progressDelta, reviewHistory } = history;

  const body = (
    <Box>
      {/* Headline stats */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2.5 }}>
        {[
          { label: 'Captures', value: String(captureCount), icon: <CameraAltRounded sx={{ fontSize: 14 }} /> },
          { label: 'Latest', value: latest.dateLabel },
          { label: 'Progress', value: `+${progressDelta}%`, accent: colors.success, icon: <TrendingUpRounded sx={{ fontSize: 14 }} /> },
        ].map(s => (
          <Box key={s.label} sx={{ flex: 1, py: 1.25, px: 1, borderRadius: '12px', backgroundColor: colors.bgDeep, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '1.0625rem', fontWeight: 800, color: s.accent ?? colors.textStrong, letterSpacing: '-0.02em', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
              {s.icon && <Box sx={{ color: s.accent ?? colors.textMuted, display: 'flex' }}>{s.icon}</Box>}{s.value}
            </Typography>
            <Typography sx={{ fontSize: '0.625rem', color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.06em', mt: 0.5 }}>{s.label}</Typography>
          </Box>
        ))}
      </Box>

      {/* Progress-over-time sparkline (bars per snapshot) */}
      <Box sx={{ mb: 2.5 }}>
        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.06em', textTransform: 'uppercase', mb: 1 }}>Progress over time</Typography>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.625, height: 56 }}>
          {series.map((snap, i) => {
            const sc = statusConfig.reviewStatus[snap.reviewStatus];
            return (
              <Box key={snap.id} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Box
                  title={`${snap.dateLabel} · ${snap.progress}%`}
                  sx={{ width: '100%', height: `${Math.max(8, (snap.progress / 100) * 44)}px`, borderRadius: '4px 4px 2px 2px', background: i === series.length - 1 ? colors.primaryGradient : sc.color, opacity: i === series.length - 1 ? 1 : 0.55, transition: `height ${motion.durationNormal}` }}
                />
                <Typography sx={{ fontSize: '0.5625rem', color: colors.textSubdued, lineHeight: 1 }}>{snap.dateLabel.split(' ')[1]}</Typography>
              </Box>
            );
          })}
        </Box>
        <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 1 }}>
          {first.progress}% on {first.dateLabel} → {latest.progress}% on {latest.dateLabel}
        </Typography>
      </Box>

      {/* Review-status history */}
      <Box>
        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.06em', textTransform: 'uppercase', mb: 1.25 }}>Review status history</Typography>
        <Box sx={{ position: 'relative', pl: 1.5 }}>
          {/* vertical rail */}
          <Box sx={{ position: 'absolute', left: 4, top: 4, bottom: 4, width: 2, backgroundColor: colors.borderLight }} />
          {reviewHistory.map((rh, i) => {
            const sc = statusConfig.reviewStatus[rh.status];
            return (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: i < reviewHistory.length - 1 ? 1.25 : 0, position: 'relative' }}>
                <Box sx={{ position: 'absolute', left: -1.5, width: 9, height: 9, borderRadius: '50%', backgroundColor: sc.color, border: '2px solid #fff', boxShadow: `0 0 0 2px ${sc.bg}`, ml: '-2.5px' }} />
                <Box sx={{ pl: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: sc.color }}>{sc.label}</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{rh.dateLabel}</Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );

  if (bare) return body;

  return (
    <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 1.75, borderBottom: `1px solid ${colors.borderLight}` }}>
        <HistoryRounded sx={{ fontSize: 16, color: colors.textMuted }} />
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>Room History</Typography>
      </Box>
      <Box sx={{ p: 2.5 }}>{body}</Box>
    </Box>
  );
}
