import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Chip, CircularProgress, Pagination, Typography } from '@mui/material';
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
import { collectEvidence, flatsOf, pageSlice, roomsInFlat } from '@/utils/evidenceImages';
import { panoramaSourceOf, type PanoramaSource, type RawCapture } from '@/utils/panoramaSource';

const P = { muted: '#6b7280', strong: '#111827' };
/** How many capture records are fetched at the same time. */
const FETCH_BATCH = 6;
/** Images per page: a few at a time keeps the page light, since every panorama is a live 3D view. */
const PAGE_SIZE = 6;
const ALL = '__all__';

type SourceState = PanoramaSource | 'missing';

/** A labelled row of chips that scrolls sideways on a narrow screen instead of wrapping into a pile. */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25, minWidth: 0 }}>
      <Typography sx={{ width: 44, flexShrink: 0, fontSize: '0.75rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      <Box
        role="group" aria-label={`Filter by ${label.toLowerCase()}`}
        sx={{ display: 'flex', gap: 0.75, flexWrap: 'nowrap', overflowX: 'auto', py: 0.5, minWidth: 0, scrollbarWidth: 'thin' }}
      >
        {children}
      </Box>
    </Box>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Chip
      label={label} clickable onClick={onClick} size="small"
      color={active ? 'primary' : 'default'} variant={active ? 'filled' : 'outlined'}
      sx={{ flexShrink: 0, fontWeight: 600 }}
    />
  );
}

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
  const [flatFilter, setFlatFilter] = useState(ALL);
  const [roomFilter, setRoomFilter] = useState(ALL);
  const [page, setPage] = useState(1);

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

  // Flat, then room: two short rows instead of one wall of chips. Images are sorted the same way.
  const flats = useMemo(() => flatsOf(collected.items), [collected]);
  const rooms = useMemo(
    () => (flatFilter === ALL ? [] : roomsInFlat(collected.items, flatFilter)),
    [collected, flatFilter],
  );
  const visible = useMemo(() => {
    const rows = collected.items.filter(i =>
      (flatFilter === ALL || (i.flatName || '') === flatFilter)
      && (roomFilter === ALL || (i.roomName || '') === roomFilter));
    const nat = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return [...rows].sort((a, b) => {
      if (!a.flatName !== !b.flatName) return a.flatName ? -1 : 1;
      return nat(a.flatName, b.flatName) || nat(a.roomName, b.roomName);
    });
  }, [collected, flatFilter, roomFilter]);

  const paged = useMemo(() => pageSlice(visible, page, PAGE_SIZE), [visible, page]);
  const pageIds = useMemo(() => paged.rows.map(i => i.captureId), [paged]);

  const chooseFlat = (key: string) => { setFlatFilter(key); setRoomFilter(ALL); setPage(1); };
  const chooseRoom = (key: string) => { setRoomFilter(key); setPage(1); };

  // Fetch the capture records of the page being shown, a few at a time; cards fill in as they arrive.
  useEffect(() => {
    let cancelled = false;
    const todo = pageIds.filter(id => !(id in sources));
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
  }, [pageIds]);

  const missingCount = paged.rows.filter(i => sources[i.captureId] === 'missing').length;
  const shown = paged.rows.filter(i => sources[i.captureId] !== 'missing');

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
          <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mb: 2 }} data-testid="evidence-count">
            {visible.length} image{visible.length === 1 ? '' : 's'} used as evidence. Drag any image to look around, scroll or pinch to zoom.
          </Typography>

          {flats.length > 1 && (
            <FilterRow label="Flat">
              <FilterChip label={`All flats (${collected.items.length})`} active={flatFilter === ALL} onClick={() => chooseFlat(ALL)} />
              {flats.map(f => (
                <FilterChip key={f.key || 'common'} label={`${f.label} (${f.count})`} active={flatFilter === f.key} onClick={() => chooseFlat(f.key)} />
              ))}
            </FilterRow>
          )}
          {rooms.length > 1 && (
            <FilterRow label="Room">
              <FilterChip label={`All rooms (${rooms.reduce((n, r) => n + r.count, 0)})`} active={roomFilter === ALL} onClick={() => chooseRoom(ALL)} />
              {rooms.map(r => (
                <FilterChip key={r.key || 'room'} label={`${r.label} (${r.count})`} active={roomFilter === r.key} onClick={() => chooseRoom(r.key)} />
              ))}
            </FilterRow>
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

          {paged.pages > 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mt: 3 }}>
              <Typography sx={{ fontSize: '0.8125rem', color: P.muted }} data-testid="evidence-range">
                Showing {(paged.page - 1) * PAGE_SIZE + 1}–{Math.min(paged.page * PAGE_SIZE, visible.length)} of {visible.length}
              </Typography>
              <Pagination
                count={paged.pages} page={paged.page} color="primary" siblingCount={1} boundaryCount={1}
                onChange={(_, p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                sx={{ '& .MuiPaginationItem-root': { fontWeight: 600 } }}
              />
            </Box>
          )}

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
