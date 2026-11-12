import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { colors } from '@theme/tokens';
import type { FinishingSummary } from '@/services/constructionProgressService';
import { formatPct } from '@/utils/progressDisplay';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

export const PROGRESS_EXPLAINER =
  'Verified progress counts only work that was actually seen; work that was not photographed is not treated as '
  + 'proof of no work. Estimate on observed work is the progress of just the work that was seen. Coverage is the '
  + 'share of applicable checks that were observed. They are shown separately and never combined.';

/** True when the server sent a usable rollup (old snapshots send nothing or {}). */
export function hasFinishingSummary(s: FinishingSummary | undefined | null): s is FinishingSummary {
  return !!s && typeof s.progressPct === 'number';
}

function Count({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  return (
    <Box sx={{ flex: '1 1 130px', minWidth: 120, p: 1.25, borderRadius: '12px', backgroundColor: `${color}12` }}>
      <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color, lineHeight: 1.1 }}>{value ?? 0}</Typography>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: P.muted }}>{label}</Typography>
    </Box>
  );
}

export default function FinishingOverview({
  summary, isCommon = false,
}: { summary: FinishingSummary | undefined | null; isCommon?: boolean }) {
  if (!hasFinishingSummary(summary)) return null;
  const unit = isCommon ? 'regions' : 'flats';
  const hasEstimate = typeof summary.estimatePct === 'number';
  return (
    <Box
      data-testid="finishing-overview"
      sx={{ p: { xs: 2, sm: 3 }, borderRadius: '16px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, mb: 3 }}
    >
      <Box sx={{ display: 'flex', gap: { xs: 2, sm: 4 }, alignItems: 'flex-end', flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Tooltip title={PROGRESS_EXPLAINER} arrow enterTouchDelay={0}>
            <Typography
              tabIndex={0}
              sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'help' }}
            >
              Verified progress
            </Typography>
          </Tooltip>
          <Typography sx={{ fontSize: '2.25rem', fontWeight: 800, color: P.strong, lineHeight: 1.1 }}>
            {formatPct(summary.progressPct)}
          </Typography>
        </Box>
        {hasEstimate && (
          <Box>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: P.muted }}>Estimate on observed work</Typography>
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: P.strong }}>{formatPct(summary.estimatePct)}</Typography>
          </Box>
        )}
        {typeof summary.coveragePct === 'number' && (
          <Box>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: P.muted }}>Coverage</Typography>
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: P.strong }}>{formatPct(summary.coveragePct)}</Typography>
          </Box>
        )}
      </Box>
      <Typography sx={{ fontSize: '0.75rem', color: P.muted, mb: 1.5, lineHeight: 1.45 }}>
        Verified progress counts only what was seen. The estimate covers the observed work only, and coverage shows how
        much of the {unit} work was actually observed.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Count label={isCommon ? 'Completed regions' : 'Completed flats'} value={summary.completed} color={colors.success} />
        <Count label="In progress" value={summary.inProgress} color={colors.warning} />
        <Count label="Awaiting sufficient evidence" value={summary.awaitingEvidence} color={colors.info} />
        <Count label="Not started" value={summary.notStarted} color={colors.textMuted} />
      </Box>
    </Box>
  );
}
