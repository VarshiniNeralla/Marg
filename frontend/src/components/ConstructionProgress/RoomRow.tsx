import React, { useState } from 'react';
import { Box, Collapse, Typography } from '@mui/material';
import { ExpandMoreRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import type { RoomActivityAssessment, RoomProgress } from '@/services/constructionProgressService';
import { formatDate } from '@/utils/dateFormat';
import {
  countNeedingReview, notObservedCount, observedText, resolveScopeStatus, reviewBannerText, safePct, scopeColor, scopeLabel,
} from '@/utils/progressDisplay';
import RoomActivityRow, { type OpenEvidence } from './RoomActivityRow';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff', hover: '#f9fafb' };

/** The small grey facts shown when a room is opened (they used to be printed on every card). */
export function roomFacts(room: RoomProgress): string[] {
  const facts: string[] = [];
  const scope = resolveScopeStatus(room);
  if (scope !== 'no_photos') facts.push(scopeLabel(scope)); // e.g. "Work in progress"
  const observed = observedText(room.observedActivities, room.applicableActivities);
  if (observed) facts.push(observed);
  if (typeof room.estimatePct === 'number') facts.push(`Estimate on observed work ${Math.round(room.estimatePct)}%`);
  const missing = notObservedCount(room.observedActivities, room.applicableActivities);
  if (missing > 0) facts.push(`${missing} not observed`);
  if (room.lastInspection) facts.push(`Last inspection ${formatDate(room.lastInspection)}`);
  return facts;
}

/**
 * One room as one quiet line: name, a slim bar and the percentage. Opening it shows the details. Rooms with no photos
 * show a dash and cannot be opened. Replaces the old card with five lines of small print per room.
 */
export default function RoomRow({
  room, canReview, onReview, onOpenEvidence, defaultExpanded = false,
}: {
  room: RoomProgress;
  canReview?: boolean;
  onReview?: (room: RoomProgress, activity: RoomActivityAssessment) => void;
  onOpenEvidence: OpenEvidence;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const scope = resolveScopeStatus(room);
  const c = scopeColor(scope);
  const hasProgress = typeof room.progressPct === 'number' && scope !== 'no_photos';
  const pct = hasProgress ? safePct(room.progressPct as number, scope === 'completed') : null;
  const canExpand = room.activities.length > 0;
  const needReview = countNeedingReview(room.activities);
  const pins = room.pinNumbers?.length ? `${room.pinNumbers.length === 1 ? 'Pin' : 'Pins'} ${room.pinNumbers.join(', ')}` : null;
  const facts = roomFacts(room);
  const muted = scope === 'no_photos';

  const line = (
    <>
      <Box sx={{ gridArea: 'name', minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: muted ? P.muted : P.strong, lineHeight: 1.35 }}>{room.roomName}</Typography>
        {pins && <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>{pins}</Typography>}
        {needReview > 0 && (
          <Box component="span" role="img" aria-label="Needs review" title="Needs review" sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: colors.danger, alignSelf: 'center' }} />
        )}
      </Box>
      <Box sx={{ gridArea: 'bar', minWidth: 0, display: pct === null ? { xs: 'none', sm: 'block' } : 'block' }}>
        {pct !== null && (
          <Box sx={{ height: 6, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${pct}%`, backgroundColor: c.fg, borderRadius: '999px', transition: `width ${motion.durationSlow} ${motion.easeOut}` }} />
          </Box>
        )}
      </Box>
      <Typography sx={{ gridArea: 'pct', textAlign: 'right', fontSize: '0.875rem', fontWeight: 700, color: muted ? P.muted : P.strong }}>
        {pct !== null ? `${pct}%` : '—'}
      </Typography>
      <Box sx={{ gridArea: 'chev', display: 'flex', justifyContent: 'center', color: P.muted, visibility: canExpand ? 'visible' : 'hidden' }}>
        <ExpandMoreRounded sx={{ fontSize: 20, transform: expanded ? 'rotate(180deg)' : 'none', transition: `transform ${motion.durationFast} ${motion.easeOut}` }} />
      </Box>
    </>
  );

  const lineSx = {
    width: '100%', display: 'grid', alignItems: 'center', columnGap: 2, rowGap: 0.75, textAlign: 'left',
    px: { xs: 1.5, sm: 2 }, py: 1.25, minHeight: 48, border: 0, backgroundColor: 'transparent', fontFamily: 'inherit',
    gridTemplateColumns: { xs: 'minmax(0, 1fr) 44px 24px', sm: 'minmax(0, 1.5fr) minmax(90px, 1fr) 48px 24px' },
    gridTemplateAreas: { xs: '"name pct chev" "bar bar bar"', sm: '"name bar pct chev"' },
  } as const;

  return (
    <Box data-testid="room-row" sx={{ borderTop: `1px solid ${colors.borderLight}`, '&:first-of-type': { borderTop: 0 } }}>
      {canExpand ? (
        <Box
          component="button" type="button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}
          sx={{ ...lineSx, cursor: 'pointer', '&:hover': { backgroundColor: P.hover }, '&:focus-visible': { outline: `3px solid ${colors.primaryRing}`, outlineOffset: -3 } }}
        >
          {line}
        </Box>
      ) : (
        <Box sx={lineSx}>{line}</Box>
      )}

      <Collapse in={expanded && canExpand} timeout={200} unmountOnExit>
        <Box sx={{ px: { xs: 1.5, sm: 2 }, pb: 2, pt: 0.5, backgroundColor: P.hover, borderTop: `1px solid ${colors.borderLight}` }}>
          {facts.length > 0 && (
            <Typography data-testid="room-facts" sx={{ fontSize: '0.75rem', color: P.muted, py: 1 }}>{facts.join(' · ')}</Typography>
          )}
          {needReview > 0 && (
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.danger, pb: 0.5 }}>{reviewBannerText(needReview)}</Typography>
          )}
          {room.activities.map(a => (
            <RoomActivityRow
              key={a.activityId}
              activity={a}
              siblings={room.activities}
              canReview={canReview}
              onReview={act => onReview?.(room, act)}
              onOpenEvidence={(name, ids, details, activity) => onOpenEvidence(name, ids, details, activity, room.roomName)}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
