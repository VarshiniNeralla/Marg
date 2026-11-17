import React from 'react';
import { Box, Typography } from '@mui/material';
import { CalendarMonthRounded, CheckCircleRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { type CaptureSnapshot } from '@/data/mockData';

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

const GREEN = '#16a34a';
const VIOLET = '#7c3aed';
const AMBER = '#d97706';

/**
 * One card per visit, oldest to newest, so every capture date and time at this point is readable at a glance.
 * The selected visit is outlined in blue; the latest carries a green tag.
 */
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
          display: 'flex', alignItems: 'center', gap: 1.5, px: 1.75, py: 1.25,
          borderRadius: '16px', background: 'linear-gradient(135deg,#f0fdf4,#ecfdf5)', border: '1px solid #bbf7d0',
        }}
      >
        <Box sx={{ width: 40, height: 40, borderRadius: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: GREEN, boxShadow: '0 4px 12px rgba(22,163,74,0.28)' }}>
          <CheckCircleRounded sx={{ fontSize: 21, color: '#fff' }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textStrong, fontWeight: 800, lineHeight: 1.25 }}>
            {date}{time ? ` · ${time}` : ''}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#15803d', mt: 0.125 }}>
            Only capture so far
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          display: 'flex', gap: 1.25, overflowX: 'auto', scrollbarWidth: 'thin', px: 0.25, pt: 0.75, pb: 1,
          scrollSnapType: 'x proximity',
        }}
      >
        {series.map((snap, i) => {
          const isActive = snap.id === activeId;
          const isLatest = !!snap.isLatest || i === series.length - 1;
          const compareSlot = compareIds
            ? (compareIds[0] === snap.id ? 'A' : compareIds[1] === snap.id ? 'B' : null)
            : null;
          const accent = compareSlot === 'A' ? VIOLET : compareSlot === 'B' ? AMBER : colors.primary;
          const highlighted = isActive || !!compareSlot;
          const { date, time } = splitDateTime(snap.dateLabel || snap.date || `Visit ${i + 1}`);

          return (
            <Box
              key={snap.id}
              role="button"
              data-testid="timeline-visit"
              aria-pressed={isActive}
              onClick={() => onSelect(snap)}
              sx={{
                position: 'relative', flex: '0 0 auto', minWidth: 124, scrollSnapAlign: 'start',
                px: 1.5, pt: 1.25, pb: 1.25, borderRadius: '16px', cursor: 'pointer', userSelect: 'none',
                backgroundColor: highlighted ? '#fff' : '#f8fafc',
                border: `1.5px solid ${highlighted ? accent : '#e5e7eb'}`,
                boxShadow: highlighted ? `0 6px 16px ${accent}33` : 'none',
                transition: `transform ${motion.durationFast} ${motion.easeOut}, box-shadow ${motion.durationFast} ${motion.easeOut}`,
                '&:hover': { transform: 'translateY(-2px)', borderColor: compareMode ? VIOLET : colors.primary },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: highlighted ? accent : '#6b7280' }}>
                  <CalendarMonthRounded sx={{ fontSize: 15 }} />
                  <Typography sx={{ fontSize: '0.6875rem', fontWeight: 800, color: 'inherit' }}>Visit {i + 1}</Typography>
                </Box>
                {compareSlot && (
                  <Box sx={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6875rem', fontWeight: 800 }}>
                    {compareSlot}
                  </Box>
                )}
              </Box>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 800, color: colors.textStrong, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                {date}
              </Typography>
              {time && (
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, color: colors.textMuted, mt: 0.25, whiteSpace: 'nowrap' }}>
                  {time}
                </Typography>
              )}
              {isLatest && (
                <Box sx={{ mt: 0.75, display: 'inline-block', px: 0.875, py: 0.125, borderRadius: '999px', backgroundColor: '#dcfce7', color: '#15803d', fontSize: '0.625rem', fontWeight: 800, letterSpacing: '0.04em' }}>
                  LATEST
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
