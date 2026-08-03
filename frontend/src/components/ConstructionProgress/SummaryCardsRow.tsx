import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  MeetingRoomRounded, TaskAltRounded, PhotoLibraryRounded,
  EventAvailableRounded, VerifiedRounded,
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
        flex: '1 1 160px', minWidth: 148, p: 2, borderRadius: '14px',
        backgroundColor: P.white, border: `1.5px solid ${P.border}`,
        borderTop: accent ? `3px solid ${accent}` : `1.5px solid ${P.border}`,
        display: 'flex', flexDirection: 'column', gap: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: P.muted }}>
        {icon}
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          {label}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <Box sx={{ height: 6, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden' }}>
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
    <Box sx={{ height: 6, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden', display: 'flex' }}>
      {completed > 0 && <Box sx={{ height: '100%', width: seg(completed), backgroundColor: colors.success }} />}
      {inProgress > 0 && <Box sx={{ height: '100%', width: seg(inProgress), backgroundColor: colors.warning }} />}
      {notStarted > 0 && <Box sx={{ height: '100%', width: seg(notStarted), backgroundColor: colors.borderLight }} />}
    </Box>
  );
}

function RatioCard({ icon, label, completed, inProgress, notStarted }: {
  icon: React.ReactNode; label: string; completed: number; inProgress: number; notStarted: number;
}) {
  const total = completed + inProgress + notStarted;
  const pct = total > 0 ? (completed / total) * 100 : 0;
  const color = tierColor(pct);
  return (
    <CardShell icon={icon} label={label} accent={color}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>
          {completed}
          <Typography component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, color: P.muted }}>
            {' '}/ {total}
          </Typography>
        </Typography>
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color }}>
          {Math.round(pct)}%
        </Typography>
      </Box>
      <StackedBar completed={completed} inProgress={inProgress} notStarted={notStarted} />
      <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
        {inProgress > 0 && (
          <Typography sx={{ fontSize: '0.6875rem', color: colors.warning, fontWeight: 600 }}>
            {inProgress} in progress
          </Typography>
        )}
        {notStarted > 0 && (
          <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>
            {notStarted} not started
          </Typography>
        )}
      </Box>
    </CardShell>
  );
}

export default function SummaryCardsRow({ cards }: { cards: SummaryCards }) {
  const confColor = tierColor(cards.avgConfidencePct);
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
      <RatioCard
        icon={<MeetingRoomRounded sx={{ fontSize: 16 }} />}
        label="Rooms"
        completed={cards.roomsCompleted}
        inProgress={cards.roomsInProgress}
        notStarted={cards.roomsNotStarted}
      />
      <RatioCard
        icon={<TaskAltRounded sx={{ fontSize: 16 }} />}
        label="Activities"
        completed={cards.activitiesCompleted}
        inProgress={cards.activitiesInProgress}
        notStarted={cards.activitiesNotStarted}
      />
      <CardShell icon={<PhotoLibraryRounded sx={{ fontSize: 16 }} />} label="Images Analyzed">
        <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>
          {cards.imagesAnalyzed}
        </Typography>
        <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>
          total captures reviewed
        </Typography>
      </CardShell>
      <CardShell icon={<EventAvailableRounded sx={{ fontSize: 16 }} />} label="Last Inspection">
        <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>
          {formatDate(cards.lastInspection)}
        </Typography>
        <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>
          most recent AI analysis
        </Typography>
      </CardShell>
      <CardShell icon={<VerifiedRounded sx={{ fontSize: 16 }} />} label="Avg. AI Confidence" accent={confColor}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>
            {Math.round(cards.avgConfidencePct)}%
          </Typography>
        </Box>
        <ProgressBar pct={cards.avgConfidencePct} color={confColor} />
      </CardShell>
    </Box>
  );
}
