import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, Tooltip } from '@mui/material';
import { ArrowBackRounded, WarningAmberRounded } from '@mui/icons-material';
import { Link, useLocation, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { colors, motion } from '@theme/tokens';
import {
  constructionProgressService,
  type EvidenceDetail,
  type FloorProgressSnapshot,
  type FlatProgress,
  type RoomActivityAssessment,
  type RoomProgress,
} from '@/services/constructionProgressService';
import { useAuthStore, isManagerOrAdmin } from '@store/authStore';
import ProgressRing from '@/components/ConstructionProgress/ProgressRing';
import EvidenceLightbox from '@/components/ConstructionProgress/EvidenceLightbox';
import FinishingOverview, { PROGRESS_EXPLAINER } from '@/components/ConstructionProgress/FinishingOverview';
import FlatSelector from '@/components/ConstructionProgress/FlatSelector';
import RoomProgressCard from '@/components/ConstructionProgress/RoomProgressCard';
import ActivityReviewDialog from '@/components/ConstructionProgress/ActivityReviewDialog';
import { ScopeChip } from '@/components/ConstructionProgress/ProgressChips';
import { formatDate } from '@/utils/dateFormat';
import {
  SCOPE_LABELS, countNeedingReview, formatPct, resolveScopeStatus, reviewBannerText, safePct,
} from '@/utils/progressDisplay';
import type { ScopeStatus } from '@/services/constructionProgressService';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

const SECTION_ORDER: ScopeStatus[] = ['in_progress', 'awaiting_evidence', 'completed', 'not_started', 'no_photos'];

function isCommonArea(f: FlatProgress): boolean {
  return f.flatName === 'Common Area';
}

interface EvidenceState { activityName: string; captureIds: string[]; details: EvidenceDetail[] }
interface ReviewState { room: RoomProgress; activity: RoomActivityAssessment }

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: P.muted }}>{label}</Typography>
      <Typography sx={{ fontSize: '1.125rem', fontWeight: 800, color: P.strong }}>{value}</Typography>
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
  onOpenEvidence: (activityName: string, captureIds: string[], details: EvidenceDetail[]) => void;
}) {
  const scope = resolveScopeStatus(flat);
  const completed = scope === 'completed' || !!flat.isFullyComplete;
  const verified = safePct(flat.completionPct, completed);
  const needReview = countNeedingReview(flat.rooms.flatMap(r => r.activities));
  const unit = isCommon ? 'regions' : 'rooms';

  const sections = SECTION_ORDER
    .map(status => ({ status, rooms: flat.rooms.filter(r => resolveScopeStatus(r) === status) }))
    .filter(s => s.rooms.length > 0);

  return (
    <Box>
      <Box sx={{
        display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap',
        p: { xs: 2, sm: 3 }, borderRadius: '16px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, mb: 2,
      }}
      >
        <ProgressRing percentage={verified} label="Verified" />
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.5 }}>
            {flat.flatName}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
            <Tooltip title={PROGRESS_EXPLAINER} arrow enterTouchDelay={0}>
              <Typography tabIndex={0} sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.muted, cursor: 'help' }}>
                Verified progress
              </Typography>
            </Tooltip>
            <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: P.strong, lineHeight: 1.1 }}>{verified}%</Typography>
            <ScopeChip status={scope} />
          </Box>
          <Box sx={{ display: 'flex', gap: { xs: 2, sm: 3 }, flexWrap: 'wrap', mt: 1.25 }}>
            {typeof flat.estimatePct === 'number' && <Metric label="Estimate on observed work" value={formatPct(flat.estimatePct)} />}
            {typeof flat.coveragePct === 'number' && <Metric label="Coverage" value={formatPct(flat.coveragePct)} />}
            <Metric label={`${isCommon ? 'Regions' : 'Rooms'} complete`} value={`${flat.roomsComplete} of ${flat.roomsTotal}`} />
            {typeof flat.roomsPhotographed === 'number' && <Metric label="Photographed" value={String(flat.roomsPhotographed)} />}
            {typeof flat.roomsRequired === 'number' && <Metric label="Required" value={String(flat.roomsRequired)} />}
            {flat.lastInspection && <Metric label="Last inspection" value={formatDate(flat.lastInspection)} />}
          </Box>
        </Box>
      </Box>

      {needReview > 0 && (
        <Box
          role="status"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, mb: 2, borderRadius: '12px', backgroundColor: colors.dangerBg }}
        >
          <WarningAmberRounded sx={{ fontSize: 18, color: colors.danger }} />
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.danger }}>{reviewBannerText(needReview)}</Typography>
        </Box>
      )}

      <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: P.strong, mb: 0.5 }}>
        {isCommon ? 'Region-by-Region Status' : 'Room-by-Room Status'}
      </Typography>
      <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mb: 2 }}>
        Showing all {flat.rooms.length} {unit} in {flat.flatName}
      </Typography>

      {sections.map((section, idx) => (
        <Box key={section.status} sx={{ mt: idx === 0 ? 0 : 3 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: P.strong, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 1.25 }}>
            {SCOPE_LABELS[section.status]} <Box component="span" sx={{ color: P.muted }}>{section.rooms.length}</Box>
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: { xs: 1, sm: 1.25 }, alignItems: 'stretch' }}>
            {section.rooms.map((room, i) => (
              <RoomProgressCard
                key={`${room.roomName}-${i}`}
                room={room}
                canReview={canReview}
                onReview={onReview}
                onOpenEvidence={onOpenEvidence}
              />
            ))}
          </Box>
        </Box>
      ))}
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
  const [evidence, setEvidence] = useState<EvidenceState | null>(null);
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
  const summary = isCommon ? snapshot?.commonFinishing : snapshot?.flatFinishing;
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
          <FinishingOverview summary={summary} isCommon={isCommon} />

          {!isCommon && (
            <FlatSelector flats={scopedProgress} selected={selectedFlat} onSelect={setSelectedFlat} />
          )}

          {flat && (
            <FlatDetail
              flat={flat}
              isCommon={isCommon}
              canReview={canReview}
              onReview={(room, activity) => setReview({ room, activity })}
              onOpenEvidence={(activityName, captureIds, details) => setEvidence({ activityName, captureIds, details })}
            />
          )}
        </>
      )}

      {evidence && (
        <EvidenceLightbox
          activityName={evidence.activityName}
          captureIds={evidence.captureIds}
          details={evidence.details.length > 0 ? evidence.details : undefined}
          onClose={() => setEvidence(null)}
        />
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
