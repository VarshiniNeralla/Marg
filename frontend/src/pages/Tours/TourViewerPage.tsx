import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip, Drawer, CircularProgress } from '@mui/material';
import '@photo-sphere-viewer/core/index.css';
import {
  ArrowBackRounded, FullscreenRounded, FullscreenExitRounded, ViewInArRounded,
  LayersRounded, NavigateNextRounded, NavigateBefore, InfoRounded,
  CameraAltRounded, CloseRounded, ThreeSixtyRounded, PlayArrowRounded, PauseRounded,
  CheckCircleRounded, PublishRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { getTourById, statusConfig, mockTours, mockTowers, getFloors, mockCaptures } from '@/data/mockData';

// Placeholder equirectangular panoramas — one per tour, keyed by tourId.
// Replace these with real Cloudinary secure_url values from the API.
const PANORAMA_MAP: Record<string, string> = {
  tour1: 'https://photo-sphere-viewer-data.netlify.app/assets/sphere.jpg',
  tour2: 'https://photo-sphere-viewer-data.netlify.app/assets/sphere-small.jpg',
  tour3: 'https://photo-sphere-viewer-data.netlify.app/assets/sphere.jpg',
  tour4: 'https://photo-sphere-viewer-data.netlify.app/assets/sphere-small.jpg',
  tour5: 'https://photo-sphere-viewer-data.netlify.app/assets/sphere.jpg',
  tour6: 'https://photo-sphere-viewer-data.netlify.app/assets/sphere-small.jpg',
};

const FALLBACK_PANORAMA = 'https://photo-sphere-viewer-data.netlify.app/assets/sphere.jpg';

const tourStatusFlow = ['draft', 'processing', 'in_review', 'published'] as const;

// ── NavigationPanel ───────────────────────────────────────────────────────────

function NavigationPanel({ tour, onClose }: { tour: ReturnType<typeof getTourById>; onClose: () => void }) {
  if (!tour) return null;
  const tower = mockTowers.find(t => t.id === tour.towerId);
  const floors = tower ? getFloors(tour.towerId) : [];
  const [expandFloor, setExpandFloor] = useState(true);

  return (
    <Box sx={{ width: 280, height: '100%', backgroundColor: colors.card, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(15,23,42,0.08)' }}>
      <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong }}>Navigation</Typography>
        <IconButton size="small" onClick={onClose}><CloseRounded sx={{ fontSize: 16 }} /></IconButton>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5 }}>
        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', px: 1, mb: 1 }}>{tower?.name}</Typography>
        {floors.slice(0, 6).map(f => (
          <Box key={f.id}>
            <Box
              onClick={() => setExpandFloor(prev => (f.label === tour.floorLabel ? !prev : prev))}
              sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 1, borderRadius: '8px', cursor: 'pointer', '&:hover': { backgroundColor: colors.bg } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LayersRounded sx={{ fontSize: 14, color: colors.textMuted }} />
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: f.label === tour.floorLabel ? colors.primary : colors.textStrong }}>{f.label}</Typography>
              </Box>
              <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{f.mapped}/{f.rooms}</Typography>
            </Box>
            {f.label === tour.floorLabel && expandFloor && (
              <Box sx={{ ml: 3.5, mb: 0.5 }}>
                {mockTours.filter(t => t.floorLabel === tour.floorLabel && t.towerId === tour.towerId).map(t => (
                  <Box
                    key={t.id}
                    component={Link}
                    to={`/tours/${t.id}`}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.875, borderRadius: '8px', textDecoration: 'none', backgroundColor: t.id === tour.id ? colors.primarySoft : 'transparent', '&:hover': { backgroundColor: t.id === tour.id ? colors.primarySoft : colors.bg } }}
                  >
                    <ViewInArRounded sx={{ fontSize: 13, color: t.id === tour.id ? colors.primary : colors.textMuted }} />
                    <Typography sx={{ fontSize: '0.8125rem', color: t.id === tour.id ? colors.primary : colors.textSecondary, fontWeight: t.id === tour.id ? 600 : 400 }}>
                      {t.roomName.split(' ').pop()}
                    </Typography>
                    {t.status === 'published' && <Box sx={{ ml: 'auto', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#16a34a' }} />}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ── InfoDrawer ────────────────────────────────────────────────────────────────

function InfoDrawer({ tour, open, onClose, onPublish }: {
  tour: ReturnType<typeof getTourById>;
  open: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  if (!tour) return null;
  const capture = mockCaptures.find(c => c.id === tour.captureId);
  const ts = (statusConfig.tour as Record<string, { label: string; color: string; bg: string }>)[tour.status] ?? statusConfig.tour.draft;

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: 320, p: 3 } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Tour Information</Typography>
        <IconButton size="small" onClick={onClose}><CloseRounded sx={{ fontSize: 16 }} /></IconButton>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Chip label={ts.label} size="small" sx={{ alignSelf: 'flex-start', height: 24, fontSize: '0.75rem', fontWeight: 600, color: ts.color, backgroundColor: ts.bg, borderRadius: '6px' }} />
        {([
          { label: 'Project',     value: tour.projectName },
          { label: 'Tower',       value: tour.towerName },
          { label: 'Floor',       value: tour.floorLabel },
          { label: 'Room',        value: tour.roomName },
          { label: 'Captures',    value: `${tour.captures} panoramic images` },
          { label: 'Last updated',value: tour.lastCapture },
          { label: 'Views',       value: `${tour.viewCount} views` },
          { label: 'Reviewer',    value: capture?.reviewedBy ?? 'Not assigned' },
          { label: 'Capture date',value: capture?.uploadedAt ?? '—' },
        ] as const).map(({ label, value }) => (
          <Box key={label}>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</Typography>
            <Typography sx={{ fontSize: '0.875rem', color: colors.textStrong, fontWeight: 500, mt: 0.125 }}>{value}</Typography>
          </Box>
        ))}
      </Box>

      {/* Publishing workflow stepper */}
      <Box sx={{ mt: 3, pt: 2.5, borderTop: `1px solid ${colors.borderLight}` }}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', mb: 2 }}>Publishing Status</Typography>
        {tourStatusFlow.map((s, i) => {
          const currentIdx = tourStatusFlow.indexOf(tour.status as typeof tourStatusFlow[number]);
          const isDone = i < currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }}>
              <Box sx={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: isDone ? '#16a34a' : isCurrent ? colors.primary : colors.bgDeep, flexShrink: 0 }}>
                {isDone
                  ? <CheckCircleRounded sx={{ fontSize: 14, color: '#fff' }} />
                  : <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: isCurrent ? '#fff' : colors.textSubdued }}>{i + 1}</Typography>
                }
              </Box>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: isCurrent ? 600 : 400, color: isCurrent ? colors.textStrong : isDone ? colors.textMuted : colors.textSubdued, textTransform: 'capitalize' }}>
                {s.replace('_', ' ')}
              </Typography>
              {isCurrent && <Box sx={{ ml: 'auto', width: 6, height: 6, borderRadius: '50%', backgroundColor: colors.primary }} />}
            </Box>
          );
        })}
        {tour.status !== 'published' && (
          <Box
            onClick={onPublish}
            sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, py: 1, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', '&:hover': { opacity: 0.9 } }}
          >
            <PublishRounded sx={{ fontSize: 16 }} /> Publish Tour
          </Box>
        )}
      </Box>
    </Drawer>
  );
}

// ── PanoramaViewer (Photo Sphere Viewer v5 — imperative mount) ────────────────

interface PanoramaViewerProps {
  panoramaUrl: string;
  tourId: string;
  autoRotate: boolean;
  onAutoRotateChange: (v: boolean) => void;
  hotspots: Array<{ id: string; yaw: number; pitch: number; label: string; targetTourId?: string }>;
  onHotspotClick: (targetTourId: string) => void;
}

function PanoramaViewer({ panoramaUrl, autoRotate, hotspots, onHotspotClick }: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<import('@photo-sphere-viewer/core').Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    async function initViewer() {
      setLoading(true);
      setError(false);

      try {
        const { Viewer } = await import('@photo-sphere-viewer/core');

        if (destroyed || !containerRef.current) return;

        const viewer = new Viewer({
          container: containerRef.current,
          panorama: panoramaUrl,
          defaultZoomLvl: 50,
          touchmoveTwoFingers: false,
          mousewheelCtrlKey: false,
          navbar: false,
          loadingTxt: '',
          loadingImg: '',
        });

        viewerRef.current = viewer;

        viewer.addEventListener('ready', () => {
          if (!destroyed) setLoading(false);
        });

        viewer.addEventListener('error' as never, () => {
          if (!destroyed) { setLoading(false); setError(true); }
        });

        // Add hotspot markers as markers plugin markers if available
        // For now, we position them as absolute overlays in the JSX layer

      } catch (e) {
        if (!destroyed) { setLoading(false); setError(true); }
      }
    }

    initViewer();

    return () => {
      destroyed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [panoramaUrl]);

  // Auto-rotate: manually advance yaw every animation frame
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !autoRotate) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      try {
        const pos = viewer.getPosition();
        viewer.rotate({ yaw: pos.yaw + 0.003, pitch: pos.pitch });
      } catch { /* viewer may be mid-transition */ }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [autoRotate]);

  if (error) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, background: '#0f1929' }}>
        <ThreeSixtyRounded sx={{ color: 'rgba(255,255,255,0.15)', fontSize: 80 }} />
        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.875rem' }}>Could not load panorama</Typography>
      </Box>
    );
  }

  return (
    <>
      <Box ref={containerRef} sx={{ position: 'absolute', inset: 0 }} />
      {loading && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.7)', zIndex: 2 }}>
          <CircularProgress size={36} sx={{ color: '#fff' }} />
        </Box>
      )}
      {/* Hotspot overlay layer — rendered on top of PSV canvas */}
      {!loading && hotspots.map(hs => (
        <Box
          key={hs.id}
          onClick={() => hs.targetTourId && onHotspotClick(hs.targetTourId)}
          sx={{
            position: 'absolute',
            // Approximate screen position from yaw/pitch for the overlay markers.
            // PSV handles the actual projection; these are visual hints only.
            left: `${50 + (hs.yaw / 180) * 40}%`,
            top: `${50 - (hs.pitch / 90) * 30}%`,
            transform: 'translate(-50%, -50%)',
            cursor: hs.targetTourId ? 'pointer' : 'default',
            zIndex: 3,
            '&:hover .hs-label': { opacity: 1, transform: 'translateY(-4px)' },
          }}
        >
          <Box sx={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: hs.targetTourId ? '#60a5fa' : '#fff' }} />
          </Box>
          <Box className="hs-label" sx={{ position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%) translateY(0)', opacity: 0, transition: `all ${motion.durationFast}`, backgroundColor: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: '0.6875rem', fontWeight: 600, px: 1.25, py: 0.5, borderRadius: '6px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {hs.label}
          </Box>
        </Box>
      ))}
    </>
  );
}

// ── Default hotspots per tour ─────────────────────────────────────────────────

const TOUR_HOTSPOTS: Record<string, Array<{ id: string; yaw: number; pitch: number; label: string; targetTourId?: string }>> = {
  tour1: [
    { id: 'hs1', yaw: -40, pitch: 2,  label: 'Window View' },
    { id: 'hs2', yaw: 85,  pitch: -5, label: 'Master Bedroom', targetTourId: 'tour2' },
    { id: 'hs3', yaw: 160, pitch: 0,  label: 'Kitchen' },
  ],
  tour2: [
    { id: 'hs1', yaw: -90, pitch: 0,  label: 'Living Room', targetTourId: 'tour1' },
    { id: 'hs2', yaw: 30,  pitch: -3, label: 'Balcony' },
  ],
  tour3: [
    { id: 'hs1', yaw: 20,  pitch: 0,  label: 'Bedroom' },
    { id: 'hs2', yaw: -60, pitch: 2,  label: 'Kitchen' },
  ],
  tour4: [
    { id: 'hs1', yaw: 45,  pitch: 0,  label: 'Balcony' },
    { id: 'hs2', yaw: -120,pitch: -2, label: 'Bedroom' },
  ],
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function TourViewerPage() {
  const { tourId } = useParams<{ tourId: string }>();
  const navigate = useNavigate();
  const tour = getTourById(tourId ?? '');

  const [fullscreen, setFullscreen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  const currentIdx = tourId ? mockTours.findIndex(t => t.id === tourId) : 0;
  const panoramaUrl = PANORAMA_MAP[tourId ?? ''] ?? FALLBACK_PANORAMA;
  const hotspots = TOUR_HOTSPOTS[tourId ?? ''] ?? [];

  const handleHotspotClick = useCallback((targetTourId: string) => {
    navigate(`/tours/${targetTourId}`);
  }, [navigate]);

  const handlePublish = useCallback(() => {
    // With React Query: useMutation to call tourService.publishTour(tour.id)
    // For now, update mock data in-place
    if (tour) {
      const idx = mockTours.findIndex(t => t.id === tour.id);
      if (idx !== -1) mockTours[idx] = { ...mockTours[idx], status: 'published' };
      navigate(0); // soft refresh
    }
  }, [tour, navigate]);

  if (!tour) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2 }}>
      <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: colors.borderLight }}>404</Typography>
      <Typography sx={{ color: colors.textMuted }}>Tour not found</Typography>
      <Box component={Link} to="/tours" sx={{ color: colors.primary, textDecoration: 'none', fontSize: '0.875rem' }}>← All tours</Box>
    </Box>
  );

  const ts = (statusConfig.tour as Record<string, { label: string; color: string; bg: string }>)[tour.status] ?? statusConfig.tour.draft;
  const prevTour = currentIdx > 0 ? mockTours[currentIdx - 1] : null;
  const nextTour = currentIdx < mockTours.length - 1 ? mockTours[currentIdx + 1] : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: fullscreen ? '100vh' : 'auto' }}>
      {/* Top bar */}
      {!fullscreen && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <Box component={Link} to="/tours" sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', '&:hover': { color: colors.textStrong } }}>
            <ArrowBackRounded sx={{ fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.25rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em' }}>{tour.roomName}</Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{tour.projectName} · {tour.towerName} · {tour.floorLabel}</Typography>
          </Box>
          <Chip label={ts.label} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, color: ts.color, backgroundColor: ts.bg, borderRadius: '6px' }} />
        </Box>
      )}

      {/* Main viewer */}
      <Box sx={{
        borderRadius: fullscreen ? 0 : '20px',
        height: fullscreen ? '100vh' : 520,
        position: 'relative',
        overflow: 'hidden',
        flex: fullscreen ? 1 : 'none',
        backgroundColor: '#0f1929',
        '& .psv-container': { borderRadius: fullscreen ? 0 : '20px' },
      }}>
        <PanoramaViewer
          panoramaUrl={panoramaUrl}
          tourId={tourId ?? ''}
          autoRotate={autoRotate}
          onAutoRotateChange={setAutoRotate}
          hotspots={hotspots}
          onHotspotClick={handleHotspotClick}
        />

        {/* Top-right controls */}
        <Box sx={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 0.75, zIndex: 10 }}>
          <Tooltip title={autoRotate ? 'Stop rotation' : 'Auto rotate'}>
            <IconButton onClick={() => setAutoRotate(v => !v)} size="small" sx={{ backgroundColor: 'rgba(0,0,0,0.45)', color: autoRotate ? '#fbbf24' : '#fff', backdropFilter: 'blur(8px)', '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' } }}>
              {autoRotate ? <PauseRounded sx={{ fontSize: 16 }} /> : <PlayArrowRounded sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Navigation">
            <IconButton onClick={() => setNavOpen(true)} size="small" sx={{ backgroundColor: 'rgba(0,0,0,0.45)', color: '#fff', backdropFilter: 'blur(8px)', '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' } }}>
              <LayersRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Tour info">
            <IconButton onClick={() => setInfoOpen(true)} size="small" sx={{ backgroundColor: 'rgba(0,0,0,0.45)', color: '#fff', backdropFilter: 'blur(8px)', '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' } }}>
              <InfoRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            <IconButton onClick={() => setFullscreen(v => !v)} size="small" sx={{ backgroundColor: 'rgba(0,0,0,0.45)', color: '#fff', backdropFilter: 'blur(8px)', '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' } }}>
              {fullscreen ? <FullscreenExitRounded sx={{ fontSize: 16 }} /> : <FullscreenRounded sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
        </Box>

        {/* Bottom overlays */}
        <Box sx={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 0.75, zIndex: 10 }}>
          <Box sx={{ px: 1.5, py: 0.75, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <LayersRounded sx={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }} />
            <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{tour.floorLabel}</Typography>
          </Box>
          <Box sx={{ px: 1.5, py: 0.75, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <CameraAltRounded sx={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }} />
            <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{tour.captures} images</Typography>
          </Box>
          {hotspots.length > 0 && (
            <Box sx={{ px: 1.5, py: 0.75, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <ThreeSixtyRounded sx={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }} />
              <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{hotspots.filter(h => h.targetTourId).length} hotspots</Typography>
            </Box>
          )}
        </Box>

        {/* Prev/Next arrows */}
        {prevTour && (
          <Box component={Link} to={`/tours/${prevTour.id}`} sx={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', color: '#fff', textDecoration: 'none', zIndex: 10, '&:hover': { backgroundColor: 'rgba(0,0,0,0.65)' } }}>
            <NavigateBefore sx={{ fontSize: 20 }} />
          </Box>
        )}
        {nextTour && (
          <Box component={Link} to={`/tours/${nextTour.id}`} sx={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', color: '#fff', textDecoration: 'none', zIndex: 10, '&:hover': { backgroundColor: 'rgba(0,0,0,0.65)' } }}>
            <NavigateNextRounded sx={{ fontSize: 20 }} />
          </Box>
        )}
      </Box>

      {/* Tour strip */}
      {!fullscreen && (
        <Box sx={{ mt: 3 }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 2 }}>More Tours</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1 }}>
            {mockTours.filter(t => t.id !== tour.id).map(t => {
              const tStatus = (statusConfig.tour as Record<string, { label: string; color: string; bg: string }>)[t.status] ?? statusConfig.tour.draft;
              return (
                <Box key={t.id} component={Link} to={`/tours/${t.id}`} sx={{ flexShrink: 0, width: 140, borderRadius: '12px', overflow: 'hidden', textDecoration: 'none', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', transition: `all ${motion.durationFast}`, '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 6px 20px rgba(15,23,42,0.10)' } }}>
                  <Box sx={{ height: 80, background: t.gradient, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ViewInArRounded sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 28 }} />
                    <Box sx={{ position: 'absolute', top: 6, right: 6, px: 0.875, py: 0.125, borderRadius: '4px', backgroundColor: tStatus.bg, fontSize: '0.5rem', fontWeight: 700, color: tStatus.color }}>{tStatus.label}</Box>
                  </Box>
                  <Box sx={{ p: 1.25, backgroundColor: colors.card }}>
                    <Typography noWrap sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textStrong }}>{t.roomName.split(' ').slice(-1)[0]}</Typography>
                    <Typography noWrap sx={{ fontSize: '0.625rem', color: colors.textMuted }}>{t.projectName}</Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Navigation panel drawer */}
      <Drawer anchor="left" open={navOpen} onClose={() => setNavOpen(false)} slotProps={{ paper: { sx: { width: 280, boxShadow: 'none', borderRight: `1px solid ${colors.borderLight}` } } }}>
        <NavigationPanel tour={tour} onClose={() => setNavOpen(false)} />
      </Drawer>

      {/* Info drawer */}
      <InfoDrawer tour={tour} open={infoOpen} onClose={() => setInfoOpen(false)} onPublish={handlePublish} />
    </Box>
  );
}
