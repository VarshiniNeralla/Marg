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

function Card({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Box
      sx={{
        flex: '1 1 160px', minWidth: 148, p: 2, borderRadius: '14px',
        backgroundColor: P.white, border: `1.5px solid ${P.border}`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, color: P.muted }}>
        {icon}
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          {label}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>{value}</Typography>
    </Box>
  );
}

export default function SummaryCardsRow({ cards }: { cards: SummaryCards }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
      <Card
        icon={<MeetingRoomRounded sx={{ fontSize: 16 }} />}
        label="Rooms"
        value={`${cards.roomsCompleted} done / ${cards.roomsPending} pending`}
      />
      <Card
        icon={<TaskAltRounded sx={{ fontSize: 16 }} />}
        label="Activities"
        value={`${cards.activitiesCompleted} done / ${cards.activitiesPending} pending`}
      />
      <Card
        icon={<PhotoLibraryRounded sx={{ fontSize: 16 }} />}
        label="Images Analyzed"
        value={String(cards.imagesAnalyzed)}
      />
      <Card
        icon={<EventAvailableRounded sx={{ fontSize: 16 }} />}
        label="Last Inspection"
        value={formatDate(cards.lastInspection)}
      />
      <Card
        icon={<VerifiedRounded sx={{ fontSize: 16 }} />}
        label="Avg. AI Confidence"
        value={`${Math.round(cards.avgConfidencePct)}%`}
      />
    </Box>
  );
}
