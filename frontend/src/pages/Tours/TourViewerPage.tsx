import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip, CircularProgress } from '@mui/material';
import '@photo-sphere-viewer/core/index.css';
import {
  ArrowBackRounded, FullscreenRounded, FullscreenExitRounded, ViewInArRounded,
  LayersRounded, NavigateNextRounded, NavigateBefore,
  CameraAltRounded, ThreeSixtyRounded, PlayArrowRounded, PauseRounded,
  CheckCircleRounded, PublishRounded, HomeRounded, MeetingRoomRounded,
  PhotoCameraRounded, EventRounded, MapRounded, CompareRounded, CloseRounded,
  HistoryRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  getTourById, statusConfig, mockTours, mockTowers, getFloors, mockCaptures,
  type CaptureSnapshot,
} from '@/data/mockData';
import CaptureTimeline from '@shared/components/CaptureTimeline/CaptureTimeline';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore } from '@store/authStore';
import type { MockCapture } from '@/data/mockData';

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
// Demo panoramas cycled per walkthrough step so navigation is visibly distinct
// even before real Cloudinary panoramas are attached.
const DEMO_PANORAMAS = [
  'https://photo-sphere-viewer-data.netlify.app/assets/sphere.jpg',
  'https://photo-sphere-viewer-data.netlify.app/assets/sphere-small.jpg',
  'https://photo-sphere-viewer-data.netlify.app/assets/tour/key-biscayne-1.jpg',
  'https://photo-sphere-viewer-data.netlify.app/assets/tour/key-biscayne-2.jpg',
];

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
  const updateTour = useWorkflowStore(s => s.updateTour);
  const floors = useWorkflowStore(s => s.floors);
  const user = useAuthStore(s => s.user);
  const tour = tours.find(t => t.id === tourId) ?? getTourById(tourId ?? '');

  const capturePins = useWorkflowStore(s => s.capturePins);

  const [fullscreen, setFullscreen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [isMarkedDone, setIsMarkedDone] = useState(false);
  // Per-step: which snapshot is selected in the progress timeline (null = latest).
  const [activeSnapId, setActiveSnapId] = useState<string | null>(null);
  // Per-step: panorama override when user selects a historical snapshot.
  const [panoramaOverride, setPanoramaOverride] = useState<string | null>(null);
  // Compare mode: two snapshot IDs to compare.
  const [compareIds, setCompareIds] = useState<[string | null, string | null]>([null, null]);

  // Reset timeline state when the user moves to a different step.
  useEffect(() => {
    setActiveSnapId(null);
    setPanoramaOverride(null);
    setCompareIds([null, null]);
  }, [stepIdx, tourId]);

  const currentIdx = tourId ? tours.findIndex(t => t.id === tourId) : 0;
  const tourMedia = tour as typeof tour & {
    processedPanoramaUrl?: string | null;
    processed_panorama_url?: string | null;
    panoramaUrls?: string[];
    panorama_urls?: string[];
    steps?: import('@/data/mockData').TourStep[];
  };

  // Sequential walkthrough: one stop per pin (Pin 1 → 2 → 3 …). Prev/next arrows
  // step through these. Falls back to a single-panorama tour for legacy tours.
  const steps = tourMedia?.steps ?? [];
  const isWalkthrough = steps.length > 1;
  const clampedStep = Math.min(stepIdx, Math.max(0, steps.length - 1));
  const currentStep = steps[clampedStep];

  const latestPanoramaUrl =
    currentStep?.panoramaUrl ||
    tourMedia?.panoramaUrls?.[clampedStep] ||
    (isWalkthrough ? DEMO_PANORAMAS[clampedStep % DEMO_PANORAMAS.length] : null) ||
    tourMedia?.processedPanoramaUrl ||
    tourMedia?.processed_panorama_url ||
    tourMedia?.panoramaUrls?.[0] ||
    tourMedia?.panorama_urls?.[0] ||
    PANORAMA_MAP[tourId ?? ''] ||
    FALLBACK_PANORAMA;

  // Use the history-selected panorama override when the user has picked a past snapshot.
  const panoramaUrl = panoramaOverride ?? latestPanoramaUrl;
  const hotspots = TOUR_HOTSPOTS[tourId ?? ''] ?? [];

  // ── Progress timeline for the current step ───────────────────────────────────
  // Built from the pin's real captureIds[] — no mock data, no duplicates.
  const pinTimeline = useMemo((): CaptureSnapshot[] => {
    const pinId = currentStep?.pinId;
    if (!pinId) return [];
    const pin = capturePins.find(p => p.id === pinId);
    if (!pin || pin.captureIds.length === 0) return [];

    return pin.captureIds.map((id, i) => {
      const cap = captures.find(c => c.id === id) as (MockCapture & Record<string, unknown>) | undefined;
      const isLatest = i === pin.captureIds.length - 1;
      const uploadedAt = (cap?.uploadedAt as string | undefined) ?? '';
      const dateLabel = uploadedAt ? uploadedAt.split(',')[0] : `Visit ${i + 1}`;
      return {
        id,
        baseCaptureId: id,
        roomId: cap?.roomId ?? pin.roomId,
        date: (cap?.capturedAt as string | undefined) ?? '',
        dateLabel,
        monthLabel: '',
        reviewStatus: (cap?.reviewStatus as CaptureSnapshot['reviewStatus'] | undefined) ?? 'uploaded',
        progress: isLatest ? 100 : Math.round(((i + 1) / pin.captureIds.length) * 100),
        fileCount: cap?.fileCount ?? 0,
        capturedBy: (cap?.uploadedBy as string | undefined) ?? '',
        note: null,
        gradient: (cap?.gradient as string | undefined) ?? 'linear-gradient(135deg,#1e3a5f,#0f2340)',
        isLatest,
      } satisfies CaptureSnapshot;
    });
  }, [currentStep?.pinId, capturePins, captures]);

  // The snapshot currently shown (defaults to latest).
  const effectiveSnapId = activeSnapId ?? (pinTimeline.length > 0 ? pinTimeline[pinTimeline.length - 1].id : '');

  const resolvePanorama = useCallback((captureId: string): string | null => {
    const cap = captures.find(c => c.id === captureId) as (MockCapture & Record<string, unknown>) | undefined;
    if (!cap) return null;
    const mediaAssets = (cap.mediaAssets as Array<{ original_url?: string; secure_url?: string }> | undefined) ?? [];
    return (
      mediaAssets[0]?.original_url ??
      mediaAssets[0]?.secure_url ??
      (cap.processedPanoramaUrl as string | undefined) ??
      (cap.originalFileUrl as string | undefined) ??
      null
    );
  }, [captures]);

  const handleSnapSelect = useCallback((snap: CaptureSnapshot) => {
    setCompareIds(prev => {
      // In compare mode, clicking a node assigns it to the next empty slot.
      if (prev[0] !== null || prev[1] !== null) {
        if (!prev[0]) return [snap.id, prev[1]];
        if (!prev[1]) return [prev[0], snap.id];
        return [prev[1], snap.id]; // both full — cycle
      }
      return prev;
    });
    setActiveSnapId(snap.id);
    setPanoramaOverride(resolvePanorama(snap.id));
  }, [resolvePanorama]);

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
  const floorId = floors.find(f => f.towerId === tour.towerId && f.label === tour.floorLabel)?.id;

  const breadcrumb: { label: string; to?: string }[] = [
    { label: 'Virtual Tours', to: '/tours' },
    { label: tour.projectName },
    { label: tour.towerName },
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

      {/* History mode indicator — shown inside the viewer when viewing a past snapshot */}
      {activeSnapId && activeSnapId !== pinTimeline[pinTimeline.length - 1]?.id && (
        <Box sx={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 15, display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, borderRadius: '999px', backgroundColor: 'rgba(217,119,6,0.9)', backdropFilter: 'blur(8px)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
          <HistoryRounded sx={{ fontSize: 13, color: '#fff' }} />
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff' }}>
            {pinTimeline.find(s => s.id === activeSnapId)?.dateLabel ?? 'Historical view'}
          </Typography>
          <Box onClick={() => { setActiveSnapId(null); setPanoramaOverride(null); }} sx={{ display: 'flex', alignItems: 'center', ml: 0.5, cursor: 'pointer', opacity: 0.85, '&:hover': { opacity: 1 } }}>
            <CloseRounded sx={{ fontSize: 13, color: '#fff' }} />
          </Box>
        </Box>
      )}

      {/* Walkthrough step indicator (Pin N of M) */}
      {isWalkthrough && currentStep && (
        <Box sx={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10, px: 2, py: 0.875, borderRadius: '999px', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: '#fff' }}>{currentStep.label}</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>{clampedStep + 1} of {steps.length}</Typography>
        </Box>
      )}

      {/* Step dots */}
      {isWalkthrough && (
        <Box sx={{ position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', gap: 0.75 }}>
          {steps.map((s, i) => (
            <Box key={s.pinId} onClick={() => setStepIdx(i)} sx={{ width: i === clampedStep ? 22 : 8, height: 8, borderRadius: '999px', backgroundColor: i === clampedStep ? '#fff' : 'rgba(255,255,255,0.45)', cursor: 'pointer', transition: 'all 160ms', '&:hover': { backgroundColor: 'rgba(255,255,255,0.8)' } }} />
          ))}
        </Box>
      )}

      {/* Prev/Next arrows — step through walkthrough stops, else navigate tours */}
      {isWalkthrough ? (
        <>
          {clampedStep > 0 && (
            <Box onClick={() => setStepIdx(i => Math.max(0, i - 1))} sx={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: '#fff', cursor: 'pointer', zIndex: 10, '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' } }}>
              <NavigateBefore sx={{ fontSize: 24 }} />
            </Box>
          )}
          {clampedStep < steps.length - 1 && (
            <Box onClick={() => setStepIdx(i => Math.min(steps.length - 1, i + 1))} sx={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: '#fff', cursor: 'pointer', zIndex: 10, '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' } }}>
              <NavigateNextRounded sx={{ fontSize: 24 }} />
            </Box>
          )}
        </>
      ) : (
        <>
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
        </>
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
        <Box component={Link} to="/tours" sx={{ cursor: 'pointer', border: 'none', color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', width: 30, height: 30, borderRadius: '8px', justifyContent: 'center', backgroundColor: colors.card, boxShadow: '0 1px 3px rgba(15,23,42,0.06)', '&:hover': { color: colors.textStrong } }}>
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

          {/* Progress Timeline — real pin history, inline panorama switching */}
          {pinTimeline.length > 0 && (() => {
            const isComparing = !!(compareIds[0] || compareIds[1]);
            const bothSelected = !!(compareIds[0] && compareIds[1]);
            const latestSnap = pinTimeline[pinTimeline.length - 1];
            const isViewingHistory = !!(activeSnapId && activeSnapId !== latestSnap?.id);
            const viewingSnap = isViewingHistory ? pinTimeline.find(s => s.id === activeSnapId) : null;

            return (
              <SidePanel
                title="Progress Timeline"
                icon={<HistoryRounded sx={{ fontSize: 15 }} />}
                action={
                  pinTimeline.length > 1 ? (
                    <Box
                      onClick={() => setCompareIds(isComparing ? [null, null] : [latestSnap.id, null])}
                      sx={{
                        display: 'inline-flex', alignItems: 'center', gap: 0.5,
                        px: 1.25, py: 0.375, borderRadius: '6px', cursor: 'pointer',
                        fontSize: '0.6875rem', fontWeight: 600,
                        backgroundColor: isComparing ? 'rgba(124,58,237,0.1)' : colors.bg,
                        color: isComparing ? '#7c3aed' : colors.textMuted,
                        border: `1px solid ${isComparing ? '#7c3aed' : colors.borderLight}`,
                        transition: `all ${motion.durationFast}`,
                        '&:hover': { borderColor: '#7c3aed', color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.08)' },
                      }}
                    >
                      {isComparing ? <CloseRounded sx={{ fontSize: 12 }} /> : <CompareRounded sx={{ fontSize: 12 }} />}
                      {isComparing ? 'Cancel' : 'Compare'}
                    </Box>
                  ) : undefined
                }
              >
                {/* Summary row */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.625 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#16a34a' }} />
                    <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Latest
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, fontWeight: 500 }} noWrap>
                    {latestSnap.dateLabel} · {pinTimeline.length} capture{pinTimeline.length !== 1 ? 's' : ''}
                  </Typography>
                </Box>

                {/* Timeline scrubber */}
                <CaptureTimeline
                  series={pinTimeline}
                  activeId={effectiveSnapId}
                  onSelect={handleSnapSelect}
                  compareIds={isComparing ? compareIds : undefined}
                  compareMode={isComparing}
                />

                {/* Compare UI — shown only when compare mode is active */}
                {isComparing && (
                  <Box sx={{ mt: 1.5, borderRadius: '10px', overflow: 'hidden', border: `1px solid rgba(124,58,237,0.18)`, backgroundColor: 'rgba(124,58,237,0.04)' }}>
                    {/* Instruction banner */}
                    <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid rgba(124,58,237,0.12)`, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <CompareRounded sx={{ fontSize: 13, color: '#7c3aed', flexShrink: 0 }} />
                      <Typography sx={{ fontSize: '0.6875rem', color: '#7c3aed', fontWeight: 600, lineHeight: 1.4 }}>
                        {!compareIds[0]
                          ? 'Tap a node above to set A'
                          : !compareIds[1]
                          ? 'Now tap another node to set B'
                          : 'Both selected — view each below'}
                      </Typography>
                    </Box>

                    {/* A / B slot cards */}
                    <Box sx={{ display: 'flex', gap: 1, p: 1.25 }}>
                      {(['A', 'B'] as const).map((slot, idx) => {
                        const slotId = compareIds[idx];
                        const snap = slotId ? pinTimeline.find(s => s.id === slotId) : null;
                        const snapIndex = snap ? pinTimeline.findIndex(s => s.id === snap.id) : -1;
                        const slotColor = slot === 'A' ? '#7c3aed' : '#d97706';
                        const isEmpty = !slotId;
                        return (
                          <Box
                            key={slot}
                            sx={{
                              flex: 1,
                              borderRadius: '8px',
                              border: `1.5px ${isEmpty ? 'dashed' : 'solid'} ${isEmpty ? colors.border : slotColor}`,
                              backgroundColor: isEmpty ? 'transparent' : slot === 'A' ? 'rgba(124,58,237,0.06)' : 'rgba(217,119,6,0.06)',
                              p: 1,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 0.5,
                              minWidth: 0,
                            }}
                          >
                            {/* Badge */}
                            <Box sx={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: isEmpty ? colors.borderLight : slotColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Typography sx={{ fontSize: '0.6875rem', fontWeight: 800, color: isEmpty ? colors.textSubdued : '#fff' }}>{slot}</Typography>
                            </Box>
                            {snap ? (
                              <>
                                <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textStrong, textAlign: 'center', lineHeight: 1.3 }} noWrap>
                                  {snap.isLatest ? 'Latest' : `Visit ${snapIndex + 1}`}
                                </Typography>
                                <Typography sx={{ fontSize: '0.625rem', color: colors.textMuted, textAlign: 'center' }} noWrap>
                                  {snap.dateLabel}
                                </Typography>
                                <Box
                                  onClick={() => { setActiveSnapId(slotId!); setPanoramaOverride(resolvePanorama(slotId!)); }}
                                  sx={{ mt: 0.25, px: 1, py: 0.375, borderRadius: '5px', backgroundColor: slotColor, color: '#fff', fontSize: '0.625rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', '&:hover': { opacity: 0.88 } }}
                                >
                                  View {slot}
                                </Box>
                              </>
                            ) : (
                              <Typography sx={{ fontSize: '0.625rem', color: colors.textSubdued, textAlign: 'center', lineHeight: 1.4 }}>
                                Tap node
                              </Typography>
                            )}
                          </Box>
                        );
                      })}
                    </Box>

                    {/* Clear button when both selected */}
                    {bothSelected && (
                      <Box
                        onClick={() => setCompareIds([null, null])}
                        sx={{ mx: 1.25, mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.625, borderRadius: '7px', border: `1px solid ${colors.borderLight}`, color: colors.textMuted, fontSize: '0.6875rem', fontWeight: 600, cursor: 'pointer', '&:hover': { borderColor: colors.danger, color: colors.danger } }}
                      >
                        <CloseRounded sx={{ fontSize: 12 }} /> Clear selection
                      </Box>
                    )}
                  </Box>
                )}

                {/* Viewing history indicator */}
                {isViewingHistory && !isComparing && (
                  <Box sx={{ mt: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.25, py: 0.75, borderRadius: '8px', backgroundColor: colors.warningBg, border: `1px solid rgba(217,119,6,0.2)` }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                      <HistoryRounded sx={{ fontSize: 13, color: colors.warning, flexShrink: 0 }} />
                      <Typography sx={{ fontSize: '0.6875rem', color: colors.warning, fontWeight: 600 }} noWrap>
                        {viewingSnap?.dateLabel ?? 'Historical view'}
                      </Typography>
                    </Box>
                    <Box
                      onClick={() => { setActiveSnapId(null); setPanoramaOverride(null); }}
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, fontSize: '0.6875rem', fontWeight: 600, color: colors.primary, cursor: 'pointer', flexShrink: 0, ml: 1, '&:hover': { opacity: 0.75 } }}
                    >
                      <CloseRounded sx={{ fontSize: 11 }} /> Latest
                    </Box>
                  </Box>
                )}
              </SidePanel>
            );
          })()}

          {/* Tour Metadata */}
          <SidePanel title="Tour Details" icon={<EventRounded sx={{ fontSize: 15 }} />}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {([
                { label: 'Captures', value: `${tour.captures} panoramas` },
                { label: 'Capture date', value: capture?.uploadedAt ?? tour.lastCapture },
              ] as const).map(({ label, value }) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>{label}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.textStrong, fontWeight: 600, textAlign: 'right' }}>{value}</Typography>
                </Box>
              ))}
            </Box>
          </SidePanel>


          {/* Digital-twin link back to the floor plan (7D) */}
          {floorId && (
            <Box component={Link} to={`/floor-plans/${tour.projectId}/${tour.towerId}/${floorId}?pinsOnly=1&returnTo=/tours/${tour.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderRadius: '12px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', textDecoration: 'none', '&:hover': { boxShadow: '0 6px 20px rgba(15,23,42,0.10)' }, transition: `box-shadow ${motion.durationFast}` }}>
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

          {/* Mark as Done Action */}
          {(tour.status === 'in_review' || (user?.role === 'manager' && (!(tour as any).managerReviewed || isMarkedDone))) && (
            <Box
              component="button"
              onClick={() => {
                if (!isMarkedDone) {
                  updateTour(tour.id, { status: 'published', managerReviewed: true } as any);
                  setIsMarkedDone(true);
                }
              }}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
                width: '100%', py: 1.5, borderRadius: '12px', cursor: isMarkedDone ? 'default' : 'pointer',
                border: isMarkedDone ? 'none' : `1.5px solid ${colors.border}`,
                backgroundColor: isMarkedDone ? '#10b981' : 'transparent',
                color: isMarkedDone ? '#fff' : colors.textStrong,
                fontSize: '0.9375rem', fontWeight: 600, transition: 'all 0.2s',
                '&:hover': isMarkedDone ? {} : {
                  borderColor: colors.primary,
                  backgroundColor: colors.primarySoft,
                  color: colors.primary
                },
                mt: 1
              }}
            >
              {isMarkedDone ? <CheckCircleRounded sx={{ fontSize: 18 }} /> : <CheckCircleRounded sx={{ fontSize: 18, color: 'inherit' }} />}
              {isMarkedDone ? 'Done' : 'Mark as done'}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
