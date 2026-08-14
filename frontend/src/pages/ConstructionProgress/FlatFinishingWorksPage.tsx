import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, MenuItem, Select, type SelectChangeEvent, Collapse } from '@mui/material';
import {
  ArrowBackRounded,
  PhotoLibraryRounded,
  CheckCircleRounded,
  HourglassTopRounded,
  ExpandMoreRounded,
  NoPhotographyRounded,
  PushPinRounded,
  InfoRounded,
  BedroomParentRounded,
  KitchenRounded,
  WcRounded,
  BalconyRounded,
  WeekendRounded,
  DoorFrontRounded,
  Inventory2Rounded,
  CheckroomRounded,
  SelfImprovementRounded,
  DeckRounded,
  LocalLaundryServiceRounded,
  HomeRounded,
  TableRestaurantRounded,
  ElectricalServicesRounded,
} from '@mui/icons-material';
import { Link, useLocation, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { colors, motion } from '@theme/tokens';
import {
  constructionProgressService,
  type FloorProgressSnapshot,
  type FlatProgress,
  type RoomProgress,
} from '@/services/constructionProgressService';
import ProgressRing from '@/components/ConstructionProgress/ProgressRing';
import EvidenceLightbox from '@/components/ConstructionProgress/EvidenceLightbox';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff', bg: '#f7f8fa' };

function roomStatusColor(room: RoomProgress): string {
  if (room.isComplete) return colors.success;
  if (room.activities.length > 0 || (room.capturesCount ?? 0) > 0 || (room.pinNumbers?.length ?? 0) > 0) {
    return colors.warning;
  }
  return colors.textSubdued;
}

type RoomStatusLabel = 'Completed' | 'Work in Progress' | 'No Photos Yet';

function roomStatusLabel(room: RoomProgress): RoomStatusLabel {
  if (room.isComplete) return 'Completed';
  const hasEvidence = room.activities.length > 0;
  const hasCaptures = (room.capturesCount ?? 0) > 0 || (room.pinNumbers?.length ?? 0) > 0;
  return hasEvidence || hasCaptures ? 'Work in Progress' : 'No Photos Yet';
}

/** Maps a room name to a representative icon — gives each card a distinct silhouette at a glance. */
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

/** Mean per-room work progress over the FULL roster; uncaptured rooms = 0%. */
function flatWorkProgressPct(flat: FlatProgress): number {
  if (flat.isFullyComplete) return 100;
  // Prefer server rollup (already full-roster) when present.
  if (typeof flat.completionPct === 'number' && Number.isFinite(flat.completionPct)) {
    return Math.round(flat.completionPct);
  }
  const rooms = flat.rooms;
  if (rooms.length === 0) return 0;
  const sum = rooms.reduce((n, r) => {
    const hasCap =
      r.activities.length > 0
      || (r.capturesCount ?? 0) > 0
      || (r.pinNumbers?.length ?? 0) > 0
      || r.isComplete;
    if (!hasCap) return n;
    const p = roomCompletionPct(r);
    return n + (p ?? 0);
  }, 0);
  const required = flat.roomsRequired ?? rooms.length;
  const avg = Math.round(sum / Math.max(required, rooms.length));
  const covered = flat.roomsPhotographed ?? rooms.filter(
    r => r.activities.length > 0 || (r.capturesCount ?? 0) > 0 || (r.pinNumbers?.length ?? 0) > 0,
  ).length;
  if (covered < required && avg >= 100) return 99;
  return avg;
}

function statusIcon(statusLabel: RoomStatusLabel) {
  if (statusLabel === 'Completed') return CheckCircleRounded;
  if (statusLabel === 'Work in Progress') return HourglassTopRounded;
  return NoPhotographyRounded;
}

function RoomCard({
  room,
  onOpenEvidence,
}: {
  room: RoomProgress;
  flatName: string;
  onOpenEvidence: (activityName: string, captureIds: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = roomStatusColor(room);
  const hasEvidence = room.activities.length > 0;
  const hasCaptures = (room.capturesCount ?? 0) > 0 || (room.pinNumbers?.length ?? 0) > 0;
  const isActive = hasEvidence || hasCaptures || room.isComplete;
  const pinLabel = room.pinNumbers?.length
    ? `Pin${room.pinNumbers.length === 1 ? '' : 's'} ${room.pinNumbers.join(', ')}`
    : null;
  const pct = roomCompletionPct(room);
  const RoomIcon = roomTypeIcon(room.roomName);
  const canExpand = hasEvidence;
  const unscoredCaptureCount = room.capturesCount ?? room.pinNumbers?.length ?? 0;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        backgroundColor: isActive ? P.white : P.bg,
        border: `1px solid ${isActive ? P.border : colors.borderLight}`,
        borderStyle: isActive ? 'solid' : 'dashed',
        overflow: 'hidden',
        // Expanded cards take the full row so the neighbour isn't left with a hole.
        gridColumn: expanded ? '1 / -1' : 'auto',
        transition: `box-shadow ${motion.durationFast} ${motion.easeOut}, transform ${motion.durationFast} ${motion.easeOut}`,
        '&:hover': isActive ? { boxShadow: '0 6px 18px rgba(15,23,42,0.07)', transform: 'translateY(-1px)' } : undefined,
      }}
    >
      <Box sx={{ p: { xs: 1.5, sm: 1.75 }, pb: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
          <Box
            sx={{
              width: 38, height: 38, borderRadius: '11px', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: `${color}15`,
            }}
          >
            <RoomIcon sx={{ fontSize: 20, color }} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong, lineHeight: 1.35 }}>
              {room.roomName}
            </Typography>
            {pinLabel && (
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, mt: 0.375 }}>
                <PushPinRounded sx={{ fontSize: 12, color: colors.primary }} />
                <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.primary }}>
                  {pinLabel}
                </Typography>
              </Box>
            )}
            <Box
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.75,
                px: 0.875, py: 0.25, borderRadius: '999px', backgroundColor: `${color}18`,
              }}
            >
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color }} />
              <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color }}>
                {roomStatusLabel(room)}
              </Typography>
            </Box>
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
                    backgroundImage: pct == null
                      ? 'none'
                      : `linear-gradient(90deg, ${pct >= 92 ? colors.success : pct > 0 ? colors.warning : colors.borderLight}cc, ${pct >= 92 ? colors.success : pct > 0 ? colors.warning : colors.borderLight})`,
                    backgroundColor: pct == null ? colors.borderLight : undefined,
                    borderRadius: '999px',
                    transition: `width ${motion.durationSlow} ${motion.easeOut}`,
                  }}
                />
              </Box>
              {!hasEvidence && hasCaptures && (
                <Box sx={{ display: 'flex', gap: 0.625, mt: 0.875, p: 0.75, borderRadius: '8px', backgroundColor: `${colors.warning}12` }}>
                  <InfoRounded sx={{ fontSize: 14, color: colors.warning, flexShrink: 0, mt: '1px' }} />
                  <Typography sx={{ fontSize: '0.6875rem', color: P.muted, lineHeight: 1.4 }}>
                    {unscoredCaptureCount} capture{unscoredCaptureCount === 1 ? '' : 's'} mapped — photo could not be
                    scored (blank/corrupt image, or finishing finishes not confidently visible). Re-upload a clear
                    photo or re-analyze if needed.
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
              No captures cover this room yet.
            </Typography>
          )}
        </Box>
      </Box>

      {/* Footer: expand toggle only (review hidden for now) */}
      {(canExpand) && (
        <Box
          sx={{
            mt: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75,
            px: { xs: 1.5, sm: 1.75 }, py: 1, borderTop: `1px solid ${isActive ? colors.borderLight : 'transparent'}`,
          }}
        >
          <Box
            onClick={() => setExpanded(v => !v)}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.25, cursor: 'pointer', userSelect: 'none',
              color: P.muted, '&:hover': { color: colors.primary },
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>
              {expanded ? 'Hide details' : 'Show details'}
            </Typography>
            <ExpandMoreRounded
              sx={{
                fontSize: 18,
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: `transform ${motion.durationFast} ${motion.easeOut}`,
              }}
            />
          </Box>
        </Box>
      )}

      {/* Expanded: per-activity bars */}
      <Collapse in={expanded && canExpand} timeout={200}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, px: { xs: 1.5, sm: 1.75 }, pb: 1.75, pt: 1.25, borderTop: `1px solid ${P.border}` }}>
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
                    onClick={() => onOpenEvidence(a.activityName, a.evidenceCaptureIds)}
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

type IconComponent = ReturnType<typeof statusIcon>;

function StatPill({ icon: Icon, count, label, color }: { icon: IconComponent; count: number; label: string; color: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.625, borderRadius: '10px', backgroundColor: `${color}12` }}>
      <Icon sx={{ fontSize: 15, color }} />
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color }}>{count}</Typography>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: P.muted }}>{label}</Typography>
    </Box>
  );
}

function SectionHeader({ label, count, color, icon: Icon }: { label: string; count: number; color: string; icon: IconComponent }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.875, mb: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
        <Icon sx={{ fontSize: 16, color }} />
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: P.strong, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.muted }}>
          {count}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, height: '1px', backgroundColor: colors.borderLight }} />
    </Box>
  );
}

function FlatOverview({
  flat,
  onOpenEvidence,
}: {
  flat: FlatProgress;
  onOpenEvidence: (activityName: string, captureIds: string[]) => void;
}) {
  const workPct = flatWorkProgressPct(flat);

  const sections: { label: RoomStatusLabel; color: string; rooms: RoomProgress[] }[] = [
    { label: 'Work in Progress', color: colors.warning, rooms: [] },
    { label: 'Completed', color: colors.success, rooms: [] },
    { label: 'No Photos Yet', color: colors.textSubdued, rooms: [] },
  ];
  const sectionByLabel = new Map(sections.map(s => [s.label, s]));
  flat.rooms.forEach(room => sectionByLabel.get(roomStatusLabel(room))?.rooms.push(room));
  const activeSections = sections.filter(s => s.rooms.length > 0);

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
              {(flat.roomsPhotographed ?? 0) > 0
                ? ` · ${flat.roomsPhotographed} photographed`
                : ''}
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: P.muted, mt: 0.5 }}>
            Progress averages every room on the roster — rooms with no photos count as 0%.
            A room is fully complete only when every confirmed finishing activity in it reaches completion.
          </Typography>
        </Box>
      </Box>

      <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: P.strong, mb: 0.5 }}>
        Room-by-Room Status
      </Typography>
      <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mb: 1.5 }}>
        Showing all {flat.rooms.length} rooms in {flat.flatName}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 3 }}>
        {activeSections.map(section => (
          <StatPill key={section.label} icon={statusIcon(section.label)} count={section.rooms.length} label={section.label} color={section.color} />
        ))}
      </Box>

      {activeSections.map((section, sIdx) => (
        <Box key={section.label} sx={{ mt: sIdx === 0 ? 0 : 3.5 }}>
          <SectionHeader label={section.label} count={section.rooms.length} color={section.color} icon={statusIcon(section.label)} />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
              gap: { xs: 1, sm: 1.25 },
              alignItems: 'stretch',
            }}
          >
            {section.rooms.map((room, idx) => (
              <RoomCard
                key={`${room.roomName}-${idx}`}
                room={room}
                flatName={flat.flatName}
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
  const scope: 'flat' | 'common' = location.pathname.endsWith('/common') ? 'common' : 'flat';
  const isCommon = scope === 'common';
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<FloorProgressSnapshot | null>(null);
  const [selectedFlat, setSelectedFlat] = useState<string>('');
  const [evidence, setEvidence] = useState<{ activityName: string; captureIds: string[] } | null>(null);

  const scopedProgress = useMemo(() => {
    const all = snapshot?.flatProgress ?? [];
    return isCommon
      ? all.filter(f => f.flatName === 'Common Area')
      : all.filter(f => f.flatName !== 'Common Area');
  }, [snapshot, isCommon]);

  const load = useCallback(async () => {
    if (!floorId) return;
    setLoading(true);
    try {
      const detail = await constructionProgressService.getFloorDetail(floorId);
      setSnapshot(detail);
      if (!detail) {
        setSelectedFlat('');
        return;
      }
      const pool = isCommon
        ? detail.flatProgress.filter(f => f.flatName === 'Common Area')
        : detail.flatProgress.filter(f => f.flatName !== 'Common Area');
      if (pool.length > 0) {
        const scored = pool.map(f => ({
          name: f.flatName,
          score: f.rooms.reduce(
            (n, r) => n + (r.capturesCount ?? 0) + (r.pinNumbers?.length ?? 0),
            0,
          ),
        }));
        scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
        setSelectedFlat(scored[0]?.name || pool[0].flatName);
      } else {
        setSelectedFlat('');
      }
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        setSnapshot(null);
        setSelectedFlat('');
      } else {
        toast.error(isCommon
          ? 'Failed to load common area finishing works'
          : 'Failed to load flat finishing works');
      }
    } finally {
      setLoading(false);
    }
  }, [floorId, isCommon]);

  useEffect(() => {
    load();
  }, [load]);

  const flat = scopedProgress.find(f => f.flatName === selectedFlat) ?? null;
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
          {pageTitle}
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          {pageSubtitle}
        </Typography>
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
            <Select
              value={selectedFlat}
              onChange={(e: SelectChangeEvent) => setSelectedFlat(e.target.value)}
              sx={{
                mb: 3, minWidth: 220, borderRadius: '10px', backgroundColor: P.white,
                fontSize: '0.875rem', fontWeight: 600,
              }}
              size="small"
            >
              {scopedProgress.map(f => (
                <MenuItem key={f.flatName} value={f.flatName}>
                  {f.flatName} — {flatWorkProgressPct(f)}% · {f.roomsTotal} rooms
                  {f.roomsComplete > 0 ? ` · ${f.roomsComplete} complete` : ''}
                </MenuItem>
              ))}
            </Select>
          )}

          {flat && (
            <FlatOverview
              flat={flat}
              onOpenEvidence={(activityName, captureIds) => setEvidence({ activityName, captureIds })}
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
    </Box>
  );
}
