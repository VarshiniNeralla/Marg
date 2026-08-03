import React, { useCallback, useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, MenuItem, Select, type SelectChangeEvent } from '@mui/material';
import { ArrowBackRounded, PhotoLibraryRounded, CheckCircleRounded, HourglassTopRounded } from '@mui/icons-material';
import { Link, useParams } from 'react-router-dom';
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
  if (room.activities.length > 0) return colors.warning;
  return colors.textSubdued;
}

function RoomCard({ room, onOpenEvidence }: { room: RoomProgress; onOpenEvidence: (activityName: string, captureIds: string[]) => void }) {
  const color = roomStatusColor(room);
  const hasEvidence = room.activities.length > 0;
  return (
    <Box sx={{ p: 1.75, borderRadius: '12px', backgroundColor: P.white, border: `1.5px solid ${P.border}` }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong, lineHeight: 1.35 }}>
          {room.roomName}
        </Typography>
        <Box sx={{ px: 1, py: 0.25, borderRadius: '6px', flexShrink: 0, backgroundColor: `${color}18`, whiteSpace: 'nowrap' }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color }}>
            {room.isComplete ? 'Completed' : hasEvidence ? 'Work in Progress' : 'No Photos Yet'}
          </Typography>
        </Box>
      </Box>

      {hasEvidence ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {room.activities.map(a => (
            <Box key={a.activityId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: '0.75rem', color: P.muted }}>{a.activityName}</Typography>
                <Box sx={{ height: 4, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden', mt: 0.25 }}>
                  <Box sx={{
                    height: '100%', width: `${a.completionPct}%`,
                    backgroundColor: a.completionPct >= 92 ? colors.success : colors.warning,
                    borderRadius: '999px', transition: `width ${motion.durationSlow} ${motion.easeOut}`,
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
          ))}
        </Box>
      ) : (
        <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
          No captures cover this room yet.
        </Typography>
      )}
    </Box>
  );
}

function FlatOverview({ flat, onOpenEvidence }: { flat: FlatProgress; onOpenEvidence: (activityName: string, captureIds: string[]) => void }) {
  return (
    <Box>
      <Box sx={{
        display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap',
        p: 3, borderRadius: '16px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, mb: 3,
      }}
      >
        <ProgressRing percentage={flat.completionPct} label="Complete" />
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.5 }}>
            {flat.flatName} — Overall Progress
          </Typography>
          <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: P.strong, lineHeight: 1.1 }}>
            {Math.round(flat.completionPct)}%
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1 }}>
            {flat.completionPct >= 100 ? (
              <CheckCircleRounded sx={{ fontSize: 16, color: colors.success }} />
            ) : (
              <HourglassTopRounded sx={{ fontSize: 16, color: colors.warning }} />
            )}
            <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>
              {flat.roomsComplete} of {flat.roomsTotal} rooms fully complete
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: P.muted, mt: 0.5 }}>
            A room counts as complete only once every finishing activity confirmed in it individually
            reaches completion — one finished room does not mark the whole flat done.
          </Typography>
        </Box>
      </Box>

      <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: P.strong, mb: 1.5 }}>
        Room-by-Room Status
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
        {flat.rooms.map(room => (
          <RoomCard key={room.roomName} room={room} onOpenEvidence={onOpenEvidence} />
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

  const load = useCallback(async () => {
    if (!floorId) return;
    setLoading(true);
    try {
      const detail = await constructionProgressService.getFloorDetail(floorId);
      setSnapshot(detail);
      if (detail.flatProgress.length > 0) setSelectedFlat(detail.flatProgress[0].flatName);
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
                {f.flatName} — {Math.round(f.completionPct)}%
              </MenuItem>
            ))}
          </Select>

          {flat && <FlatOverview flat={flat} onOpenEvidence={(activityName, captureIds) => setEvidence({ activityName, captureIds })} />}
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
