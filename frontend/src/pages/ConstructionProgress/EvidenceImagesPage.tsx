import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Chip, CircularProgress, Typography } from '@mui/material';
import { ArrowBackRounded } from '@mui/icons-material';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import apiClient from '@/services/apiClient';
import type { ApiResponse } from '@/types/dto';
import {
  constructionProgressService,
  type FloorProgressSnapshot,
} from '@/services/constructionProgressService';
import EvidencePanoramaCard from '@/components/ConstructionProgress/EvidencePanoramaCard';
import { collectEvidence, roomKey, roomsOf } from '@/utils/evidenceImages';
import { panoramaSourceOf, type PanoramaSource, type RawCapture } from '@/utils/panoramaSource';

const P = { muted: '#6b7280', strong: '#111827' };
/** How many capture records are fetched at the same time. */
const FETCH_BATCH = 6;

type SourceState = PanoramaSource | 'missing';

export default function EvidenceImagesPage() {
  const { floorId } = useParams<{ floorId: string }>();
  const [params] = useSearchParams();
  const activityId = params.get('activity') ?? '';
  const flat = params.get('flat') || undefined;
  const room = params.get('room') || undefined;
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [snapshot, setSnapshot] = useState<FloorProgressSnapshot | null>(null);
  const [sources, setSources] = useState<Record<string, SourceState>>({});
  const [roomFilter, setRoomFilter] = useState('all');

  useEffect(() => {
    if (!floorId) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    constructionProgressService.getFloorDetail(floorId)
      .then(detail => { if (!cancelled) setSnapshot(detail); })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number; response?: { status?: number } })?.status
          ?? (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) setSnapshot(null); // legacy "not analysed"
        else setFailed(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [floorId]);

  const collected = useMemo(
    () => collectEvidence(snapshot, activityId, { flat, room }),
    [snapshot, activityId, flat, room],
  );
  const ids = useMemo(() => collected.items.map(i => i.captureId), [collected]);

  // Fetch the capture records a few at a time; cards fill in as they arrive.
  useEffect(() => {
    let cancelled = false;
    const todo = ids.filter(id => !(id in sources));
    if (todo.length === 0) return;
    void (async () => {
      for (let i = 0; i < todo.length; i += FETCH_BATCH) {
        const batch = todo.slice(i, i + FETCH_BATCH);
        const results = await Promise.all(batch.map(async id => {
          try {
            const res = await apiClient.get<ApiResponse<RawCapture>>(`/captures/${id}`);
            const cap = res.data.data ?? null;
            return [id, cap ? panoramaSourceOf(cap) : 'missing'] as [string, SourceState];
          } catch {
            return [id, 'missing'] as [string, SourceState];
          }
        }));
        if (cancelled) return;
        setSources(prev => ({ ...prev, ...Object.fromEntries(results) }));
      }
    })();
    return () => { cancelled = true; };
    // `sources` is read only to skip ids already fetched; re-running on every arrival would cancel the batch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const rooms = useMemo(() => roomsOf(collected.items), [collected]);
  const visible = useMemo(
    () => (roomFilter === 'all' ? collected.items : collected.items.filter(i => roomKey(i) === roomFilter)),
    [collected, roomFilter],
  );
  const missingCount = visible.filter(i => sources[i.captureId] === 'missing').length;
  const shown = visible.filter(i => sources[i.captureId] !== 'missing');

  const fallbackPath = floorId ? `/construction-progress/${floorId}` : '/construction-progress';
  const goBack = useCallback(() => {
    // `key` is "default" when this page was opened directly (no page to go back to).
    if (location.key !== 'default') navigate(-1);
    else navigate(fallbackPath);
  }, [location.key, navigate, fallbackPath]);

  const subtitle = [
    collected.activityName,
    snapshot?.floorName,
    flat,
    room,
  ].filter(Boolean).join(' · ');

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto', px: { xs: 2, sm: 3 }, py: 4 }}>
      <Box sx={{ mb: { xs: 2.5, md: 3 } }}>
        <Box
          component="button" type="button" onClick={goBack}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 2.5, minHeight: 44, px: 1.25, py: 0.625,
            borderRadius: '8px', border: `1.5px solid ${colors.borderLight}`, backgroundColor: 'transparent',
            color: colors.textMuted, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            transition: `all ${motion.durationFast} ${motion.easeOut}`,
            '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
          }}
        >
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Back
        </Box>
        <Typography
          component="h1"
          sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5 }}
        >
          Evidence images
        </Typography>
        {!loading && snapshot && <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>{subtitle}</Typography>}
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress size={28} sx={{ color: colors.primary }} />
        </Box>
      )}

      {!loading && failed && (
        <Typography sx={{ textAlign: 'center', py: 8, color: P.muted }}>Could not load the evidence. Please try again.</Typography>
      )}

      {!loading && !failed && !activityId && (
        <Typography sx={{ textAlign: 'center', py: 8, color: P.muted }}>
          No activity was chosen. Open this page from an activity on the progress screen.
        </Typography>
      )}

      {!loading && !failed && activityId && !snapshot && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>This floor hasn't been analyzed yet</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Evidence images appear after the floor has been analysed.</Typography>
        </Box>
      )}

      {!loading && !failed && activityId && snapshot && collected.items.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }} data-testid="no-evidence">
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>No evidence images for this activity</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted, maxWidth: 520, mx: 'auto' }}>
            A photo is kept as evidence only where the AI saw the work. Nothing was kept for this activity.
          </Typography>
        </Box>
      )}

      {!loading && !failed && snapshot && collected.items.length > 0 && (
        <>
          <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mb: 1.5 }} data-testid="evidence-count">
            {visible.length} image{visible.length === 1 ? '' : 's'} used as evidence. Drag any image to look around, scroll or pinch to zoom.
          </Typography>

          {rooms.length > 1 && (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }} role="group" aria-label="Filter by room">
              <Chip
                label={`All rooms (${collected.items.length})`} clickable onClick={() => setRoomFilter('all')}
                color={roomFilter === 'all' ? 'primary' : 'default'} variant={roomFilter === 'all' ? 'filled' : 'outlined'}
              />
              {rooms.map(r => (
                <Chip
                  key={r.key} label={`${r.label} (${r.count})`} clickable onClick={() => setRoomFilter(r.key)}
                  color={roomFilter === r.key ? 'primary' : 'default'} variant={roomFilter === r.key ? 'filled' : 'outlined'}
                />
              ))}
            </Box>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            {shown.map(item => {
              const s = sources[item.captureId];
              return (
                <EvidencePanoramaCard
                  key={item.captureId}
                  item={item}
                  source={s && s !== 'missing' ? s : null}
                />
              );
            })}
          </Box>

          {missingCount > 0 && (
            <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mt: 2 }} data-testid="missing-note">
              {missingCount} image{missingCount === 1 ? ' is' : 's are'} no longer available.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}
