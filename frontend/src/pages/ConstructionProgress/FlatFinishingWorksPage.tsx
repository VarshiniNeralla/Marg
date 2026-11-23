import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Collapse, Typography, CircularProgress, Tooltip } from '@mui/material';
import { ArrowBackRounded, ExpandMoreRounded, InfoOutlined as InfoOutlinedIcon } from '@mui/icons-material';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { colors, motion } from '@theme/tokens';
import {
  constructionProgressService,
  type FloorProgressSnapshot,
  type FlatProgress,
  type RoomActivityAssessment,
  type RoomProgress,
} from '@/services/constructionProgressService';
import { useAuthStore, isManagerOrAdmin } from '@store/authStore';
import { type OpenEvidence } from '@/components/ConstructionProgress/RoomActivityRow';
import { evidencePath } from '@/utils/evidenceImages';
import { PROGRESS_EXPLAINER } from '@/components/ConstructionProgress/FinishingOverview';
import FlatSelector from '@/components/ConstructionProgress/FlatSelector';
import RoomRow from '@/components/ConstructionProgress/RoomRow';
import ActivityReviewDialog from '@/components/ConstructionProgress/ActivityReviewDialog';
import { ScopeChip } from '@/components/ConstructionProgress/ProgressChips';
import { formatDate } from '@/utils/dateFormat';
import {
  countNeedingReview, resolveScopeStatus, reviewBannerText, safePct, scopeColor,
} from '@/utils/progressDisplay';
import type { ScopeStatus } from '@/services/constructionProgressService';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

// Rooms that have photos are listed in this order; rooms with no photos go in their own folded-away group.
const PHOTOGRAPHED_ORDER: ScopeStatus[] = ['in_progress', 'awaiting_evidence', 'completed', 'not_started'];

function isCommonArea(f: FlatProgress): boolean {
  return f.flatName === 'Common Area';
}

interface ReviewState { room: RoomProgress; activity: RoomActivityAssessment }

/** The one quiet line of facts under the flat's percentage. */
export function flatSummaryLine(flat: FlatProgress, isCommon: boolean): string {
  const unit = isCommon ? 'regions' : 'rooms';
  const parts: string[] = [];
  parts.push(typeof flat.roomsPhotographed === 'number' && typeof flat.roomsRequired === 'number'
    ? `${flat.roomsPhotographed} of ${flat.roomsRequired} ${unit} photographed`
    : `${flat.roomsTotal} ${unit}`);
  parts.push(`${flat.roomsComplete} of ${flat.roomsTotal} complete`);
  if (flat.lastInspection) parts.push(`last inspection ${formatDate(flat.lastInspection)}`);
  return parts.join(' · ');
}

function RoomList({
  rooms, canReview, onReview, onOpenEvidence,
}: {
  rooms: RoomProgress[];
  canReview: boolean;
  onReview: (room: RoomProgress, activity: RoomActivityAssessment) => void;
  onOpenEvidence: OpenEvidence;
}) {
  return (
    <Box sx={{ borderRadius: '14px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, overflow: 'hidden' }}>
      {rooms.map((room, i) => (
        <RoomRow key={`${room.roomName}-${i}`} room={room} canReview={canReview} onReview={onReview} onOpenEvidence={onOpenEvidence} />
      ))}
    </Box>
  );
}

function FlatDetail({
  flat, isCommon, canReview, onReview, onOpenEvidence,
}: {
  flat: FlatProgress;
  isCommon: boolean;
  canReview: boolean;
  onReview: (room: RoomProgress, activity: RoomActivityAssessment) => void;
  onOpenEvidence: OpenEvidence;
}) {
  const scope = resolveScopeStatus(flat);
  const completed = scope === 'completed' || !!flat.isFullyComplete;
  const verified = safePct(flat.completionPct, completed);
  const needReview = countNeedingReview(flat.rooms.flatMap(r => r.activities));
  const unit = isCommon ? 'regions' : 'rooms';
  const [showEmpty, setShowEmpty] = useState(false);

  const photographed = PHOTOGRAPHED_ORDER.flatMap(status => flat.rooms.filter(r => resolveScopeStatus(r) === status));
  const withoutPhotos = flat.rooms.filter(r => resolveScopeStatus(r) === 'no_photos');

  return (
    <Box>
      {/* One slim header: the percentage appears once, with a single line of facts under it. */}
      <Box sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: '16px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: P.strong, lineHeight: 1.2 }}>{flat.flatName}</Typography>
            <ScopeChip status={scope} />
            <Tooltip title={PROGRESS_EXPLAINER} arrow enterTouchDelay={0}>
              <InfoOutlinedIcon tabIndex={0} aria-label="How progress is measured" sx={{ fontSize: 18, color: P.muted, cursor: 'help' }} />
            </Tooltip>
          </Box>
          <Typography data-testid="flat-percentage" sx={{ fontSize: '2rem', fontWeight: 800, color: P.strong, lineHeight: 1 }}>{verified}%</Typography>
        </Box>
        <Box sx={{ height: 8, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden', mt: 1.75 }}>
          <Box sx={{ height: '100%', width: `${verified}%`, backgroundColor: scopeColor(scope).fg, borderRadius: '999px', transition: `width ${motion.durationSlow} ${motion.easeOut}` }} />
        </Box>
        <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mt: 1.25 }}>{flatSummaryLine(flat, isCommon)}</Typography>
        {needReview > 0 && (
          <Typography role="status" sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.danger, mt: 0.5 }}>{reviewBannerText(needReview)}</Typography>
        )}
      </Box>

      <Typography component="h2" sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>
        {isCommon ? 'Regions' : 'Rooms'} · {photographed.length}
      </Typography>
      {photographed.length > 0 ? (
        <RoomList rooms={photographed} canReview={canReview} onReview={onReview} onOpenEvidence={onOpenEvidence} />
      ) : (
        <Typography sx={{ fontSize: '0.875rem', color: P.muted, py: 2 }}>No {unit} have been photographed yet.</Typography>
      )}

      {withoutPhotos.length > 0 && (
        <Box sx={{ mt: 2.5 }}>
          <Box
            component="button" type="button" aria-expanded={showEmpty} onClick={() => setShowEmpty(v => !v)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 44, px: 0.5, border: 0, backgroundColor: 'transparent',
              cursor: 'pointer', fontFamily: 'inherit', color: P.muted, fontSize: '0.8125rem', fontWeight: 600,
              '&:hover': { color: P.strong },
            }}
          >
            {withoutPhotos.length} {withoutPhotos.length === 1 ? unit.replace(/s$/, '') : unit} without photos
            <ExpandMoreRounded sx={{ fontSize: 18, transform: showEmpty ? 'rotate(180deg)' : 'none', transition: `transform ${motion.durationFast} ${motion.easeOut}` }} />
          </Box>
          <Collapse in={showEmpty} timeout={200} unmountOnExit>
            <Box sx={{ mt: 1 }}>
              <RoomList rooms={withoutPhotos} canReview={canReview} onReview={onReview} onOpenEvidence={onOpenEvidence} />
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
}

export default function FlatFinishingWorksPage() {
  const { floorId } = useParams<{ floorId: string }>();
  const location = useLocation();
  const isCommon = location.pathname.endsWith('/common');
  const user = useAuthStore(s => s.user);
  const canReview = isManagerOrAdmin(user);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<FloorProgressSnapshot | null>(null);
  const [selectedFlat, setSelectedFlat] = useState<string>('');
  const navigate = useNavigate();
  const [review, setReview] = useState<ReviewState | null>(null);

  const scopedProgress = useMemo(() => {
    const all = snapshot?.flatProgress ?? [];
    return isCommon ? all.filter(isCommonArea) : all.filter(f => !isCommonArea(f));
  }, [snapshot, isCommon]);

  /** `silent` reloads in place (after a review): no spinner and the selected flat is kept. */
  const load = useCallback(async (silent = false) => {
    if (!floorId) return;
    if (!silent) setLoading(true);
    try {
      const detail = await constructionProgressService.getFloorDetail(floorId);
      setSnapshot(detail);
      if (!detail) {
        setSelectedFlat('');
        return;
      }
      const pool = isCommon
        ? detail.flatProgress.filter(isCommonArea)
        : detail.flatProgress.filter(f => !isCommonArea(f));
      setSelectedFlat(prev => {
        if (silent && pool.some(f => f.flatName === prev)) return prev;
        if (pool.length === 0) return '';
        const scored = pool.map(f => ({
          name: f.flatName,
          score: f.rooms.reduce((n, r) => n + (r.capturesCount ?? 0) + (r.pinNumbers?.length ?? 0), 0),
        }));
        scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
        return scored[0]?.name || pool[0].flatName;
      });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        setSnapshot(null);
        setSelectedFlat('');
      } else {
        toast.error(isCommon ? 'Failed to load common area finishing works' : 'Failed to load flat finishing works');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [floorId, isCommon]);

  useEffect(() => {
    load();
  }, [load]);

  const flat = scopedProgress.find(f => f.flatName === selectedFlat) ?? null;
  /** Evidence opens on its own page: every supporting capture of this activity in this room, as 360 panoramas. */
  const openEvidence: OpenEvidence = (_name, _ids, _details, activity, roomName) => {
    if (!floorId || !activity) return;
    navigate(evidencePath(floorId, activity.activityId, { flat: flat?.flatName, room: roomName }));
  };
  const pageTitle = isCommon ? 'Common Area Finishing Works' : 'Flat Finishing Works';
  const pageSubtitle = snapshot
    ? isCommon
      ? `${snapshot.floorName} — marked common areas and their finishing status.`
      : `${snapshot.floorName} — select a flat to see its own completion status.`
    : 'Loading…';

  return (
    <Box sx={{ maxWidth: 1080, mx: 'auto', px: { xs: 2, sm: 3 }, py: 4 }}>
      <Box sx={{ mb: { xs: 3, md: 4 } }}>
        <Box component={Link} to={floorId ? `/construction-progress/${floorId}` : '/construction-progress'} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3, minHeight: 44,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}
        >
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Floor Overview
        </Box>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5 }}>
          {pageTitle}
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>{pageSubtitle}</Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress size={28} sx={{ color: colors.primary }} />
        </Box>
      ) : !snapshot || scopedProgress.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 1 }}>
            {isCommon ? 'No common area data available yet' : 'No flat data available yet'}
          </Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>
            {isCommon
              ? 'Mark Common Area capture points (Lobby, Corridor, …) and re-analyze this floor to see room-level common finishing.'
              : 'Run the AI progress analysis for this floor first — flat-by-flat detail appears once a room map and captures exist.'}
          </Typography>
        </Box>
      ) : (
        <>
          {!isCommon && (
            <FlatSelector flats={scopedProgress} selected={selectedFlat} onSelect={setSelectedFlat} />
          )}

          {flat && (
            <FlatDetail
              flat={flat}
              isCommon={isCommon}
              canReview={canReview}
              onReview={(room, activity) => setReview({ room, activity })}
              onOpenEvidence={openEvidence}
            />
          )}
        </>
      )}

      <ActivityReviewDialog
        open={!!review && !!snapshot && !!flat}
        activityName={review?.activity.activityName ?? ''}
        target={review && snapshot && flat ? {
          snapshotId: snapshot.snapshotId,
          floorId: snapshot.floorId,
          flatName: flat.flatName,
          roomName: review.room.roomName,
          activityId: review.activity.activityId,
        } : null}
        onClose={() => setReview(null)}
        onSaved={() => load(true)}
      />
    </Box>
  );
}
