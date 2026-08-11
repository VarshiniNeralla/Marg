import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  MeetingRoomRounded, TaskAltRounded, PhotoLibraryRounded,
  EventAvailableRounded, VerifiedRounded, GridViewRounded,
} from '@mui/icons-material';
import { colors } from '@theme/tokens';
import type { SummaryCards } from '@/services/constructionProgressService';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function tierColor(pct: number): string {
  if (pct >= 75) return colors.success;
  if (pct >= 35) return colors.warning;
  return colors.danger;
}

function CardShell({ icon, label, accent, children }: {
  icon: React.ReactNode; label: string; accent?: string; children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        minWidth: 0,
        px: 2,
        py: 1.5,
        borderRadius: '12px',
        backgroundColor: P.white,
        border: `1.5px solid ${P.border}`,
        borderTop: accent ? `3px solid ${accent}` : `1.5px solid ${P.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: P.muted }}>
        <Box sx={{ display: 'flex', flexShrink: 0, lineHeight: 0 }}>{icon}</Box>
        <Typography
          sx={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            lineHeight: 1.3,
          }}
        >
          {label}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <Box sx={{ height: 5, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden' }}>
      <Box
        sx={{
          height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`,
          backgroundColor: color, borderRadius: '999px', transition: 'width 0.4s ease-out',
        }}
      />
    </Box>
  );
}

// Three honest segments, not a binary done/not-done split — a room or
// activity with real photos and visible progress must read differently from
// one nobody has touched at all, instead of both collapsing into "pending".
function StackedBar({ completed, inProgress, notStarted }: {
  completed: number; inProgress: number; notStarted: number;
}) {
  const total = completed + inProgress + notStarted;
  if (total === 0) return <ProgressBar pct={0} color={colors.borderLight} />;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <Box sx={{ height: 5, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden', display: 'flex' }}>
      {completed > 0 && <Box sx={{ height: '100%', width: seg(completed), backgroundColor: colors.success }} />}
      {inProgress > 0 && <Box sx={{ height: '100%', width: seg(inProgress), backgroundColor: colors.warning }} />}
      {notStarted > 0 && <Box sx={{ height: '100%', width: seg(notStarted), backgroundColor: colors.borderLight }} />}
    </Box>
  );
}

function RatioCard({ icon, label, completed, inProgress, notStarted, notAssessed, notObservable }: {
  icon: React.ReactNode; label: string; completed: number; inProgress: number; notStarted: number;
  notAssessed?: number; notObservable?: number;
}) {
  const assessed = completed + inProgress;
  const total = completed + inProgress + notStarted;
  // Headline: assessed / total (not only completed) so "5 in progress" is visible.
  const headlineLeft = assessed;
  const pct = total > 0 ? (completed / total) * 100 : 0;
  const color = tierColor(assessed > 0 ? Math.max(pct, 5) : 0);
  const na = notAssessed ?? 0;
  const no = notObservable ?? 0;
  return (
    <CardShell icon={icon} label={label} accent={color}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: P.strong, lineHeight: 1.2 }}>
          {headlineLeft}
          <Typography component="span" sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.muted }}>
            {' '}assessed / {total}
          </Typography>
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color, flexShrink: 0 }}>
          {completed} done
        </Typography>
      </Box>
      <StackedBar completed={completed} inProgress={inProgress} notStarted={notStarted} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.25, rowGap: 0.25 }}>
        {completed > 0 && (
          <Typography sx={{ fontSize: '0.6875rem', color: colors.success, fontWeight: 600 }}>
            {completed} complete
          </Typography>
        )}
        {inProgress > 0 && (
          <Typography sx={{ fontSize: '0.6875rem', color: colors.warning, fontWeight: 600 }}>
            {inProgress} in progress
          </Typography>
        )}
        {na > 0 && (
          <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>
            {na} not assessed
          </Typography>
        )}
        {no > 0 && (
          <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>
            {no} not observable
          </Typography>
        )}
        {na === 0 && no === 0 && notStarted > 0 && (
          <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>
            {notStarted} not started
          </Typography>
        )}
      </Box>
    </CardShell>
  );
}

export default function SummaryCardsRow({
  cards,
  overallProgressPct,
}: {
  cards: SummaryCards;
  /** When provided, shown beside coverage so progress ≠ photo coverage. */
  overallProgressPct?: number;
}) {
  const confColor = tierColor(cards.avgConfidencePct);
  const coveragePct = cards.coveragePct;
  const progressPct = overallProgressPct;
  const showProgressCoverage =
    typeof coveragePct === 'number' || typeof progressPct === 'number';
  const progressColor = tierColor(progressPct ?? 0);
  const coverageColor = tierColor(coveragePct ?? 0);

  return (
    <Box
      sx={{
        display: 'grid',
        // Wider cards (3 across) so labels/meta never need ellipsis; two tidy rows.
        gridTemplateColumns: {
          xs: 'repeat(1, minmax(0, 1fr))',
          sm: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(3, minmax(0, 1fr))',
        },
        gap: 1.25,
        alignItems: 'start',
      }}
    >
      {showProgressCoverage && (
        <CardShell
          icon={<GridViewRounded sx={{ fontSize: 15 }} />}
          label="Progress / Coverage"
          accent={progressColor}
        >
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5 }}>
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: P.strong, lineHeight: 1.2 }}>
              {typeof progressPct === 'number' ? `${Math.round(progressPct)}%` : '—'}
              <Typography component="span" sx={{ fontSize: '0.75rem', fontWeight: 600, color: P.muted }}>
                {' '}progress
              </Typography>
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: coverageColor, flexShrink: 0 }}>
              {typeof coveragePct === 'number' ? `${Math.round(coveragePct)}%` : '—'} coverage
            </Typography>
          </Box>
          <ProgressBar pct={progressPct ?? 0} color={progressColor} />
          <Typography sx={{ fontSize: '0.6875rem', color: P.muted, lineHeight: 1.35 }}>
            Photo coverage ≠ finish %
          </Typography>
        </CardShell>
      )}
      <RatioCard
        icon={<MeetingRoomRounded sx={{ fontSize: 15 }} />}
        label="Rooms"
        completed={cards.roomsCompleted}
        inProgress={cards.roomsInProgress}
        notStarted={cards.roomsNotStarted}
      />
      <RatioCard
        icon={<TaskAltRounded sx={{ fontSize: 15 }} />}
        label="Activities"
        completed={cards.activitiesCompleted}
        inProgress={cards.activitiesInProgress}
        notStarted={cards.activitiesNotStarted}
        notAssessed={cards.activitiesNotAssessed}
        notObservable={cards.activitiesNotObservable}
      />
      <CardShell icon={<PhotoLibraryRounded sx={{ fontSize: 15 }} />} label="Images Analyzed">
        <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: P.strong, lineHeight: 1.2 }}>
          {cards.imagesAnalyzed}
        </Typography>
        <Typography sx={{ fontSize: '0.6875rem', color: P.muted, lineHeight: 1.35 }}>
          total captures reviewed
        </Typography>
      </CardShell>
      <CardShell icon={<EventAvailableRounded sx={{ fontSize: 15 }} />} label="Last Inspection">
        <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: P.strong, lineHeight: 1.2 }}>
          {formatDate(cards.lastInspection)}
        </Typography>
        <Typography sx={{ fontSize: '0.6875rem', color: P.muted, lineHeight: 1.35 }}>
          most recent AI analysis
        </Typography>
      </CardShell>
      <CardShell icon={<VerifiedRounded sx={{ fontSize: 15 }} />} label="Avg. AI Confidence" accent={confColor}>
        <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: P.strong, lineHeight: 1.2 }}>
          {Math.round(cards.avgConfidencePct)}%
        </Typography>
        <ProgressBar pct={cards.avgConfidencePct} color={confColor} />
      </CardShell>
    </Box>
  );
}
