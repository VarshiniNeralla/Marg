import React, { useState } from 'react';
import { Box, Collapse, Typography } from '@mui/material';
import {
  ExpandMoreRounded, PushPinRounded, BedroomParentRounded, KitchenRounded, WcRounded, BalconyRounded,
  WeekendRounded, DoorFrontRounded, Inventory2Rounded, CheckroomRounded, SelfImprovementRounded, DeckRounded,
  LocalLaundryServiceRounded, HomeRounded, TableRestaurantRounded, ElectricalServicesRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import type { EvidenceDetail, RoomActivityAssessment, RoomProgress } from '@/services/constructionProgressService';
import { formatDate } from '@/utils/dateFormat';
import {
  countNeedingReview, notObservedCount, observedText, resolveScopeStatus, reviewBannerText, safePct, scopeColor,
} from '@/utils/progressDisplay';
import { Pill, ReviewChip, ScopeChip } from './ProgressChips';
import RoomActivityRow from './RoomActivityRow';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff', bg: '#f7f8fa' };

/** Maps a room name to a representative icon. */
function roomTypeIcon(roomName: string) {
  const n = roomName.toLowerCase();
  if (n.includes('dress')) return CheckroomRounded;
  if (n.includes('bedroom')) return BedroomParentRounded;
  if (n.includes('kitchen')) return KitchenRounded;
  if (n.includes('pdr')) return ElectricalServicesRounded;
  if (n.includes('toilet') || n.includes('wc')) return WcRounded;
  if (n.includes('balcony')) return BalconyRounded;
  if (n.includes('sit-out') || n.includes('sit out') || n.includes('sitout') || n.includes('deck')) return DeckRounded;
  if (n.includes('drawing') || n.includes('living')) return WeekendRounded;
  if (n.includes('dining')) return TableRestaurantRounded;
  if (n.includes('lobby') || n.includes('foyer')) return DoorFrontRounded;
  if (n.includes('store')) return Inventory2Rounded;
  if (n.includes('puja')) return SelfImprovementRounded;
  if (n.includes('utility')) return LocalLaundryServiceRounded;
  return HomeRounded;
}

export default function RoomProgressCard({
  room, canReview, onReview, onOpenEvidence, defaultExpanded = false,
}: {
  room: RoomProgress;
  canReview?: boolean;
  onReview?: (room: RoomProgress, activity: RoomActivityAssessment) => void;
  onOpenEvidence: (activityName: string, captureIds: string[], details: EvidenceDetail[]) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const scope = resolveScopeStatus(room);
  const c = scopeColor(scope);
  const hasProgress = typeof room.progressPct === 'number';
  const pct = hasProgress ? safePct(room.progressPct as number, scope === 'completed') : null;
  const observed = observedText(room.observedActivities, room.applicableActivities);
  const missing = notObservedCount(room.observedActivities, room.applicableActivities);
  const pinLabel = room.pinNumbers?.length
    ? `Pin${room.pinNumbers.length === 1 ? '' : 's'} ${room.pinNumbers.join(', ')}`
    : null;
  const RoomIcon = roomTypeIcon(room.roomName);
  const canExpand = room.activities.length > 0;
  const needReview = countNeedingReview(room.activities);
  const active = scope !== 'no_photos';

  return (
    <Box
      data-testid="room-card"
      sx={{
        display: 'flex', flexDirection: 'column', borderRadius: '16px', minWidth: 0,
        backgroundColor: active ? P.white : P.bg,
        border: `1px solid ${active ? P.border : colors.borderLight}`, borderStyle: active ? 'solid' : 'dashed',
        overflow: 'hidden', gridColumn: expanded ? '1 / -1' : 'auto',
      }}
    >
      <Box sx={{ p: { xs: 1.5, sm: 1.75 }, pb: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
          <Box sx={{ width: 38, height: 38, borderRadius: '11px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
            <RoomIcon sx={{ fontSize: 20, color: c.fg }} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong, lineHeight: 1.35 }}>{room.roomName}</Typography>
            {pinLabel && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, mt: 0.375 }}>
                <PushPinRounded sx={{ fontSize: 12, color: colors.primary }} />
                <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.primary }}>{pinLabel}</Typography>
              </Box>
            )}
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.75 }}>
              <ScopeChip status={scope} />
              {room.reviewRequired && <ReviewChip label="Review needed" />}
            </Box>
          </Box>
        </Box>

        <Box sx={{ mt: 1.25 }}>
          {hasProgress ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
                <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>Verified progress</Typography>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 800, color: P.strong }}>{pct}%</Typography>
              </Box>
              <Box sx={{ height: 6, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${pct}%`, backgroundColor: c.fg, borderRadius: '999px', transition: `width ${motion.durationSlow} ${motion.easeOut}` }} />
              </Box>
            </>
          ) : (
            <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
              {active ? 'Progress not available for this snapshot.' : 'No captures cover this room yet.'}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.75, alignItems: 'center' }}>
            {observed && <Pill label={observed} fg={colors.textMuted} bg={colors.bgDeep} />}
            {typeof room.estimatePct === 'number' && (
              <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>
                Estimate on observed work {Math.round(room.estimatePct)}%
              </Typography>
            )}
          </Box>
          {missing > 0 && (
            <Typography data-testid="not-observed" sx={{ fontSize: '0.6875rem', color: P.muted, mt: 0.5 }}>
              Activities not observed: {missing}
            </Typography>
          )}
          {room.lastInspection && (
            <Typography sx={{ fontSize: '0.6875rem', color: P.muted, mt: 0.5 }}>
              Last inspection {formatDate(room.lastInspection)}
            </Typography>
          )}
        </Box>
      </Box>

      {canExpand && (
        <Box
          component="button"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
          sx={{
            mt: 'auto', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, cursor: 'pointer',
            px: { xs: 1.5, sm: 1.75 }, border: 0, borderTop: `1px solid ${colors.borderLight}`, backgroundColor: 'transparent',
            color: P.muted, fontFamily: 'inherit',
          }}
        >
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>{expanded ? 'Hide details' : 'Show details'}</Typography>
          <ExpandMoreRounded sx={{ fontSize: 18, transform: expanded ? 'rotate(180deg)' : 'none', transition: `transform ${motion.durationFast} ${motion.easeOut}` }} />
        </Box>
      )}

      <Collapse in={expanded && canExpand} timeout={200} unmountOnExit>
        <Box sx={{ px: { xs: 1.5, sm: 1.75 }, pb: 1.75, pt: 1.25, borderTop: `1px solid ${P.border}` }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.25 }}>
            Activity detail
          </Typography>
          {needReview > 0 && (
            <Typography sx={{ fontSize: '0.75rem', color: colors.danger, mb: 0.5 }}>{reviewBannerText(needReview)}</Typography>
          )}
          {room.activities.map(a => (
            <RoomActivityRow
              key={a.activityId}
              activity={a}
              siblings={room.activities}
              canReview={canReview}
              onReview={act => onReview?.(room, act)}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
