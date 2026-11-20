import React from 'react';
import { Box, Typography } from '@mui/material';
import { colors } from '@theme/tokens';
import type { SummaryCards } from '@/services/constructionProgressService';
import { formatDate, formatDateTime } from '@/utils/dateFormat';
import ProgressRing from './ProgressRing';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff', bg: '#f8fafc' };

/** "17 of 20" style fact. Assessed = done + in progress; total includes everything still to look at. */
export function ratioFact(completed: number, inProgress: number, notStarted: number, notAssessed = 0) {
  const assessed = completed + inProgress;
  const total = completed + inProgress + notStarted + notAssessed;
  return { assessed, total, text: `${assessed} of ${total}` };
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.0625rem', fontWeight: 800, color: P.strong, lineHeight: 1.25 }}>{value}</Typography>
    </Box>
  );
}

/**
 * The floor overview, kept deliberately simple: ONE progress number (the ring) and a few plain facts.
 * The per-flat and common-area figures live on their own pages, so no number is repeated here.
 */
export default function FloorOverviewHero({
  overallProgressPct, overallStatus, cards, analysedAt,
}: {
  overallProgressPct: number;
  overallStatus?: string;
  cards: SummaryCards;
  analysedAt?: string | null;
}) {
  const done = overallStatus === 'completed';
  const rooms = ratioFact(cards.roomsCompleted, cards.roomsInProgress, cards.roomsNotStarted);
  const activities = ratioFact(cards.activitiesCompleted, cards.activitiesInProgress, cards.activitiesNotStarted);
  const coverage = typeof cards.coveragePct === 'number' ? `${Math.round(cards.coveragePct)}%` : '—';
  const photos = cards.imagesAnalyzed ?? 0;
  return (
    <Box
      data-testid="floor-overview-hero"
      sx={{
        display: 'flex', gap: { xs: 2.5, sm: 4 }, alignItems: 'center', flexWrap: 'wrap',
        p: { xs: 2, sm: 3 }, borderRadius: '16px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, mb: 3,
      }}
    >
      <ProgressRing percentage={overallProgressPct} label="Complete" />
      <Box sx={{ flex: 1, minWidth: 260 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
          <Typography sx={{ fontSize: '1.125rem', fontWeight: 800, color: P.strong }}>Floor progress</Typography>
          <Box sx={{ px: 1, py: 0.125, borderRadius: '6px', backgroundColor: done ? colors.successBg : colors.warningBg }}>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: done ? colors.success : colors.warning }}>
              {done ? 'Completed' : 'Work in progress'}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
          <Fact label="Rooms assessed" value={rooms.text} />
          <Fact label="Activities assessed" value={activities.text} />
          <Fact label="Photo coverage" value={coverage} />
        </Box>
        <Typography sx={{ fontSize: '0.75rem', color: P.muted, mt: 1.75, lineHeight: 1.5 }}>
          {photos} photo{photos === 1 ? '' : 's'} analysed
          {cards.lastInspection ? ` · last inspection ${formatDate(cards.lastInspection)}` : ''}
          {analysedAt ? ` · analysed ${formatDateTime(analysedAt)}` : ''}
        </Typography>
      </Box>
    </Box>
  );
}
