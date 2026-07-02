import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip, CircularProgress } from '@mui/material';
import '@photo-sphere-viewer/core/index.css';
import {
  ArrowBackRounded, FullscreenRounded, FullscreenExitRounded, ViewInArRounded,
  LayersRounded, NavigateNextRounded, NavigateBefore,
  CameraAltRounded, ThreeSixtyRounded, PlayArrowRounded, PauseRounded,
  CheckCircleRounded, PublishRounded, HomeRounded, MeetingRoomRounded,
  EventRounded, MapRounded, CompareRounded, CloseRounded,
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

/** GPano pose / initial-view (degrees). Matches backend stitch metadata + XMP. */
export interface GpanoOrientation {
  poseHeadingDegrees: number;
  posePitchDegrees: number;
  poseRollDegrees: number;
  initialViewHeadingDegrees: number;
  initialViewPitchDegrees: number;
  initialHorizontalFovDegrees: number;
}

export const DEFAULT_GPANO_ORIENTATION: GpanoOrientation = {
  poseHeadingDegrees: 0,
  posePitchDegrees: 0,
  poseRollDegrees: 0,
  initialViewHeadingDegrees: 0,
  initialViewPitchDegrees: 0,
  initialHorizontalFovDegrees: 72,
};

function gpanoFromStitch(stitch: unknown): GpanoOrientation {
  const g = (stitch as { gpano?: Partial<GpanoOrientation> } | null | undefined)?.gpano;
  if (!g) return DEFAULT_GPANO_ORIENTATION;
  return {
    poseHeadingDegrees: g.poseHeadingDegrees ?? 0,
    posePitchDegrees: g.posePitchDegrees ?? 0,
    poseRollDegrees: g.poseRollDegrees ?? 0,
    initialViewHeadingDegrees: g.initialViewHeadingDegrees ?? 0,
    initialViewPitchDegrees: g.initialViewPitchDegrees ?? 0,
    initialHorizontalFovDegrees: g.initialHorizontalFovDegrees ?? 72,
  };
}

/** Map GPano InitialHorizontalFOVDegrees to PSV defaultZoomLvl (minFov=30, maxFov=90). */
function zoomLvlFromHfov(hfov: number, minFov = 30, maxFov = 90): number {
  const clamped = Math.min(maxFov, Math.max(minFov, hfov));
  return Math.round(((maxFov - clamped) / (maxFov - minFov)) * 100);
}

interface PanoramaViewerProps {
  panoramaUrl: string;
  tourId: string;
  autoRotate: boolean;
  onAutoRotateChange: (v: boolean) => void;
  hotspots: Array<{ id: string; yaw: number; pitch: number; label: string; targetTourId?: string }>;
  onHotspotClick: (targetTourId: string) => void;
  panoOrientation?: GpanoOrientation;
}

type CaptureMediaAsset = {
  original_url?: string;
  secure_url?: string;
  processed_panorama_url?: string | null;
  processedPanoramaUrl?: string | null;
  thumbnail_url?: string;
};

/** Prefer the stitched equirectangular URL over the raw upload original. */
function resolveCapturePanoramaUrl(
  mediaAssets: CaptureMediaAsset[] | undefined,
  cap?: MockCapture & Record<string, unknown>,
): string | null {
  const first = mediaAssets?.[0];
  return (
    first?.processed_panorama_url ??
    first?.processedPanoramaUrl ??
    (cap?.processedPanoramaUrl as string | undefined) ??
    (cap?.processed_panorama_url as string | undefined) ??
    first?.original_url ??
    first?.secure_url ??
    (cap?.originalFileUrl as string | undefined) ??
    null
  );
}

// How a capture should be projected in the viewer.
//   'flat'           → not ~2:1; a normal photo, shown as a plain image.
//   'dualfisheye'    → ~2:1 with dark corners; a RAW 360-camera file (two
//                      fisheye circles). Render with PSV's DualFisheyeAdapter as
//                      the legacy fallback when the backend couldn't stitch it.
//   'equirectangular'→ ~2:1 with filled corners; a genuine stitched 360. Rendered
//                      with the equirectangular adapter — seamless, correct drag.
type Projection = 'flat' | 'dualfisheye' | 'equirectangular';

const _RATIO_MIN = 1.8;
const _RATIO_MAX = 2.2;

/**
 * Classify a loaded image by BOTH aspect ratio and corner darkness.
 *
 * A raw dual-fisheye and a true equirectangular are BOTH ~2:1, so dimensions
 * alone cannot tell them apart (this is exactly why raw .insp files were being
 * sphere-projected as equirectangular and producing the black hourglass). The
 * decisive signal is the FOUR CORNERS: a dual-fisheye leaves large black corners
 * around each lens circle, whereas an equirectangular fills the whole frame.
 */
function classifyProjection(img: HTMLImageElement): Projection {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return 'flat';
  const ratio = w / h;
  if (ratio < _RATIO_MIN || ratio > _RATIO_MAX) return 'flat';

  // Sample the mean luminance of the four corners on a downscaled canvas.
  try {
    const cw = 128;
    const ch = 64;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'equirectangular';
    ctx.drawImage(img, 0, 0, cw, ch);
    const patch = 12; // corner box size in the downscaled space
    const corners: Array<[number, number]> = [
      [0, 0], [cw - patch, 0], [0, ch - patch], [cw - patch, ch - patch],
    ];
    let darkCorners = 0;
    for (const [sx, sy] of corners) {
      const { data } = ctx.getImageData(sx, sy, patch, patch);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      const meanLuma = sum / (data.length / 4);
      if (meanLuma < 24) darkCorners++; // near-black
    }
    // Dual-fisheye has black corners on both lens circles → ≥3 dark corners.
    return darkCorners >= 3 ? 'dualfisheye' : 'equirectangular';
  } catch {
    // CORS-tainted canvas (getImageData throws) — fall back to equirectangular.
    return 'equirectangular';
  }
}

function PanoramaViewer({ panoramaUrl, autoRotate, hotspots, onHotspotClick, panoOrientation = DEFAULT_GPANO_ORIENTATION }: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<import('@photo-sphere-viewer/core').Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // null = still probing; otherwise the resolved projection for this image.
  const [projection, setProjection] = useState<Projection | null>(null);
  // The adapter identity the current viewer was built with — a switch between
  // equirectangular and dual-fisheye needs a full rebuild (adapters differ).
  const builtProjectionRef = useRef<Projection | null>(null);

  // Probe the image (dimensions + corner darkness) before deciding how to render.
  useEffect(() => {
    let cancelled = false;
    setProjection(null);
    setError(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      setProjection(classifyProjection(img));
    };
    img.onerror = () => { if (!cancelled) { setError(true); setLoading(false); } };
    img.src = panoramaUrl;
    return () => { cancelled = true; };
  }, [panoramaUrl]);

  const is360 = projection === 'equirectangular' || projection === 'dualfisheye';

  useEffect(() => {
    // Only mount the sphere viewer for genuine 360 panoramas.
    if (!is360 || projection === null) { setLoading(false); return; }
    if (!containerRef.current) return;
    let destroyed = false;

    // Defensive: ensure no stale viewer survives on the container before we
    // create a new one (handles any prior leak).
    if (viewerRef.current) {
      try { viewerRef.current.destroy(); } catch { /* already gone */ }
      viewerRef.current = null;
    }

    const currentProjection = projection;

    async function initViewer() {
      setLoading(true);
      setError(false);

      try {
        const { Viewer, DualFisheyeAdapter } = await import('@photo-sphere-viewer/core');

        if (destroyed || !containerRef.current) return;

        const minFov = 30;
        const maxFov = 90;
        const isDual = currentProjection === 'dualfisheye';
        const {
          initialViewHeadingDegrees,
          initialViewPitchDegrees,
          initialHorizontalFovDegrees,
          poseHeadingDegrees,
          posePitchDegrees,
          poseRollDegrees,
        } = panoOrientation;

        // Cloudinary may strip JPEG XMP — pass GPano pose explicitly via panoData so
        // PSV matches Google Street View / Insta360 viewer conventions.
        const viewer = new Viewer({
          container: containerRef.current,
          panorama: panoramaUrl,
          ...(isDual ? { adapter: DualFisheyeAdapter } : {}),
          defaultZoomLvl: zoomLvlFromHfov(initialHorizontalFovDegrees, minFov, maxFov),
          minFov,
          maxFov,
          defaultYaw: isDual ? Math.PI : `${initialViewHeadingDegrees}deg`,
          defaultPitch: `${initialViewPitchDegrees}deg`,
          ...(isDual ? {} : {
            panoData: (image: { width: number; height: number }) => ({
              fullWidth: image.width,
              fullHeight: image.height,
              croppedWidth: image.width,
              croppedHeight: image.height,
              croppedX: 0,
              croppedY: 0,
              poseHeading: poseHeadingDegrees,
              posePitch: posePitchDegrees,
              poseRoll: poseRollDegrees,
              initialHeading: initialViewHeadingDegrees,
              initialPitch: initialViewPitchDegrees,
              initialFov: initialHorizontalFovDegrees,
            }),
          }),
          touchmoveTwoFingers: false,
          mousewheelCtrlKey: false,
          moveInertia: true,
          navbar: false,
          loadingTxt: '',
          loadingImg: '',
        });

        viewerRef.current = viewer;
        builtProjectionRef.current = currentProjection;

        viewer.addEventListener('ready', () => {
          if (!destroyed) setLoading(false);
        });

        viewer.addEventListener('error' as never, () => {
          if (!destroyed) { setLoading(false); setError(true); }
        });

      } catch (e) {
        if (!destroyed) { setLoading(false); setError(true); }
      }
    }

    initViewer();

    // Cleanup MUST destroy the viewer this effect created. React.StrictMode
    // double-invokes effects in dev (mount → cleanup → mount); if we only set a
    // flag and defer destroy to unmount, the first viewer leaks onto the same
    // container while a second is created — two live WebGL viewers with their own
    // render/animation loops = the "continuous, uncontrollable rotation" bug.
    // Destroying here guarantees exactly one live viewer at all times.
    return () => {
      destroyed = true;
      if (viewerRef.current) {
        try { viewerRef.current.destroy(); } catch { /* already gone */ }
        viewerRef.current = null;
        builtProjectionRef.current = null;
      }
    };
  }, [panoramaUrl, projection, is360, panoOrientation]);

  // Auto-rotate: advance yaw a small step each frame ONLY while enabled and the
  // user isn't interacting. Two correctness points learned the hard way:
  //   • PSV v5 has NO 'move-start'/'move-end' events (that was a silent no-op, so
  //     the loop never paused). The real pre-interaction event is 'before-rotate';
  //     we pause on it and resume shortly after the last one fires.
  //   • We write yaw directly via setOption-free `rotate()` with the CURRENT
  //     pitch so we never touch pitch/roll — no gimbal/tumble.
  const rafRef = useRef<number>(0);
  const lastUserInteractRef = useRef(0);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !autoRotate) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    // 'before-rotate' fires for BOTH programmatic and user rotation. We only want
    // to detect USER drags, so we stamp the time and treat any rotation within a
    // short window as "user active" — our own tiny auto-steps don't refresh it
    // because they happen on the next frame, well within the debounce.
    const onBeforeRotate = () => { lastUserInteractRef.current = performance.now(); };
    viewer.addEventListener('before-rotate' as never, onBeforeRotate);

    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      // Pause while the user was rotating in the last 400ms.
      if (now - lastUserInteractRef.current > 400) {
        try {
          const pos = viewer.getPosition();
          viewer.rotate({ yaw: pos.yaw + 0.12 * ((now - last) / 1000), pitch: pos.pitch });
        } catch { /* mid-transition */ }
      }
      last = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      viewer.removeEventListener('before-rotate' as never, onBeforeRotate);
    };
  }, [autoRotate]);

  if (error) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, background: '#0f1929' }}>
        <ThreeSixtyRounded sx={{ color: 'rgba(255,255,255,0.15)', fontSize: 80 }} />
        <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.875rem' }}>Could not load panorama</Typography>
      </Box>
    );
  }

  // Flat photo: show the frame contained with no sphere projection.
  if (projection === 'flat') {
    return (
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1929' }}>
        <Box
          component="img"
          src={panoramaUrl}
          alt="Capture"
          onError={() => setError(true)}
          sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
        />
        <Box sx={{ position: 'absolute', bottom: 12, right: 12, px: 1.25, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 0.625 }}>
          <CameraAltRounded sx={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }} />
          <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>Standard photo</Typography>
        </Box>
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
      {/* Hotspot overlay layer — rendered on top of PSV canvas.
          The wrapper is pointer-transparent (pointerEvents:'none') so a drag that
          starts on/near a marker passes THROUGH to the PSV canvas and rotates the
          sphere. Only the small marker dot re-enables pointer events for its click.
          This removes the marker interception that partially blocked free drag. */}
      {!loading && hotspots.map(hs => (
        <Box
          key={hs.id}
          sx={{
            position: 'absolute',
            // Approximate screen position from yaw/pitch for the overlay markers.
            // PSV handles the actual projection; these are visual hints only.
            left: `${50 + (hs.yaw / 180) * 40}%`,
            top: `${50 - (hs.pitch / 90) * 30}%`,
            transform: 'translate(-50%, -50%)',
            zIndex: 3,
            pointerEvents: 'none',
            '&:hover .hs-label': { opacity: 1, transform: 'translateY(-4px)' },
          }}
        >
          <Box
            onClick={() => hs.targetTourId && onHotspotClick(hs.targetTourId)}
            sx={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: hs.targetTourId ? 'pointer' : 'default', pointerEvents: hs.targetTourId ? 'auto' : 'none' }}
          >
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
  // tourMedia.steps is only populated in-memory after publishFloorPlanTour(); after a
  // page refresh the store rehydrates from the API without steps, so we derive them
  // live from capturePins whenever the stored array is absent.
  const derivedSteps = useMemo(() => {
    const tourFloorPlanId = (tourMedia as unknown as Record<string, unknown>)?.floorPlanId as string | undefined;
    if (!tourFloorPlanId) return [];
    const pins = capturePins
      .filter(p => p.floorPlanId === tourFloorPlanId)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    return pins.flatMap(pin => {
      const latestCaptureId = pin.captureIds[pin.captureIds.length - 1];
      if (!latestCaptureId) return [];
      const cap = captures.find(c => c.id === latestCaptureId) as (MockCapture & Record<string, unknown>) | undefined;
      const mediaAssets = (cap?.mediaAssets as CaptureMediaAsset[] | undefined) ?? [];
      const panoramaUrl = resolveCapturePanoramaUrl(mediaAssets, cap);
      return [{
        pinId: pin.id,
        captureId: latestCaptureId,
        sequenceNumber: pin.sequenceNumber,
        label: `Pin ${pin.sequenceNumber}`,
        panoramaUrl,
        thumbnailUrl: (mediaAssets[0]?.thumbnail_url ?? (cap?.thumbnailUrl as string | undefined)) ?? null,
      }];
    });
  }, [tourMedia, capturePins, captures]);

  const steps = (tourMedia?.steps && tourMedia.steps.length > 0) ? tourMedia.steps : derivedSteps;
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
    if (!currentStep) return [];

    // Resolve the live pin for this walkthrough stop. A published tour stores its
    // steps[] (pinId/captureId) in the backend, so those references can go stale
    // after the data is re-hydrated from the API or after a floor's pins are
    // deleted and re-captured (new pin IDs). Fall back through increasingly loose
    // keys so the timeline never silently disappears.
    const tourFloorPlanId = (tourMedia as unknown as Record<string, unknown>)?.floorPlanId as string | undefined;
    const pin =
      capturePins.find(p => p.id === currentStep.pinId) ??
      (currentStep.captureId
        ? capturePins.find(p => p.captureIds.includes(currentStep.captureId))
        : undefined) ??
      (tourFloorPlanId
        ? capturePins.find(p => p.floorPlanId === tourFloorPlanId && p.sequenceNumber === currentStep.sequenceNumber)
        : undefined);

    const toSnapshot = (id: string, i: number, total: number): CaptureSnapshot => {
      const cap = captures.find(c => c.id === id) as (MockCapture & Record<string, unknown>) | undefined;
      const isLatest = i === total - 1;
      const uploadedAt = (cap?.uploadedAt as string | undefined) ?? '';
      const dateLabel = uploadedAt ? uploadedAt.split(',')[0] : `Visit ${i + 1}`;
      return {
        id,
        baseCaptureId: id,
        roomId: cap?.roomId ?? pin?.roomId ?? '',
        date: (cap?.capturedAt as string | undefined) ?? '',
        dateLabel,
        monthLabel: '',
        reviewStatus: (cap?.reviewStatus as CaptureSnapshot['reviewStatus'] | undefined) ?? 'uploaded',
        progress: isLatest ? 100 : Math.round(((i + 1) / total) * 100),
        fileCount: cap?.fileCount ?? 0,
        capturedBy: (cap?.uploadedBy as string | undefined) ?? '',
        note: null,
        gradient: (cap?.gradient as string | undefined) ?? 'linear-gradient(135deg,#1e3a5f,#0f2340)',
        isLatest,
      } satisfies CaptureSnapshot;
    };

    // Preferred: full multi-visit history from the live pin.
    if (pin && pin.captureIds.length > 0) {
      return pin.captureIds.map((id, i) => toSnapshot(id, i, pin.captureIds.length));
    }

    // Fallback: surface at least this step's own capture so every published
    // walkthrough stop shows a timeline.
    if (currentStep.captureId) {
      return [toSnapshot(currentStep.captureId, 0, 1)];
    }

    return [];
  }, [currentStep, capturePins, captures, tourMedia]);

  // The snapshot currently shown (defaults to latest). Validate against the
  // current pin's timeline so a stale selection from a previously-viewed pin
  // (the reset effect runs post-commit, one render later) can never highlight a
  // node that doesn't belong to this step.
  const timelineIds = useMemo(() => new Set(pinTimeline.map(s => s.id)), [pinTimeline]);
  const validActiveSnapId = activeSnapId && timelineIds.has(activeSnapId) ? activeSnapId : null;
  const validCompareIds: [string | null, string | null] = [
    compareIds[0] && timelineIds.has(compareIds[0]) ? compareIds[0] : null,
    compareIds[1] && timelineIds.has(compareIds[1]) ? compareIds[1] : null,
  ];
  const effectiveSnapId = validActiveSnapId ?? (pinTimeline.length > 0 ? pinTimeline[pinTimeline.length - 1].id : '');

  const resolvePanorama = useCallback((captureId: string): string | null => {
    const cap = captures.find(c => c.id === captureId) as (MockCapture & Record<string, unknown>) | undefined;
    if (!cap) return null;
    const mediaAssets = (cap.mediaAssets as CaptureMediaAsset[] | undefined) ?? [];
    return resolveCapturePanoramaUrl(mediaAssets, cap);
  }, [captures]);

  const resolveGpanoOrientation = useCallback((captureId: string): GpanoOrientation => {
    const cap = captures.find(c => c.id === captureId) as (MockCapture & Record<string, unknown>) | undefined;
    if (!cap) return DEFAULT_GPANO_ORIENTATION;
    const mediaAssets = (cap.mediaAssets as Array<{ stitch?: unknown }> | undefined) ?? [];
    return gpanoFromStitch(mediaAssets[0]?.stitch);
  }, [captures]);

  const activeCaptureId = validActiveSnapId ?? currentStep?.captureId ?? tour.captureId ?? '';
  const panoOrientation = useMemo(
    () => (activeCaptureId ? resolveGpanoOrientation(activeCaptureId) : DEFAULT_GPANO_ORIENTATION),
    [activeCaptureId, resolveGpanoOrientation],
  );

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
      borderRadius: fullscreen ? 0 : { xs: '16px', md: '20px' },
      height: fullscreen ? '100vh' : '100%',
      // Mobile: fill most of the viewport height so no scrolling is needed to see the panorama.
      // Desktop: keep the 560px floor so the rail panels beside it have room.
      minHeight: fullscreen ? '100vh' : { xs: 'min(56vw, 340px)', sm: 400, md: 560 },
      maxHeight: fullscreen ? 'none' : { xs: 'min(56vw, 380px)', sm: 'none' },
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#0f1929',
      '& .psv-container': { borderRadius: fullscreen ? 0 : { xs: '16px', md: '20px' } },
    }}>
      <PanoramaViewer
        panoramaUrl={panoramaUrl}
        tourId={tourId ?? ''}
        autoRotate={autoRotate}
        onAutoRotateChange={setAutoRotate}
        hotspots={hotspots}
        onHotspotClick={handleHotspotClick}
        panoOrientation={panoOrientation}
      />

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
      {validActiveSnapId && validActiveSnapId !== pinTimeline[pinTimeline.length - 1]?.id && (
        <Box sx={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 15, display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, borderRadius: '999px', backgroundColor: 'rgba(217,119,6,0.9)', backdropFilter: 'blur(8px)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
          <HistoryRounded sx={{ fontSize: 13, color: '#fff' }} />
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff' }}>
            {pinTimeline.find(s => s.id === validActiveSnapId)?.dateLabel ?? 'Historical view'}
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

      {/* Prev/Next navigation — moved to the BOTTOM-LEFT corner (away from the
          left/right vertical-centre edges) so they no longer intercept the
          horizontal drag needed to rotate the 360 panorama. The full-height
          centre-edge buttons previously swallowed every left/right drag, making
          the sphere feel like it only moved vertically. */}
      {isWalkthrough ? (
        <Box sx={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 0.75, zIndex: 12 }}>
          <Box onClick={() => setStepIdx(i => Math.max(0, i - 1))} sx={{ visibility: clampedStep > 0 ? 'visible' : 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: '#fff', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' } }}>
            <NavigateBefore sx={{ fontSize: 22 }} />
          </Box>
          <Box onClick={() => setStepIdx(i => Math.min(steps.length - 1, i + 1))} sx={{ visibility: clampedStep < steps.length - 1 ? 'visible' : 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: '#fff', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' } }}>
            <NavigateNextRounded sx={{ fontSize: 22 }} />
          </Box>
        </Box>
      ) : (
        <Box sx={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 0.75, zIndex: 12 }}>
          {prevTour && (
            <Box component={Link} to={`/tours/${prevTour.id}`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', color: '#fff', textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(0,0,0,0.65)' } }}>
              <NavigateBefore sx={{ fontSize: 20 }} />
            </Box>
          )}
          {nextTour && (
            <Box component={Link} to={`/tours/${nextTour.id}`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)', color: '#fff', textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(0,0,0,0.65)' } }}>
              <NavigateNextRounded sx={{ fontSize: 20 }} />
            </Box>
          )}
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
      {/* ── Header bar ────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: { xs: 1.5, md: 2.5 } }}>
        <Box component={Link} to="/tours" sx={{ cursor: 'pointer', border: 'none', color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', width: 30, height: 30, borderRadius: '8px', justifyContent: 'center', backgroundColor: colors.card, boxShadow: '0 1px 3px rgba(15,23,42,0.06)', '&:hover': { color: colors.textStrong }, flexShrink: 0 }}>
          <ArrowBackRounded sx={{ fontSize: 18 }} />
        </Box>

        {/* Mobile: show only tower + floor + room; Desktop: full breadcrumb */}
        <Box sx={{ flex: 1, minWidth: 0, display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
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

        {/* Mobile condensed breadcrumb: Tower › Floor › Room */}
        <Box sx={{ flex: 1, minWidth: 0, display: { xs: 'flex', sm: 'none' }, flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, overflow: 'hidden' }}>
            <Typography noWrap sx={{ fontSize: '0.6875rem', color: colors.textMuted, fontWeight: 500, flexShrink: 1, minWidth: 0 }}>
              {tour.towerName} › {tour.floorLabel}
            </Typography>
          </Box>
          <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong, lineHeight: 1.2 }}>
            {tour.roomName}
          </Typography>
        </Box>

        <Chip label={ts.label} size="small" sx={{ height: 22, fontSize: '0.625rem', fontWeight: 600, color: ts.color, backgroundColor: ts.bg, borderRadius: '6px', flexShrink: 0 }} />
      </Box>

      {/* ── Viewer + right rail ───────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', gap: 2.5, alignItems: 'stretch', flexDirection: { xs: 'column', lg: 'row' } }}>
        {/* Viewer — dominant */}
        <Box sx={{ flex: 1, minWidth: 0 }}>{viewer}</Box>

        {/* Right rail — hidden on mobile, shown on lg+ */}
        <Box sx={{ width: { xs: '100%', lg: 320 }, flexShrink: 0, display: { xs: 'none', lg: 'flex' }, flexDirection: 'column', gap: 2 }}>

          {/* Progress Timeline — real pin history, inline panorama switching */}
          {pinTimeline.length > 0 && (() => {
            // Use timeline-validated selections so stale state from a previously
            // viewed pin never highlights the wrong nodes.
            const compareIds = validCompareIds;
            const activeSnapId = validActiveSnapId;
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

      {/* ── Mobile-only panel strip (lg+ hides this; right rail shows instead) ── */}
      <Box sx={{ display: { xs: 'flex', lg: 'none' }, flexDirection: 'column', gap: 1.5, mt: 2 }}>

        {/* Progress Timeline — full width card on mobile */}
        {pinTimeline.length > 0 && (() => {
          // Timeline-validated selections (see desktop rail note above).
          const compareIds = validCompareIds;
          const activeSnapId = validActiveSnapId;
          const isComparing = !!(compareIds[0] || compareIds[1]);
          const bothSelected = !!(compareIds[0] && compareIds[1]);
          const latestSnap = pinTimeline[pinTimeline.length - 1];
          const isViewingHistory = !!(activeSnapId && activeSnapId !== latestSnap?.id);
          const viewingSnap = isViewingHistory ? pinTimeline.find(s => s.id === activeSnapId) : null;
          return (
            <Box sx={{ borderRadius: '14px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.25, borderBottom: `1px solid ${colors.borderLight}` }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <HistoryRounded sx={{ fontSize: 14, color: colors.textMuted }} />
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.textStrong }}>Progress Timeline</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, ml: 0.5 }}>
                    <Box sx={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#16a34a' }} />
                    <Typography sx={{ fontSize: '0.625rem', fontWeight: 700, color: '#16a34a' }}>
                      {pinTimeline.length} capture{pinTimeline.length !== 1 ? 's' : ''}
                    </Typography>
                  </Box>
                </Box>
                {pinTimeline.length > 1 && (
                  <Box
                    onClick={() => setCompareIds(isComparing ? [null, null] : [latestSnap.id, null])}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '6px', cursor: 'pointer', fontSize: '0.625rem', fontWeight: 600, backgroundColor: isComparing ? 'rgba(124,58,237,0.1)' : colors.bg, color: isComparing ? '#7c3aed' : colors.textMuted, border: `1px solid ${isComparing ? '#7c3aed' : colors.borderLight}` }}
                  >
                    {isComparing ? <CloseRounded sx={{ fontSize: 11 }} /> : <CompareRounded sx={{ fontSize: 11 }} />}
                    {isComparing ? 'Cancel' : 'Compare'}
                  </Box>
                )}
              </Box>
              <Box sx={{ p: 1.5 }}>
                <CaptureTimeline
                  series={pinTimeline}
                  activeId={effectiveSnapId}
                  onSelect={handleSnapSelect}
                  compareIds={isComparing ? compareIds : undefined}
                  compareMode={isComparing}
                />
                {/* Compare slots */}
                {isComparing && (
                  <Box sx={{ mt: 1.25, borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(124,58,237,0.18)', backgroundColor: 'rgba(124,58,237,0.04)' }}>
                    <Box sx={{ px: 1.25, py: 0.875, borderBottom: '1px solid rgba(124,58,237,0.12)', display: 'flex', alignItems: 'center', gap: 0.625 }}>
                      <CompareRounded sx={{ fontSize: 12, color: '#7c3aed', flexShrink: 0 }} />
                      <Typography sx={{ fontSize: '0.6875rem', color: '#7c3aed', fontWeight: 600 }}>
                        {!compareIds[0] ? 'Tap a node above to set A' : !compareIds[1] ? 'Now tap another node to set B' : 'Both selected'}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, p: 1 }}>
                      {(['A', 'B'] as const).map((slot, idx) => {
                        const slotId = compareIds[idx];
                        const snap = slotId ? pinTimeline.find(s => s.id === slotId) : null;
                        const snapIndex = snap ? pinTimeline.findIndex(s => s.id === snap.id) : -1;
                        const slotColor = slot === 'A' ? '#7c3aed' : '#d97706';
                        return (
                          <Box key={slot} sx={{ flex: 1, borderRadius: '8px', border: `1.5px ${!slotId ? 'dashed' : 'solid'} ${!slotId ? colors.border : slotColor}`, backgroundColor: !slotId ? 'transparent' : slot === 'A' ? 'rgba(124,58,237,0.06)' : 'rgba(217,119,6,0.06)', p: 0.875, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.375 }}>
                            <Box sx={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: !slotId ? colors.borderLight : slotColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Typography sx={{ fontSize: '0.625rem', fontWeight: 800, color: !slotId ? colors.textSubdued : '#fff' }}>{slot}</Typography>
                            </Box>
                            {snap ? (
                              <>
                                <Typography sx={{ fontSize: '0.625rem', fontWeight: 600, color: colors.textStrong, textAlign: 'center' }} noWrap>
                                  {snap.isLatest ? 'Latest' : `Visit ${snapIndex + 1}`}
                                </Typography>
                                <Box onClick={() => { setActiveSnapId(slotId!); setPanoramaOverride(resolvePanorama(slotId!)); }} sx={{ px: 0.875, py: 0.25, borderRadius: '4px', backgroundColor: slotColor, color: '#fff', fontSize: '0.5625rem', fontWeight: 700, cursor: 'pointer' }}>
                                  View {slot}
                                </Box>
                              </>
                            ) : (
                              <Typography sx={{ fontSize: '0.5625rem', color: colors.textSubdued, textAlign: 'center' }}>Tap node</Typography>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                    {bothSelected && (
                      <Box onClick={() => setCompareIds([null, null])} sx={{ mx: 1, mb: 0.875, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.5, borderRadius: '6px', border: `1px solid ${colors.borderLight}`, color: colors.textMuted, fontSize: '0.625rem', fontWeight: 600, cursor: 'pointer' }}>
                        <CloseRounded sx={{ fontSize: 11 }} /> Clear
                      </Box>
                    )}
                  </Box>
                )}
                {isViewingHistory && !isComparing && (
                  <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.625, borderRadius: '7px', backgroundColor: colors.warningBg, border: '1px solid rgba(217,119,6,0.2)' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <HistoryRounded sx={{ fontSize: 12, color: colors.warning }} />
                      <Typography sx={{ fontSize: '0.625rem', color: colors.warning, fontWeight: 600 }} noWrap>{viewingSnap?.dateLabel ?? 'Historical view'}</Typography>
                    </Box>
                    <Box onClick={() => { setActiveSnapId(null); setPanoramaOverride(null); }} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, fontSize: '0.625rem', fontWeight: 600, color: colors.primary, cursor: 'pointer', ml: 1 }}>
                      <CloseRounded sx={{ fontSize: 10 }} /> Latest
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>
          );
        })()}

        {/* Tour meta */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, px: 1.5, py: 1.125, borderRadius: '12px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.625, flexShrink: 0 }}>
            <CameraAltRounded sx={{ fontSize: 14, color: colors.textSubdued }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>{tour.captures}</Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>captures</Typography>
          </Box>
          <Box sx={{ flexShrink: 0, width: '1px', height: 14, backgroundColor: colors.borderLight, mx: 1.5 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.625, minWidth: 0 }}>
            <EventRounded sx={{ fontSize: 14, color: colors.textSubdued, flexShrink: 0 }} />
            <Typography noWrap sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{capture?.uploadedAt ?? tour.lastCapture}</Typography>
          </Box>
        </Box>

        {/* Floor plan link */}
        {floorId && (
          <Box component={Link} to={`/floor-plans/${tour.projectId}/${tour.towerId}/${floorId}?pinsOnly=1&returnTo=/tours/${tour.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderRadius: '12px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', textDecoration: 'none' }}>
            <Box sx={{ width: 30, height: 30, borderRadius: '8px', backgroundColor: colors.primarySoft, color: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <MapRounded sx={{ fontSize: 16 }} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>View on floor plan</Typography>
              <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>See this room in context</Typography>
            </Box>
            <NavigateNextRounded sx={{ fontSize: 18, color: colors.textSubdued }} />
          </Box>
        )}

        {/* Mark as done */}
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
              width: '100%', py: 1.375, borderRadius: '12px', cursor: isMarkedDone ? 'default' : 'pointer',
              border: isMarkedDone ? 'none' : `1.5px solid ${colors.border}`,
              backgroundColor: isMarkedDone ? '#10b981' : 'transparent',
              color: isMarkedDone ? '#fff' : colors.textStrong,
              fontSize: '0.9375rem', fontWeight: 600, transition: 'all 0.2s',
              '&:hover': isMarkedDone ? {} : { borderColor: colors.primary, backgroundColor: colors.primarySoft, color: colors.primary },
            }}
          >
            <CheckCircleRounded sx={{ fontSize: 18 }} />
            {isMarkedDone ? 'Done' : 'Mark as done'}
          </Box>
        )}
      </Box>
    </Box>
  );
}
