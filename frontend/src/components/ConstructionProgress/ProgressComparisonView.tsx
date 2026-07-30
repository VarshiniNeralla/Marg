import React, { useEffect, useState } from 'react';
import { Box, Typography, MenuItem, Select, CircularProgress } from '@mui/material';
import { CompareArrowsRounded, TrendingUpRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import {
  constructionProgressService,
  type TimelinePoint,
  type FloorComparison,
} from '@/services/constructionProgressService';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ProgressComparisonView({ floorId }: { floorId: string }) {
  const [points, setPoints] = useState<TimelinePoint[]>([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [comparison, setComparison] = useState<FloorComparison | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    constructionProgressService.getTimeline(floorId).then(result => {
      setPoints(result);
      if (result.length >= 2) {
        setFromId(result[0].snapshotId);
        setToId(result[result.length - 1].snapshotId);
      }
    });
  }, [floorId]);

  useEffect(() => {
    if (!fromId || !toId || fromId === toId) {
      setComparison(null);
      return;
    }
    setLoading(true);
    constructionProgressService.compare(floorId, fromId, toId)
      .then(setComparison)
      .catch(() => setComparison(null))
      .finally(() => setLoading(false));
  }, [floorId, fromId, toId]);

  if (points.length < 2) {
    return null;
  }

  return (
    <Box sx={{ p: 3, borderRadius: '14px', backgroundColor: P.white, border: `1.5px solid ${P.border}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <CompareArrowsRounded sx={{ fontSize: 18, color: P.muted }} />
        <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }}>
          Compare Dates
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Select
          size="small"
          value={fromId}
          onChange={e => setFromId(e.target.value)}
          sx={{ fontSize: '0.8125rem', minWidth: 160 }}
        >
          {points.map(p => (
            <MenuItem key={p.snapshotId} value={p.snapshotId} sx={{ fontSize: '0.8125rem' }}>
              {formatDate(p.snapshotDate)} ({Math.round(p.overallProgressPct)}%)
            </MenuItem>
          ))}
        </Select>
        <CompareArrowsRounded sx={{ fontSize: 18, color: P.muted }} />
        <Select
          size="small"
          value={toId}
          onChange={e => setToId(e.target.value)}
          sx={{ fontSize: '0.8125rem', minWidth: 160 }}
        >
          {points.map(p => (
            <MenuItem key={p.snapshotId} value={p.snapshotId} sx={{ fontSize: '0.8125rem' }}>
              {formatDate(p.snapshotDate)} ({Math.round(p.overallProgressPct)}%)
            </MenuItem>
          ))}
        </Select>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={20} sx={{ color: colors.primary }} />
        </Box>
      ) : comparison ? (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography sx={{ fontSize: '0.6875rem', color: P.muted, fontWeight: 600, textTransform: 'uppercase' }}>Before</Typography>
              <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>
                {Math.round(comparison.before.overallProgressPct)}%
              </Typography>
            </Box>
            <TrendingUpRounded sx={{ fontSize: 22, color: colors.success }} />
            <Box>
              <Typography sx={{ fontSize: '0.6875rem', color: P.muted, fontWeight: 600, textTransform: 'uppercase' }}>After</Typography>
              <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>
                {Math.round(comparison.after.overallProgressPct)}%
              </Typography>
            </Box>
            <Box
              sx={{
                px: 1.25, py: 0.5, borderRadius: '8px',
                backgroundColor: comparison.progressDelta >= 0 ? colors.successBg : colors.dangerBg,
              }}
            >
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: comparison.progressDelta >= 0 ? colors.success : colors.danger }}>
                {comparison.progressDelta >= 0 ? '+' : ''}{comparison.progressDelta}%
              </Typography>
            </Box>
          </Box>

          {comparison.newlyCompletedActivities.length > 0 ? (
            <Box>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.muted, mb: 1 }}>
                Newly completed activities
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {comparison.newlyCompletedActivities.map(name => (
                  <Box key={name} sx={{ px: 1, py: 0.375, borderRadius: '6px', backgroundColor: colors.successBg }}>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.success }}>{name}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          ) : (
            <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>
              No activities newly completed in this window.
            </Typography>
          )}
        </>
      ) : null}
    </Box>
  );
}
