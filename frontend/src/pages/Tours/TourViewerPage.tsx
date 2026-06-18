import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip, CircularProgress } from '@mui/material';
import '@photo-sphere-viewer/core/index.css';
import {
  ArrowBackRounded, FullscreenRounded, FullscreenExitRounded, ViewInArRounded,
  LayersRounded, NavigateNextRounded, NavigateBefore,
  CameraAltRounded, ThreeSixtyRounded, PlayArrowRounded, PauseRounded,
  CheckCircleRounded, PublishRounded, HomeRounded, MeetingRoomRounded,
  PhotoCameraRounded, EventRounded, MapRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  getTourById, statusConfig, mockTours, mockTowers, getFloors, mockCaptures,
  getCaptureSeriesForCapture, type CaptureSnapshot,
} from '@/data/mockData';
import CaptureTimeline from '@shared/components/CaptureTimeline/CaptureTimeline';
import { useWorkflowStore } from '@store/workflowStore';

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

// ── SidePanel shell ─────────────────────────────────────────────────────────

function SidePanel({ title, icon, action, children }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ borderRadius: '14px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, borderBottom: `1px solid ${colors.borderLight}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.875 }}>
          {icon && <Box sx={{ color: colors.textMuted, display: 'flex' }}>{icon}</Box>}
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '0.01em' }}>{title}</Typography>
        </Box>
        {action}
      </Box>
      <Box sx={{ p: 2 }}>{children}</Box>
    </Box>
  );
}

// ── RoomNavigationPanel (always-on, not a drawer) ──────────────────────────────

function RoomNavigationPanel({ tour }: { tour: ReturnType<typeof getTourById> }) {
  if (!tour) return null;
  const tower = mockTowers.find(t => t.id === tour.towerId);
  const floors = tower ? getFloors(tour.towerId) : [];
  const floorsWithTours = floors.filter(f => mockTours.some(t => t.floorLabel === f.label && t.towerId === tour.towerId));

  return (
    <SidePanel title="Room Navigation" icon={<MeetingRoomRounded sx={{ fontSize: 15 }} />}>
      <Box sx={{ maxHeight: 280, overflowY: 'auto', mx: -0.5 }}>
        {(floorsWithTours.length ? floorsWithTours : floors.slice(0, 4)).map(f => {
          const isCurrentFloor = f.label === tour.floorLabel;
          const floorTours = mockTours.filter(t => t.floorLabel === f.label && t.towerId === tour.towerId);
          return (
            <Box key={f.id} sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <LayersRounded sx={{ fontSize: 13, color: isCurrentFloor ? colors.primary : colors.textSubdued }} />
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: isCurrentFloor ? colors.primary : colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</Typography>
                </Box>
              </Box>
              {floorTours.map(t => (
                <Box
                  key={t.id}
                  component={Link}
                  to={`/tours/${t.id}`}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.875, ml: 1.5, borderRadius: '8px', textDecoration: 'none', backgroundColor: t.id === tour.id ? colors.primarySoft : 'transparent', '&:hover': { backgroundColor: t.id === tour.id ? colors.primarySoft : colors.bg } }}
                >
                  <ViewInArRounded sx={{ fontSize: 13, color: t.id === tour.id ? colors.primary : colors.textMuted }} />
                  <Typography sx={{ fontSize: '0.8125rem', color: t.id === tour.id ? colors.primary : colors.textSecondary, fontWeight: t.id === tour.id ? 600 : 400, flex: 1 }} noWrap>
                    {t.roomName}
                  </Typography>
                  {t.status === 'published' && <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#16a34a', flexShrink: 0 }} />}
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>
    </SidePanel>
  );
}

// ── PublishingStatus (review status side panel) ────────────────────────────────

function PublishingStatus({ tour, onPublish }: { tour: NonNullable<ReturnType<typeof getTourById>>; onPublish: () => void }) {
  return (
    <Box>
      {tourStatusFlow.map((s, i) => {
        const currentIdx = tourStatusFlow.indexOf(tour.status as typeof tourStatusFlow[number]);
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }}>
            <Box sx={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: isDone ? '#16a34a' : isCurrent ? colors.primary : colors.bgDeep, flexShrink: 0 }}>
              {isDone
                ? <CheckCircleRounded sx={{ fontSize: 13, color: '#fff' }} />
                : <Typography sx={{ fontSize: '0.625rem', fontWeight: 700, color: isCurrent ? '#fff' : colors.textSubdued }}>{i + 1}</Typography>
              }
            </Box>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: isCurrent ? 600 : 400, color: isCurrent ? colors.textStrong : isDone ? colors.textMuted : colors.textSubdued, textTransform: 'capitalize' }}>
              {s.replace('_', ' ')}
            </Typography>
            {isCurrent && <Box sx={{ ml: 'auto', width: 6, height: 6, borderRadius: '50%', backgroundColor: colors.primary }} />}
          </Box>
        );
      })}
      {tour.status !== 'published' && (
        <Box
          onClick={onPublish}
          sx={{ mt: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, py: 1, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', '&:hover': { opacity: 0.9 } }}
        >
          <PublishRounded sx={{ fontSize: 15 }} /> Publish Tour
        </Box>
      )}
    </Box>
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
  const tours = useWorkflowStore(s => s.tours);
  const captures = useWorkflowStore(s => s.captures);
  const publishTour = useWorkflowStore(s => s.publishTour);
  const tour = tours.find(t => t.id === tourId) ?? getTourById(tourId ?? '');

  const [fullscreen, setFullscreen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  const currentIdx = tourId ? tours.findIndex(t => t.id === tourId) : 0;
  const tourMedia = tour as typeof tour & {
    processedPanoramaUrl?: string | null;
    processed_panorama_url?: string | null;
    panoramaUrls?: string[];
    panorama_urls?: string[];
  };
  const panoramaUrl =
    tourMedia.processedPanoramaUrl ||
    tourMedia.processed_panorama_url ||
    tourMedia.panoramaUrls?.[0] ||
    tourMedia.panorama_urls?.[0] ||
    PANORAMA_MAP[tourId ?? ''] ||
    FALLBACK_PANORAMA;
  const hotspots = TOUR_HOTSPOTS[tourId ?? ''] ?? [];

  const handleHotspotClick = useCallback((targetTourId: string) => {
    navigate(`/tours/${targetTourId}`);
  }, [navigate]);

  const handlePublish = useCallback(() => {
    if (tour) {
      publishTour(tour.id);
    }
  }, [publishTour, tour]);

  if (!tour) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2 }}>
      <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: colors.borderLight }}>404</Typography>
      <Typography sx={{ color: colors.textMuted }}>Tour not found</Typography>
      <Box component={Link} to="/tours" sx={{ color: colors.primary, textDecoration: 'none', fontSize: '0.875rem' }}>← All tours</Box>
    </Box>
  );

  const ts = (statusConfig.tour as Record<string, { label: string; color: string; bg: string }>)[tour.status] ?? statusConfig.tour.draft;
  const prevTour = currentIdx > 0 ? tours[currentIdx - 1] : null;
  const nextTour = currentIdx < tours.length - 1 ? tours[currentIdx + 1] : null;
  const capture = captures.find(c => c.id === tour.captureId) ?? mockCaptures.find(c => c.id === tour.captureId);
  const series = getCaptureSeriesForCapture(tour.captureId);
  // roomId is "<tower>-<floor>-<room>", e.g. "t1-f14-r1" → floorId "t1-f14".
  const floorId = tour.roomId.split('-').slice(0, 2).join('-');

  const breadcrumb: { label: string; to?: string }[] = [
    { label: 'Home', to: '/dashboard' },
    { label: tour.projectName, to: `/projects/${tour.projectId}` },
    { label: tour.towerName, to: `/projects/${tour.projectId}/towers/${tour.towerId}` },
    { label: tour.floorLabel },
    { label: tour.roomName },
  ];

  const viewer = (
    <Box sx={{
      borderRadius: fullscreen ? 0 : '20px',
      height: fullscreen ? '100vh' : '100%',
      minHeight: fullscreen ? '100vh' : 560,
      position: 'relative',
      overflow: 'hidden',
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

      {/* Floating breadcrumb (always visible, even in fullscreen) */}
      <Box sx={{ position: 'absolute', top: 12, left: 12, zIndex: 10, px: 1.5, py: 0.875, borderRadius: '10px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', gap: 0.375, maxWidth: 'calc(100% - 220px)', overflow: 'hidden' }}>
        <HomeRounded sx={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', mr: 0.25 }} />
        {breadcrumb.slice(1).map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <NavigateNextRounded sx={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }} />}
            <Typography noWrap sx={{ fontSize: '0.75rem', fontWeight: i === breadcrumb.length - 2 ? 700 : 500, color: i === breadcrumb.length - 2 ? '#fff' : 'rgba(255,255,255,0.65)' }}>
              {b.label}
            </Typography>
          </React.Fragment>
        ))}
      </Box>

      {/* Top-right controls */}
      <Box sx={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 0.75, zIndex: 10 }}>
        <Tooltip title={autoRotate ? 'Stop rotation' : 'Auto rotate'}>
          <IconButton onClick={() => setAutoRotate(v => !v)} size="small" sx={{ backgroundColor: 'rgba(0,0,0,0.45)', color: autoRotate ? '#fbbf24' : '#fff', backdropFilter: 'blur(8px)', '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' } }}>
            {autoRotate ? <PauseRounded sx={{ fontSize: 16 }} /> : <PlayArrowRounded sx={{ fontSize: 16 }} />}
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
  );

  // Fullscreen: viewer fills the screen, nothing else.
  if (fullscreen) {
    return <Box sx={{ position: 'fixed', inset: 0, zIndex: 1300, backgroundColor: '#0f1929' }}>{viewer}</Box>;
  }

  return (
    <Box>
      {/* ── Persistent breadcrumb bar ──────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
        <Box component={Link} to="/tours" sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', width: 30, height: 30, borderRadius: '8px', justifyContent: 'center', backgroundColor: colors.card, boxShadow: '0 1px 3px rgba(15,23,42,0.06)', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', flex: 1 }}>
          {breadcrumb.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <NavigateNextRounded sx={{ fontSize: 14, color: colors.textSubdued }} />}
              {b.to ? (
                <Box component={Link} to={b.to} sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.primary } }}>{b.label}</Box>
              ) : (
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: i === breadcrumb.length - 1 ? 700 : 600, color: i === breadcrumb.length - 1 ? colors.textStrong : colors.textSecondary }}>{b.label}</Typography>
              )}
            </React.Fragment>
          ))}
        </Box>
        <Chip label={ts.label} size="small" sx={{ height: 24, fontSize: '0.6875rem', fontWeight: 600, color: ts.color, backgroundColor: ts.bg, borderRadius: '6px' }} />
      </Box>

      {/* ── Viewer (most of screen) + right rail ──────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'stretch', flexDirection: { xs: 'column', lg: 'row' } }}>
        {/* Viewer — dominant */}
        <Box sx={{ flex: 1, minWidth: 0 }}>{viewer}</Box>

        {/* Right rail — always-on panels */}
        <Box sx={{ width: { xs: '100%', lg: 320 }, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <RoomNavigationPanel tour={tour} />

          {/* Capture Timeline */}
          {series.length > 0 && (
            <SidePanel title="Capture Timeline" icon={<PhotoCameraRounded sx={{ fontSize: 15 }} />}>
              <CaptureTimeline
                series={series}
                activeId={series[series.length - 1].id}
                onSelect={() => navigate(`/captures/${tour.captureId}`)}
              />
              <Box component={Link} to={`/captures/${tour.captureId}`} sx={{ display: 'block', textAlign: 'center', mt: 1.5, fontSize: '0.75rem', fontWeight: 600, color: colors.primary, textDecoration: 'none' }}>
                Open capture history →
              </Box>
            </SidePanel>
          )}

          {/* Tour Metadata */}
          <SidePanel title="Tour Details" icon={<EventRounded sx={{ fontSize: 15 }} />}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {([
                { label: 'Captures', value: `${tour.captures} panoramas` },
                { label: 'Capture date', value: capture?.uploadedAt ?? tour.lastCapture },
                { label: 'Reviewer', value: capture?.reviewedBy ?? 'Not assigned' },
                { label: 'Views', value: `${tour.viewCount} views` },
                { label: 'Hotspots', value: `${hotspots.filter(h => h.targetTourId).length} linked rooms` },
              ] as const).map(({ label, value }) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>{label}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.textStrong, fontWeight: 600, textAlign: 'right' }}>{value}</Typography>
                </Box>
              ))}
            </Box>
          </SidePanel>

          {/* Review / Publishing status */}
          <SidePanel title="Review Status" icon={<CheckCircleRounded sx={{ fontSize: 15 }} />}>
            <PublishingStatus tour={tour} onPublish={handlePublish} />
          </SidePanel>

          {/* Digital-twin link back to the floor plan (7D) */}
          {floorId && (
            <Box component={Link} to={`/floor-plans/${tour.projectId}/${tour.towerId}/${floorId}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderRadius: '12px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', textDecoration: 'none', '&:hover': { boxShadow: '0 6px 20px rgba(15,23,42,0.10)' }, transition: `box-shadow ${motion.durationFast}` }}>
              <Box sx={{ width: 32, height: 32, borderRadius: '9px', backgroundColor: colors.primarySoft, color: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MapRounded sx={{ fontSize: 17 }} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>View on floor plan</Typography>
                <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>See this room in context</Typography>
              </Box>
              <NavigateNextRounded sx={{ fontSize: 18, color: colors.textSubdued }} />
            </Box>
          )}
        </Box>
      </Box>

      {/* ── More tours strip ──────────────────────────────────────────────── */}
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
    </Box>
  );
}
