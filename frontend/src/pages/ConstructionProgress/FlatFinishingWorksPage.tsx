import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, MenuItem, Select, type SelectChangeEvent, Collapse, IconButton } from '@mui/material';
import {
  ArrowBackRounded,
  PhotoLibraryRounded,
  CheckCircleRounded,
  HourglassTopRounded,
  ExpandMoreRounded,
} from '@mui/icons-material';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { colors, motion } from '@theme/tokens';
import {
  constructionProgressService,
  type FloorProgressSnapshot,
  type FlatProgress,
  type RoomProgress,
  type ProgressReview,
} from '@/services/constructionProgressService';
import ProgressRing from '@/components/ConstructionProgress/ProgressRing';
import EvidenceLightbox from '@/components/ConstructionProgress/EvidenceLightbox';
import ProgressReviewDialog, { type ReviewTarget } from '@/components/ConstructionProgress/ProgressReviewDialog';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff', bg: '#f7f8fa' };

function roomStatusColor(room: RoomProgress): string {
  if (room.isComplete) return colors.success;
  if (room.activities.length > 0 || (room.capturesCount ?? 0) > 0 || (room.pinNumbers?.length ?? 0) > 0) {
    return colors.warning;
  }
  return colors.textSubdued;
}

function roomCompletionPct(room: RoomProgress): number | null {
  if (room.isComplete) return 100;
  // Activities list is typically partial (only detected / scored items), not
  // the full applicable roster — averaging it alone can falsely read as 100%
  // when only a few of ~39 activities were assessed.
  const scorable = room.activities.filter(a => a.status !== 'not_observable');
  if (scorable.length === 0) {
    // All not_observable: not "0% complete" and not "100%" — no observable
    // finishing score applies. Caller should treat null as N/A.
    if (room.activities.length > 0) return null;
    return 0;
  }
  const avg = Math.round(scorable.reduce((n, a) => n + a.completionPct, 0) / scorable.length);
  // Partial list cannot prove the room is done — only isComplete can.
  return Math.min(avg, 99);
}

function reviewKey(flatName: string, roomName: string) {
  return `${flatName}::${roomName}`;
}

/** Mean per-room work progress over photographed rooms only (v4.4). */
function flatWorkProgressPct(flat: FlatProgress): number {
  if (flat.isFullyComplete) return 100;
  const photographed = flat.rooms.filter(
    (r) =>
      r.activities.length > 0
      || (r.capturesCount ?? 0) > 0
      || (r.pinNumbers?.length ?? 0) > 0
      || r.isComplete,
  );
  if (photographed.length === 0) return 0;
  const sum = photographed.reduce((n, r) => {
    const p = roomCompletionPct(r);
    return n + (p ?? 0);
  }, 0);
  const avg = Math.round(sum / photographed.length);
  const required = flat.roomsRequired ?? flat.rooms.length;
  const covered = flat.roomsPhotographed ?? photographed.length;
  // Cannot read fully complete until all required areas are covered.
  if (covered < required && avg >= 100) return 99;
  return avg;
}

function RoomCard({
  room,
  flatName,
  reviewed,
  onOpenEvidence,
  onReview,
}: {
  room: RoomProgress;
  flatName: string;
  reviewed: boolean;
  onOpenEvidence: (activityName: string, captureIds: string[]) => void;
  onReview: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = roomStatusColor(room);
  const hasEvidence = room.activities.length > 0;
  const hasCaptures = (room.capturesCount ?? 0) > 0 || (room.pinNumbers?.length ?? 0) > 0;
  const pinLabel = room.pinNumbers?.length
    ? `Pin${room.pinNumbers.length === 1 ? '' : 's'} ${room.pinNumbers.join(', ')}`
    : null;
  const pct = roomCompletionPct(room);
  const statusLabel = room.isComplete
    ? 'Completed'
    : hasEvidence || hasCaptures
      ? 'Work in Progress'
      : 'No Photos Yet';
  const canExpand = hasEvidence;

  return (
    <Box
      sx={{
        p: 1.75,
        borderRadius: '12px',
        backgroundColor: P.white,
        border: `1.5px solid ${reviewed ? colors.success : P.border}`,
        // Expanded cards take the full row so the neighbour isn't left with a hole.
        gridColumn: expanded ? '1 / -1' : 'auto',
        opacity: reviewed ? 1 : hasCaptures || hasEvidence ? 1 : 0.92,
        boxShadow: reviewed ? 'none' : (hasCaptures || hasEvidence ? '0 0 0 1px rgba(37,99,235,0.08)' : 'none'),
      }}
    >
      <Box
        onClick={canExpand ? () => setExpanded(v => !v) : undefined}
        sx={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1,
          cursor: canExpand ? 'pointer' : 'default',
          userSelect: canExpand ? 'none' : 'auto',
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong, lineHeight: 1.35 }}>
            {room.roomName}
          </Typography>
          {pinLabel && (
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.primary, mt: 0.25 }}>
              {pinLabel}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          {reviewed ? (
            <Box sx={{ px: 1, py: 0.25, borderRadius: '6px', backgroundColor: `${colors.success}18` }}>
              <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.success }}>Reviewed</Typography>
            </Box>
          ) : (
            <Box sx={{ px: 1, py: 0.25, borderRadius: '6px', backgroundColor: `${colors.primary}12` }}>
              <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.primary }}>Unreviewed</Typography>
            </Box>
          )}
          <Box sx={{ px: 1, py: 0.25, borderRadius: '6px', backgroundColor: `${color}18`, whiteSpace: 'nowrap' }}>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color }}>
              {statusLabel}
            </Typography>
          </Box>
          {canExpand && (
            <IconButton
              size="small"
              aria-label={expanded ? 'Hide activity details' : 'Show activity details'}
              onClick={e => {
                e.stopPropagation();
                setExpanded(v => !v);
              }}
              sx={{
                p: 0.25,
                color: P.muted,
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: `transform ${motion.durationFast} ${motion.easeOut}`,
              }}
            >
              <ExpandMoreRounded sx={{ fontSize: 20 }} />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Collapsed summary: overall room progress */}
      <Box sx={{ mt: 1.25 }}>
        {(hasEvidence || hasCaptures || room.isComplete) ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
              <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
                Room progress
                {hasEvidence ? ` · ${room.activities.length} activit${room.activities.length === 1 ? 'y' : 'ies'}` : ''}
              </Typography>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 800, color: P.strong }}>
                {pct == null ? 'N/A' : `${pct}%`}
              </Typography>
            </Box>
            <Box sx={{ height: 6, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden' }}>
              <Box
                sx={{
                  height: '100%',
                  width: `${pct ?? 0}%`,
                  backgroundColor: pct == null ? colors.borderLight : pct >= 92 ? colors.success : pct > 0 ? colors.warning : colors.borderLight,
                  borderRadius: '999px',
                  transition: `width ${motion.durationSlow} ${motion.easeOut}`,
                }}
              />
            </Box>
          </>
        ) : (
          <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
            No captures cover this room yet.
          </Typography>
        )}
        {!hasEvidence && hasCaptures && (
          <Typography sx={{ fontSize: '0.6875rem', color: P.muted, mt: 0.75 }}>
            {(room.capturesCount ?? room.pinNumbers?.length ?? 0)} capture
            {(room.capturesCount ?? room.pinNumbers?.length ?? 0) === 1 ? '' : 's'} mapped
            — photo could not be scored (blank/corrupt image, or finishing finishes not
            confidently visible). Re-upload a clear photo or re-analyze if needed.
          </Typography>
        )}
      </Box>

      <Box sx={{ mt: 1.25, display: 'flex', gap: 0.75 }}>
        <Box
          onClick={e => {
            e.stopPropagation();
            onReview();
          }}
          sx={{
            display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, borderRadius: '8px',
            border: `1.5px solid ${P.border}`, fontSize: '0.75rem', fontWeight: 600, color: P.muted,
            cursor: 'pointer', '&:hover': { borderColor: colors.primary, color: colors.primary },
          }}
        >
          Review
        </Box>
      </Box>

      {/* Expanded: per-activity bars */}
      <Collapse in={expanded && canExpand} timeout={200}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1.5, pt: 1.25, borderTop: `1px solid ${P.border}` }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.25 }}>
            Activity detail
          </Typography>
          {room.activities.map(a => (
            <Box key={a.activityId} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.75rem', color: P.muted }}>{a.activityName}</Typography>
                  <Box sx={{ height: 4, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden', mt: 0.25 }}>
                    <Box
                      sx={{
                        height: '100%', width: `${a.completionPct}%`,
                        backgroundColor: a.completionPct >= 92 ? colors.success : colors.warning,
                        borderRadius: '999px',
                      }}
                    />
                  </Box>
                </Box>
                <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: P.strong, minWidth: 32, textAlign: 'right' }}>
                  {Math.round(a.completionPct)}%
                </Typography>
                {a.evidenceCaptureIds.length > 0 && (
                  <Box
                    onClick={e => {
                      e.stopPropagation();
                      onOpenEvidence(a.activityName, a.evidenceCaptureIds);
                    }}
                    sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: colors.primary, '&:hover': { opacity: 0.75 } }}
                  >
                    <PhotoLibraryRounded sx={{ fontSize: 15 }} />
                  </Box>
                )}
              </Box>
              {a.evidence ? (
                <Typography sx={{ fontSize: '0.6875rem', color: P.muted, pl: 0.25, lineHeight: 1.35 }}>
                  {a.evidence}
                </Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function FlatOverview({
  flat,
  reviewedKeys,
  onOpenEvidence,
  onReviewRoom,
}: {
  flat: FlatProgress;
  reviewedKeys: Set<string>;
  onOpenEvidence: (activityName: string, captureIds: string[]) => void;
  onReviewRoom: (room: RoomProgress) => void;
}) {
  const workPct = flatWorkProgressPct(flat);
  return (
    <Box>
      <Box sx={{
        display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap',
        p: 3, borderRadius: '16px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, mb: 3,
      }}
      >
        <ProgressRing percentage={workPct} label="Progress" />
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.5 }}>
            {flat.flatName} — Overall Progress
          </Typography>
          <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: P.strong, lineHeight: 1.1 }}>
            {workPct}%
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1 }}>
            {flat.roomsComplete >= flat.roomsTotal && flat.roomsTotal > 0 ? (
              <CheckCircleRounded sx={{ fontSize: 16, color: colors.success }} />
            ) : (
              <HourglassTopRounded sx={{ fontSize: 16, color: colors.warning }} />
            )}
            <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>
              {flat.roomsComplete} of {flat.roomsTotal} rooms fully complete
              {workPct > 0 && flat.roomsComplete === 0
                ? ' · ring shows average room progress (none fully done yet)'
                : ''}
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: P.muted, mt: 0.5 }}>
            A room counts as fully complete only once every finishing activity confirmed in it
            individually reaches completion — one finished room does not mark the whole flat done.
          </Typography>
        </Box>
      </Box>

      <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: P.strong, mb: 0.5 }}>
        Room-by-Room Status
      </Typography>
      <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mb: 1.5 }}>
        Showing all {flat.rooms.length} rooms in {flat.flatName}
        {' '}({flat.rooms.filter(r => (r.capturesCount ?? 0) > 0 || (r.pinNumbers?.length ?? 0) > 0).length} with captures)
        {' · '}{flat.rooms.filter(r => reviewedKeys.has(reviewKey(flat.flatName, r.roomName))).length} reviewed
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25, alignItems: 'start' }}>
        {flat.rooms.map((room, idx) => (
          <RoomCard
            key={`${room.roomName}-${idx}`}
            room={room}
            flatName={flat.flatName}
            reviewed={reviewedKeys.has(reviewKey(flat.flatName, room.roomName))}
            onOpenEvidence={onOpenEvidence}
            onReview={() => onReviewRoom(room)}
          />
        ))}
      </Box>
    </Box>
  );
}

export default function FlatFinishingWorksPage() {
  const { floorId } = useParams<{ floorId: string }>();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<FloorProgressSnapshot | null>(null);
  const [selectedFlat, setSelectedFlat] = useState<string>('');
  const [evidence, setEvidence] = useState<{ activityName: string; captureIds: string[] } | null>(null);
  const [reviews, setReviews] = useState<ProgressReview[]>([]);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);

  const load = useCallback(async () => {
    if (!floorId) return;
    setLoading(true);
    try {
      const [detail, existingReviews] = await Promise.all([
        constructionProgressService.getFloorDetail(floorId),
        constructionProgressService.listReviews({ floorId }),
      ]);
      setSnapshot(detail);
      setReviews(existingReviews);
      if (detail.flatProgress.length > 0) {
        // Prefer the flat with the most mapped captures (Floor 4 → Flat 04),
        // otherwise first residential flat in the list.
        const scored = detail.flatProgress.map(f => ({
          name: f.flatName,
          score: f.rooms.reduce(
            (n, r) => n + (r.capturesCount ?? 0) + (r.pinNumbers?.length ?? 0),
            0,
          ),
        }));
        scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
        setSelectedFlat(scored[0]?.name || detail.flatProgress[0].flatName);
      }
    } catch {
      toast.error('Failed to load flat finishing works');
    } finally {
      setLoading(false);
    }
  }, [floorId]);

  useEffect(() => {
    load();
  }, [load]);

  const flat = snapshot?.flatProgress.find(f => f.flatName === selectedFlat) ?? null;
  const reviewedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of reviews) {
      if (snapshot && r.snapshotId === snapshot.snapshotId) {
        keys.add(reviewKey(r.flatName, r.roomName));
      }
    }
    return keys;
  }, [reviews, snapshot]);

  const reviewRoomOptions = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.flatProgress.flatMap(f =>
      f.rooms.map(r => ({ flatName: f.flatName, roomName: r.roomName })),
    );
  }, [snapshot]);

  return (
    <Box sx={{ maxWidth: 1080, mx: 'auto', px: { xs: 2, sm: 3 }, py: 4 }}>
      <Box sx={{ mb: { xs: 3, md: 4 } }}>
        <Box component={Link} to={floorId ? `/construction-progress/${floorId}` : '/construction-progress'} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
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
          Flat Finishing Works
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          {snapshot ? `${snapshot.floorName} — select a flat to see its own completion status.` : 'Loading…'}
        </Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress size={28} sx={{ color: colors.primary }} />
        </Box>
      ) : !snapshot || snapshot.flatProgress.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 1 }}>
            No flat data available yet
          </Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>
            Run the AI progress analysis for this floor first — flat-by-flat detail appears once a room map and captures exist.
          </Typography>
        </Box>
      ) : (
        <>
          <Select
            value={selectedFlat}
            onChange={(e: SelectChangeEvent) => setSelectedFlat(e.target.value)}
            sx={{
              mb: 3, minWidth: 220, borderRadius: '10px', backgroundColor: P.white,
              fontSize: '0.875rem', fontWeight: 600,
            }}
            size="small"
          >
            {snapshot.flatProgress.map(f => (
              <MenuItem key={f.flatName} value={f.flatName}>
                {f.flatName} — {flatWorkProgressPct(f)}% · {f.roomsTotal} rooms
                {f.roomsComplete > 0 ? ` · ${f.roomsComplete} complete` : ''}
              </MenuItem>
            ))}
          </Select>

          {flat && (
            <FlatOverview
              flat={flat}
              reviewedKeys={reviewedKeys}
              onOpenEvidence={(activityName, captureIds) => setEvidence({ activityName, captureIds })}
              onReviewRoom={(room) => setReviewTarget({
                snapshotId: snapshot.snapshotId,
                floorId: snapshot.floorId,
                flatName: flat.flatName,
                room,
              })}
            />
          )}
        </>
      )}

      {evidence && (
        <EvidenceLightbox
          activityName={evidence.activityName}
          captureIds={evidence.captureIds}
          onClose={() => setEvidence(null)}
        />
      )}

      <ProgressReviewDialog
        open={!!reviewTarget}
        target={reviewTarget}
        liveSnapshotId={snapshot?.snapshotId}
        roomOptions={reviewRoomOptions}
        onClose={() => setReviewTarget(null)}
        onSubmitted={(key) => {
          setReviews(prev => [
            ...prev,
            {
              reviewId: `local-${key}`,
              orgId: '',
              snapshotId: snapshot?.snapshotId ?? '',
              floorId: snapshot?.floorId ?? '',
              flatName: key.split('::')[0] ?? '',
              roomName: key.split('::')[1] ?? '',
              roomCorrect: 'yes',
              progressVerdict: 'correct',
              reviewedBy: '',
              model: '',
              promptVersion: '',
              rigVersion: null,
              createdAt: new Date().toISOString(),
            },
          ]);
        }}
      />
    </Box>
  );
}
