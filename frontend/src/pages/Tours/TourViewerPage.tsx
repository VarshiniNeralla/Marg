import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip, CircularProgress } from '@mui/material';
import '@photo-sphere-viewer/core/index.css';
import {
  ArrowBackRounded, FullscreenRounded, FullscreenExitRounded, ViewInArRounded,
  LayersRounded, NavigateNextRounded, NavigateBefore,
  CameraAltRounded, ThreeSixtyRounded, PlayArrowRounded, PauseRounded,
  CheckCircleRounded, PublishRounded, HomeRounded, MeetingRoomRounded,
  MapRounded, CompareRounded, CloseRounded,
  HistoryRounded, AutoAwesomeRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  getTourById, statusConfig, mockTours, mockTowers, getFloors, mockCaptures,
  type CaptureSnapshot,
} from '@/data/mockData';
import CaptureTimeline from '@shared/components/CaptureTimeline/CaptureTimeline';
import TourFloorPlanPanel from '@/pages/Tours/TourFloorPlanPanel';
import ProgressAnalysisDrawer from '@/pages/Tours/ProgressAnalysisDrawer';
import PreviousReportsPanel from '@/pages/Tours/PreviousReportsPanel';
import { progressAnalysisService, type ProgressAnalysisReport, type ProgressReportSummary, type ProgressReportVisualMeta } from '@/services/progressAnalysisService';
import { formatReportDate, formatReportDateRange, formatCapturePreviewDate, orderCapturesChronologically, parseCaptureTimestamp } from '@/utils/reportFormat';
import { formatPinLocationLabel, formatCaptureDateTime } from '@/utils/pinLabels';
import { toast } from 'react-toastify';
import { useWorkflowStore } from '@store/workflowStore';
import { getFloorPlanByFloor, getCapturePinsByFloorPlan } from '@store/workflowSelectors';
import { useAuthStore, isManagerOrAdmin, isManager, isFieldEngineer } from '@store/authStore';
import { ownCaptureIdSet, pinCaptureIdsForUser } from '@/utils/captureOwnership';
import { getCapturePinsForFloor } from '@store/workflowSelectors';
import type { MockCapture } from '@/data/mockData';
import { resolveMediaUrl } from '@/config/env';

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

function CompareAnalyzeButton({
  loading,
  disabled,
  onClick,
}: {
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      onClick={loading || disabled ? undefined : onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.75,
        py: 1,
        px: 1.5,
        borderRadius: '10px',
        cursor: loading || disabled ? 'default' : 'pointer',
                        backgroundColor: loading ? 'rgba(37,99,235,0.08)' : colors.primary,
        color: loading ? colors.primary : '#fff',
        fontSize: '0.8125rem',
        fontWeight: 700,
        opacity: disabled && !loading ? 0.5 : 1,
        transition: 'opacity 0.2s, background-color 0.15s',
        '&:hover': loading || disabled ? {} : { backgroundColor: colors.primaryHover },
      }}
    >
      {loading ? (
        <>
          <CircularProgress size={14} sx={{ color: colors.primary }} />
          Analyzing…
        </>
      ) : (
        <>
          <AutoAwesomeRounded sx={{ fontSize: 16 }} />
          Analyze progress
        </>
      )}
    </Box>
  );
}

/** Compact A | B selection row — replaces the tall slot cards. */
function CompareSlotRow({
  compareIds,
  pinTimeline,
  onView,
}: {
  compareIds: [string | null, string | null];
  pinTimeline: { id: string; dateLabel: string; isLatest?: boolean }[];
  onView: (id: string) => void;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      {(['A', 'B'] as const).map((slot, idx) => {
        const slotId = compareIds[idx];
        const snap = slotId ? pinTimeline.find(s => s.id === slotId) : null;
        const snapIndex = snap ? pinTimeline.findIndex(s => s.id === snap.id) : -1;
        const slotColor = slot === 'A' ? '#7c3aed' : '#d97706';
        const isEmpty = !slotId;
        return (
          <React.Fragment key={slot}>
            {idx === 1 && (
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.textSubdued, flexShrink: 0 }}>
                →
              </Typography>
            )}
            <Box
              onClick={() => { if (slotId) onView(slotId); }}
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                minWidth: 0,
                px: 1,
                py: 0.75,
                borderRadius: '10px',
                border: `1.5px ${isEmpty ? 'dashed' : 'solid'} ${isEmpty ? colors.borderLight : slotColor}`,
                backgroundColor: isEmpty ? colors.bg : slot === 'A' ? 'rgba(124,58,237,0.05)' : 'rgba(217,119,6,0.05)',
                cursor: slotId ? 'pointer' : 'default',
              }}
            >
              <Box
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: '6px',
                  flexShrink: 0,
                  backgroundColor: isEmpty ? colors.borderLight : slotColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography sx={{ fontSize: '0.625rem', fontWeight: 800, color: isEmpty ? colors.textSubdued : '#fff' }}>
                  {slot}
                </Typography>
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                {snap ? (
                  <>
                    <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.textStrong, lineHeight: 1.2 }} noWrap>
                      {snap.isLatest ? 'Latest' : `Visit ${snapIndex + 1}`}
                    </Typography>
                    <Typography sx={{ fontSize: '0.5625rem', color: colors.textMuted, lineHeight: 1.3 }} noWrap>
                      {snap.dateLabel}
                    </Typography>
                  </>
                ) : (
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, fontWeight: 500 }}>
                    Tap timeline
                  </Typography>
                )}
              </Box>
            </Box>
          </React.Fragment>
        );
      })}
    </Box>
  );
}

function CompareWillAnalyzePreview({
  before,
  after,
}: {
  before: { label: string; date: string; imageUrl?: string | null; captureId?: string };
  after: { label: string; date: string; imageUrl?: string | null; captureId?: string };
}) {
  const rows = [
    { tag: 'Before', color: '#2563eb', bg: '#dbeafe', ...before },
    { tag: 'After', color: '#16a34a', bg: '#dcfce7', ...after },
  ] as const;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
      {rows.map(row => (
        <Box
          key={row.tag}
          sx={{
            borderRadius: '10px',
            overflow: 'hidden',
            border: `1px solid ${colors.borderLight}`,
            backgroundColor: '#fff',
          }}
        >
          {row.imageUrl ? (
            <Box
              sx={{
                width: '100%',
                aspectRatio: '16 / 9',
                backgroundColor: '#0f1929',
                overflow: 'hidden',
              }}
            >
              <Box
                component="img"
                key={`${row.captureId ?? row.tag}-${row.imageUrl}`}
                src={row.imageUrl}
                alt={row.tag}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </Box>
          ) : (
            <Box sx={{ height: 56, backgroundColor: colors.bg }} />
          )}
          <Box sx={{ px: 0.875, py: 0.625 }}>
            <Box sx={{ display: 'inline-flex', px: 0.5, py: 0.125, borderRadius: '4px', backgroundColor: row.bg, mb: 0.25 }}>
              <Typography sx={{ fontSize: '0.5rem', fontWeight: 800, color: row.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {row.tag}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textStrong, lineHeight: 1.2 }} noWrap>
              {row.label}
            </Typography>
            <Typography sx={{ fontSize: '0.5625rem', color: colors.textMuted }} noWrap>
              {row.date}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

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

// ── Header actions: floor plan link, review approve, status chip ───────────────

function TourViewerHeaderActions({
  floorPlanTo,
  statusChip,
  tour,
  canReview,
  isMarkedDone,
  onApproveReview,
}: {
  floorPlanTo: string | null;
  statusChip: { label: string; color: string; bg: string };
  tour: NonNullable<ReturnType<typeof getTourById>>;
  canReview: boolean;
  isMarkedDone: boolean;
  onApproveReview: () => void;
}) {
  const needsReview = tour.status === 'in_review' || (tour.status === 'published' && !tour.managerReviewed);
  const showApprove = canReview && needsReview && !isMarkedDone && !tour.managerReviewed;
  const showReviewedBadge = canReview && (isMarkedDone || tour.managerReviewed);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
      {floorPlanTo && (
        <Tooltip title="View this room on the floor plan">
          <Box
            component={Link}
            to={floorPlanTo}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              px: { xs: 0.75, sm: 1 },
              py: 0.5,
              borderRadius: '8px',
              textDecoration: 'none',
              color: colors.textMuted,
              border: `1px solid ${colors.borderLight}`,
              backgroundColor: colors.card,
              transition: `all ${motion.durationFast}`,
              '&:hover': {
                color: colors.primary,
                borderColor: colors.primary,
                backgroundColor: colors.primarySoft,
              },
            }}
          >
            <MapRounded sx={{ fontSize: 15 }} />
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, display: { xs: 'none', sm: 'block' }, lineHeight: 1 }}>
              Floor plan
            </Typography>
          </Box>
        </Tooltip>
      )}

      {showApprove && (
        <Tooltip title="Confirm captures look correct and complete your manager review">
          <Box
            component="button"
            onClick={onApproveReview}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              px: { xs: 0.75, sm: 1.25 },
              py: 0.5,
              borderRadius: '8px',
              cursor: 'pointer',
              border: 'none',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(16,185,129,0.28)',
              transition: `all ${motion.durationFast}`,
              '&:hover': { opacity: 0.92, boxShadow: '0 4px 14px rgba(16,185,129,0.35)' },
            }}
          >
            <CheckCircleRounded sx={{ fontSize: 15 }} />
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, display: { xs: 'none', sm: 'block' }, lineHeight: 1, whiteSpace: 'nowrap' }}>
              {tour.status === 'in_review' ? 'Approve tour' : 'Complete review'}
            </Typography>
          </Box>
        </Tooltip>
      )}

      {showReviewedBadge && (
        <Chip
          icon={<CheckCircleRounded sx={{ fontSize: '14px !important' }} />}
          label="Reviewed"
          size="small"
          sx={{
            height: 24,
            fontSize: '0.625rem',
            fontWeight: 700,
            color: '#16a34a',
            backgroundColor: 'rgba(22,163,74,0.1)',
            borderRadius: '6px',
            '& .MuiChip-icon': { color: '#16a34a' },
          }}
        />
      )}

      <Chip
        label={statusChip.label}
        size="small"
        sx={{
          height: 22,
          fontSize: '0.625rem',
          fontWeight: 600,
          color: statusChip.color,
          backgroundColor: statusChip.bg,
          borderRadius: '6px',
        }}
      />
    </Box>
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
  const raw =
    first?.processed_panorama_url ??
    first?.processedPanoramaUrl ??
    (cap?.processedPanoramaUrl as string | undefined) ??
    (cap?.processed_panorama_url as string | undefined) ??
    first?.original_url ??
    first?.secure_url ??
    (cap?.originalFileUrl as string | undefined) ??
    null;
  return resolveMediaUrl(raw);
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
  // Keep latest auto-rotate intent for the viewer `ready` handler (viewer rebuilds
  // when the panorama changes; the button state must still apply after ready).
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

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
        const { AutorotatePlugin } = await import('@photo-sphere-viewer/autorotate-plugin');

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
          plugins: [
            // Official plugin — continuous yaw at a stable rpm.
            // autostartDelay MUST be null: 0 (or the default 2000) starts rotation
            // on idle without the toolbar button, which confused tour viewers.
            AutorotatePlugin.withConfig({
              autostartDelay: null,
              autostartOnIdle: false,
              autorotateSpeed: '1.5rpm',
            }),
          ],
        });

        viewerRef.current = viewer;
        builtProjectionRef.current = currentProjection;

        viewer.addEventListener('ready', () => {
          if (destroyed) return;
          setLoading(false);
          try {
            const plugin = viewer.getPlugin(AutorotatePlugin);
            if (!plugin) return;
            // Belt-and-suspenders: never leave the plugin spinning unless the
            // toolbar toggle is on.
            if (autoRotateRef.current) plugin.start();
            else plugin.stop();
          } catch { /* plugin not ready */ }
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

  // Drive the official AutorotatePlugin from the toolbar button.
  // (Previous custom RAF + before-rotate pause fought itself: each programmatic
  // rotate looked like a user drag, so motion became a tiny jerk every ~400ms.)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || loading) return;
    let cancelled = false;
    void import('@photo-sphere-viewer/autorotate-plugin').then(({ AutorotatePlugin }) => {
      if (cancelled) return;
      const plugin = viewer.getPlugin(AutorotatePlugin);
      if (!plugin) return;
      try {
        if (autoRotate) plugin.start();
        else plugin.stop();
      } catch { /* viewer tearing down */ }
    });
    return () => { cancelled = true; };
  }, [autoRotate, loading, panoramaUrl]);

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
  const location = useLocation();
  const tours = useWorkflowStore(s => s.tours);
  const captures = useWorkflowStore(s => s.captures);
  const publishTour = useWorkflowStore(s => s.publishTour);
  const updateTour = useWorkflowStore(s => s.updateTour);
  const floors = useWorkflowStore(s => s.floors);
  const user = useAuthStore(s => s.user);
  const canViewPreviousReports = isManagerOrAdmin(user);
  const ownCaptureIds = isFieldEngineer(user) ? ownCaptureIdSet(captures, user) : null;
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const tour = tours.find(t => t.id === tourId) ?? getTourById(tourId ?? '');

  const navState = location.state as { from?: string; fromLabel?: string } | null;
  const listBackTo = navState?.from === '/reviews' ? '/reviews' : '/tours';
  const listBackLabel = navState?.fromLabel ?? (listBackTo === '/reviews' ? 'Reviews' : 'Virtual Tours');

  useEffect(() => {
    setIsMarkedDone(Boolean(tour?.managerReviewed));
  }, [tour?.id, tour?.managerReviewed]);

  const capturePins = useWorkflowStore(s => s.capturePins);

  const [fullscreen, setFullscreen] = useState(false);
  // Floor-plan navigator stays available in normal and fullscreen view.
  const [showFloorPlan, setShowFloorPlan] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [isMarkedDone, setIsMarkedDone] = useState(false);
  const [activeSnapId, setActiveSnapId] = useState<string | null>(null);
  // Per-step: panorama override when user selects a historical snapshot.
  const [panoramaOverride, setPanoramaOverride] = useState<string | null>(null);
  // Compare mode: two snapshot IDs to compare.
  const [compareIds, setCompareIds] = useState<[string | null, string | null]>([null, null]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisReport, setAnalysisReport] = useState<ProgressAnalysisReport | null>(null);
  const [analysisDrawerOpen, setAnalysisDrawerOpen] = useState(false);
  const [analysisMeta, setAnalysisMeta] = useState<ProgressReportVisualMeta | null>(null);
  const [analysisReportId, setAnalysisReportId] = useState<string | null>(null);
  const [analysisSaved, setAnalysisSaved] = useState(false);
  const [analysisSaveLoading, setAnalysisSaveLoading] = useState(false);

  // Reset timeline state when the user moves to a different step.
  useEffect(() => {
    setActiveSnapId(null);
    setPanoramaOverride(null);
    setCompareIds([null, null]);
    setAnalysisLoading(false);
    setAnalysisDrawerOpen(false);
    setAnalysisReportId(null);
    setAnalysisSaved(false);
  }, [stepIdx, tourId]);

  const tourMedia = tour as typeof tour & {
    processedPanoramaUrl?: string | null;
    processed_panorama_url?: string | null;
    panoramaUrls?: string[];
    panorama_urls?: string[];
    steps?: import('@/data/mockData').TourStep[];
  };

  // Sequential walkthrough: one stop per pin in sequence order. Prev/next arrows
  // step through these. Falls back to a single-panorama tour for legacy tours.
  // Prefer live derivation from capturePins after refresh (API may omit steps).
  const derivedSteps = useMemo(() => {
    const tourFloorPlanId = (tourMedia as unknown as Record<string, unknown>)?.floorPlanId as string | undefined;
    if (!tourFloorPlanId) return [];
    const tourFloorId =
      floorPlans.find(fp => fp.id === tourFloorPlanId)?.floorId
      || ((tourMedia as unknown as Record<string, unknown>)?.floorId as string | undefined)
      || '';
    const pins = getCapturePinsForFloor(capturePins, tourFloorId, tourFloorPlanId)
      .map(p => ({ ...p, captureIds: pinCaptureIdsForUser(p.captureIds, ownCaptureIds) }))
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
        label: formatPinLocationLabel(pin, `Stop ${pin.sequenceNumber}`),
        panoramaUrl,
        thumbnailUrl: (mediaAssets[0]?.thumbnail_url ?? (cap?.thumbnailUrl as string | undefined)) ?? null,
      }];
    });
  }, [tourMedia, capturePins, captures, ownCaptureIds, floorPlans]);

  const steps = useMemo(() => {
    // Prefer stored tour.steps when the publisher selected a subset of pins.
    // Live derivation is only a fallback for legacy tours that never stored steps,
    // or when every stored stop vanished after deletes.
    const stored = tourMedia?.steps && tourMedia.steps.length > 0 ? tourMedia.steps : null;
    const raw = stored ?? derivedSteps;
    // Remap stored "Pin N" labels to live Flat · Room; refresh panorama URLs
    // from live captures so stitch completion shows without republishing.
    return raw.map(s => {
      const pin = capturePins.find(p => p.id === s.pinId);
      const cap = captures.find(c => c.id === s.captureId) as
        | (MockCapture & Record<string, unknown>)
        | undefined;
      const mediaAssets = (cap?.mediaAssets as CaptureMediaAsset[] | undefined) ?? [];
      const livePano = cap ? resolveCapturePanoramaUrl(mediaAssets, cap) : null;
      return {
        ...s,
        label: pin
          ? formatPinLocationLabel(pin, s.label || `Stop ${s.sequenceNumber}`)
          : (s.label || `Stop ${s.sequenceNumber}`),
        panoramaUrl: livePano || s.panoramaUrl,
        thumbnailUrl:
          (mediaAssets[0]?.thumbnail_url
            ?? (cap?.thumbnailUrl as string | undefined)
            ?? s.thumbnailUrl)
          || null,
      };
    });
  }, [tourMedia, derivedSteps, capturePins, captures]);
  // Chevrons navigate between PINS (walkthrough stops), not temporal visits on
  // the same pin — those use the capture timeline below the viewer.
  const isWalkthrough = steps.length > 1;
  const clampedStep = Math.min(stepIdx, Math.max(0, steps.length - 1));
  const currentStep = steps[clampedStep];
  const currentStepPin = currentStep
    ? (capturePins.find(p => p.id === currentStep.pinId)
      ?? (currentStep.captureId ? capturePins.find(p => p.captureIds.includes(currentStep.captureId)) : undefined))
    : undefined;
  const currentPinLabel = currentStep
    ? formatPinLocationLabel(currentStepPin, currentStep.label || tour?.roomName)
    : (tour?.roomName ?? '');

  // Real URLs only. This chain previously ended in DEMO_PANORAMAS/PANORAMA_MAP/
  // FALLBACK_PANORAMA, which meant a capture with no panorama yet (e.g. one
  // still stitching in the background) displayed an unrelated stock panorama as
  // though it were this site — the most misleading possible failure mode. A null
  // here renders an honest "not ready" state instead.
  const latestPanoramaUrl =
    currentStep?.panoramaUrl ||
    tourMedia?.panoramaUrls?.[clampedStep] ||
    tourMedia?.processedPanoramaUrl ||
    tourMedia?.processed_panorama_url ||
    tourMedia?.panoramaUrls?.[0] ||
    tourMedia?.panorama_urls?.[0] ||
    null;

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
    const tourFloorId =
      (tourFloorPlanId ? floorPlans.find(fp => fp.id === tourFloorPlanId)?.floorId : undefined)
      || ((tourMedia as unknown as Record<string, unknown>)?.floorId as string | undefined)
      || '';
    const pin =
      capturePins.find(p => p.id === currentStep.pinId) ??
      (currentStep.captureId
        ? capturePins.find(p => p.captureIds.includes(currentStep.captureId))
        : undefined) ??
      (tourFloorId
        ? getCapturePinsForFloor(capturePins, tourFloorId, tourFloorPlanId).find(p => p.sequenceNumber === currentStep.sequenceNumber)
        : undefined);
    const scopedPin = pin ? { ...pin, captureIds: pinCaptureIdsForUser(pin.captureIds, ownCaptureIds) } : undefined;

    const toSnapshot = (id: string): CaptureSnapshot => {
      const cap = captures.find(c => c.id === id) as (MockCapture & Record<string, unknown>) | undefined;
      const capIndex = scopedPin?.captureIds.indexOf(id) ?? 0;
      const uploadedAt = (cap?.uploadedAt as string | undefined) ?? '';
      const capturedAt = (cap?.capturedAt as string | undefined) ?? '';
      const dateLabel = formatCaptureDateTime(capturedAt, uploadedAt) || `Visit ${capIndex + 1}`;
      return {
        id,
        baseCaptureId: id,
        roomId: cap?.roomId ?? scopedPin?.roomId ?? '',
        date: capturedAt || uploadedAt,
        dateLabel,
        monthLabel: '',
        reviewStatus: (cap?.reviewStatus as CaptureSnapshot['reviewStatus'] | undefined) ?? 'uploaded',
        progress: 0,
        fileCount: cap?.fileCount ?? 0,
        capturedBy: (cap?.uploadedBy as string | undefined) ?? '',
        note: null,
        gradient: (cap?.gradient as string | undefined) ?? 'linear-gradient(135deg,#1e3a5f,#0f2340)',
        isLatest: false,
      } satisfies CaptureSnapshot;
    };

    // Preferred: full multi-visit history from the live pin — sorted oldest → newest.
    if (scopedPin && scopedPin.captureIds.length > 0) {
      const snapshots = scopedPin.captureIds.map(id => toSnapshot(id));
      snapshots.sort((a, b) => {
        const tA = parseCaptureTimestamp(a.date, a.dateLabel);
        const tB = parseCaptureTimestamp(b.date, b.dateLabel);
        if (Number.isNaN(tA) || Number.isNaN(tB)) return 0;
        return tA - tB;
      });
      return snapshots.map((s, i, arr) => ({
        ...s,
        isLatest: i === arr.length - 1,
        progress: i === arr.length - 1 ? 100 : Math.round(((i + 1) / arr.length) * 100),
      }));
    }

    // Fallback: surface at least this step's own capture so every published
    // walkthrough stop shows a timeline.
    if (currentStep.captureId) {
      const only = toSnapshot(currentStep.captureId);
      return [{ ...only, isLatest: true, progress: 100 }];
    }

    return [];
  }, [currentStep, capturePins, captures, tourMedia, ownCaptureIds, floorPlans]);

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

  const orderedComparePreview = useMemo(() => {
    const idA = compareIds[0] && timelineIds.has(compareIds[0]) ? compareIds[0] : null;
    const idB = compareIds[1] && timelineIds.has(compareIds[1]) ? compareIds[1] : null;
    if (!idA || !idB) return null;
    const snapA = pinTimeline.find(s => s.id === idA);
    const snapB = pinTimeline.find(s => s.id === idB);
    if (!snapA || !snapB) return null;
    const idxA = pinTimeline.findIndex(s => s.id === idA);
    const idxB = pinTimeline.findIndex(s => s.id === idB);
    const { before, after } = orderCapturesChronologically(snapA, snapB, idxA, idxB);
    const labelFor = (snap: CaptureSnapshot) => {
      const i = pinTimeline.findIndex(s => s.id === snap.id);
      return snap.isLatest ? 'Latest' : `Visit ${i + 1}`;
    };
    return {
      beforeCaptureId: before.id,
      afterCaptureId: after.id,
      beforeLabel: labelFor(before),
      afterLabel: labelFor(after),
      beforeDate: formatCapturePreviewDate(before.date || before.dateLabel),
      afterDate: formatCapturePreviewDate(after.date || after.dateLabel),
      beforeImageUrl: resolvePanorama(before.id),
      afterImageUrl: resolvePanorama(after.id),
    };
  }, [compareIds[0], compareIds[1], pinTimeline, timelineIds, resolvePanorama, captures]);

  const resolveGpanoOrientation = useCallback((captureId: string): GpanoOrientation => {
    const cap = captures.find(c => c.id === captureId) as (MockCapture & Record<string, unknown>) | undefined;
    if (!cap) return DEFAULT_GPANO_ORIENTATION;
    const mediaAssets = (cap.mediaAssets as Array<{ stitch?: unknown }> | undefined) ?? [];
    return gpanoFromStitch(mediaAssets[0]?.stitch);
  }, [captures]);

  const activeCaptureId = validActiveSnapId ?? currentStep?.captureId ?? tour?.captureId ?? '';
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

  const handleAnalyzeProgress = useCallback(async () => {
    const idA = validCompareIds[0];
    const idB = validCompareIds[1];
    if (!idA || !idB || !tour) return;

    const snapA = pinTimeline.find(s => s.id === idA);
    const snapB = pinTimeline.find(s => s.id === idB);
    if (!snapA || !snapB) return;

    const idxA = pinTimeline.findIndex(s => s.id === idA);
    const idxB = pinTimeline.findIndex(s => s.id === idB);
    let { before: beforeSnap, after: afterSnap } = orderCapturesChronologically(
      snapA,
      snapB,
      idxA,
      idxB,
    );

    const tBefore = parseCaptureTimestamp(beforeSnap.date, beforeSnap.dateLabel);
    const tAfter = parseCaptureTimestamp(afterSnap.date, afterSnap.dateLabel);
    if (!Number.isNaN(tBefore) && !Number.isNaN(tAfter) && tBefore > tAfter) {
      [beforeSnap, afterSnap] = [afterSnap, beforeSnap];
    }

    const beforeId = beforeSnap.id;
    const afterId = afterSnap.id;
    const beforeImage = resolvePanorama(beforeId);
    const afterImage = resolvePanorama(afterId);
    if (!beforeImage || !afterImage) {
      toast.error('Panorama images are not available for analysis');
      return;
    }
    if (beforeImage === afterImage) {
      toast.error('Before and After resolved to the same image — check capture uploads');
      return;
    }

    const pinLabel = currentPinLabel;

    const activePin = currentStep?.pinId
      ? capturePins.find(p => p.id === currentStep.pinId)
      : undefined;

    const tourFpId = (tourMedia as unknown as Record<string, unknown>)?.floorPlanId as string | undefined;
    const floorId = floors.find(f => f.towerId === tour.towerId && f.label === tour.floorLabel)?.id;
    const resolvedFpId = tourFpId
      ?? (floorId ? floorPlans.find(fp => fp.floorId === floorId && fp.towerId === tour.towerId)?.id : undefined);
    const fpRecord = resolvedFpId
      ? floorPlans.find(fp => fp.id === resolvedFpId)
      : (activePin ? floorPlans.find(fp => fp.id === activePin.floorPlanId) : undefined);
    const fpRec = fpRecord as (typeof fpRecord & Record<string, unknown>) | undefined;
    const fpMedia = (fpRec?.mediaAssets as { original_url?: string }[] | undefined) ?? [];
    const floorPlanUrl = (fpRec?.fileUrl as string | undefined)
      ?? (fpRec?.file_url as string | undefined)
      ?? fpMedia[0]?.original_url
      ?? undefined;
    const floorPlanId = fpRec?.id as string | undefined;

    const beforeDateValue = beforeSnap.date || beforeSnap.dateLabel;
    const afterDateValue = afterSnap.date || afterSnap.dateLabel;
    const beforeDateLabel = formatReportDate(beforeDateValue);
    const afterDateLabel = formatReportDate(afterDateValue);

    const meta: ProgressReportVisualMeta = {
      projectName: tour.projectName,
      tower: tour.towerName,
      floor: tour.floorLabel,
      pinName: pinLabel,
      beforeDate: beforeDateValue,
      afterDate: afterDateValue,
      beforeImageUrl: beforeImage,
      afterImageUrl: afterImage,
      floorPlanImageUrl: floorPlanUrl,
      pinX: activePin?.x ?? null,
      pinY: activePin?.y ?? null,
    };

    setAnalysisLoading(true);
    setAnalysisMeta(meta);

    try {
      const result = await progressAnalysisService.runUntilComplete({
        beforeImage,
        afterImage,
        beforeDate: beforeDateLabel,
        afterDate: afterDateLabel,
        beforeTimelineId: beforeId,
        afterTimelineId: afterId,
        projectName: tour.projectName,
        projectId: tour.projectId,
        tower: tour.towerName,
        floor: tour.floorLabel,
        pinName: pinLabel,
        captureType: '360',
        floorPlanImage: floorPlanUrl,
        floorPlanId,
        pinX: activePin?.x,
        pinY: activePin?.y,
      });
      setAnalysisReport(result.report);
      setAnalysisReportId(result.reportId);
      setAnalysisSaved(result.saved);
      setAnalysisMeta(prev => ({
        ...(prev ?? meta),
        generatedAt: result.saved ? (prev?.generatedAt ?? new Date().toISOString()) : new Date().toISOString(),
      }));
      setAnalysisDrawerOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      toast.error(message);
    } finally {
      setAnalysisLoading(false);
    }
  }, [validCompareIds, tour, pinTimeline, resolvePanorama, currentStep, capturePins, floorPlans, floors, tourMedia]);

  const handleOpenPreviousReport = useCallback(async (summary: ProgressReportSummary) => {
    try {
      const detail = await progressAnalysisService.getReport(summary.reportId);
      setAnalysisReport(detail.analysis);
      setAnalysisMeta({
        projectName: detail.projectName,
        tower: detail.tower,
        floor: detail.floor,
        pinName: detail.pinName,
        beforeDate: detail.beforeDate,
        afterDate: detail.afterDate,
        beforeImageUrl: detail.beforeImageUrl,
        afterImageUrl: detail.afterImageUrl,
        floorPlanImageUrl: detail.floorPlanImageUrl,
        pinX: detail.pinX,
        pinY: detail.pinY,
        generatedAt: detail.savedAt ?? detail.createdAt,
      });
      setAnalysisReportId(summary.reportId);
      setAnalysisSaved(true);
      setAnalysisDrawerOpen(true);
    } catch {
      toast.error('Failed to open report');
    }
  }, []);

  const handleSaveAnalysisReport = useCallback(async () => {
    if (!analysisReportId || analysisSaved) return;
    if (!isManagerOrAdmin(user)) {
      toast.error('Only managers and admins can save reports to the library');
      return;
    }
    setAnalysisSaveLoading(true);
    try {
      const summary = await progressAnalysisService.saveReport(analysisReportId);
      setAnalysisSaved(true);
      setAnalysisMeta(prev => (prev ? {
        ...prev,
        generatedAt: summary.savedAt ?? summary.createdAt,
      } : prev));
      setAnalysisDrawerOpen(false);
      toast.success('Saved to Progress Reports');
      navigate('/progress-reports');
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      toast.error(
        status === 403
          ? 'Only managers and admins can save reports to the library'
          : 'Failed to save report',
      );
    } finally {
      setAnalysisSaveLoading(false);
    }
  }, [analysisReportId, analysisSaved, navigate, user]);

  const handleHotspotClick = useCallback((targetTourId: string) => {
    navigate(`/tours/${targetTourId}`);
  }, [navigate]);

  const tourFloorPlanId = (tourMedia as unknown as Record<string, unknown>)?.floorPlanId as string | undefined;
  const resolvedFloorId = floors.find(f => f.towerId === tour?.towerId && f.label === tour?.floorLabel)?.id;

  const floorPlan = useMemo(() => {
    if (!tour) return undefined;
    if (tourFloorPlanId) return floorPlans.find(fp => fp.id === tourFloorPlanId);
    if (resolvedFloorId) return getFloorPlanByFloor(floorPlans, tour.towerId, resolvedFloorId);
    return undefined;
  }, [tour, tourFloorPlanId, floorPlans, resolvedFloorId]);

  const floorPlanImageUrl = useMemo(() => {
    if (!floorPlan) return null;
    const rec = floorPlan as typeof floorPlan & Record<string, unknown>;
    const mediaAssets = (rec.mediaAssets as { original_url?: string }[] | undefined) ?? [];
    return (rec.fileUrl as string | undefined)
      ?? (rec.file_url as string | undefined)
      ?? mediaAssets[0]?.original_url
      ?? null;
  }, [floorPlan]);

  // Navigation map: prefer walkthrough stop pins (captured only) so clicks jump to 360s.
  const tourPins = useMemo(() => {
    if (steps.length > 0) {
      const byId = new Map(capturePins.map(p => [p.id, p]));
      const fromSteps = steps
        .map(s => byId.get(s.pinId))
        .filter((p): p is NonNullable<typeof p> => Boolean(p) && p.captureIds.length > 0);
      if (fromSteps.length > 0) return fromSteps;
    }
    if (!floorPlan) return [];
    const byPlan = getCapturePinsByFloorPlan(capturePins, floorPlan.id)
      .filter(p => p.captureIds.length > 0);
    if (byPlan.length > 0) return byPlan;
    if (resolvedFloorId) {
      return [...capturePins.filter(p => p.floorId === resolvedFloorId && p.captureIds.length > 0)]
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    }
    return [];
  }, [steps, floorPlan, capturePins, resolvedFloorId]);

  const handleFloorPlanPinClick = useCallback((pinId: string) => {
    const stepIndex = steps.findIndex(s => s.pinId === pinId);
    if (stepIndex >= 0) {
      setStepIdx(stepIndex);
      setActiveSnapId(null);
      setPanoramaOverride(null);
      setCompareIds([null, null]);
      return;
    }
    const pin = tourPins.find(p => p.id === pinId);
    const latestCaptureId = pin?.captureIds[pin.captureIds.length - 1];
    if (latestCaptureId) {
      setActiveSnapId(latestCaptureId);
      setPanoramaOverride(resolvePanorama(latestCaptureId));
      setCompareIds([null, null]);
    }
  }, [steps, tourPins, resolvePanorama]);

  const handlePublish = useCallback(() => {
    if (tour) {
      publishTour(tour.id);
    }
  }, [publishTour, tour]);

  const handleApproveReview = useCallback(() => {
    if (!tour || isMarkedDone || tour.managerReviewed) return;
    updateTour(tour.id, { status: 'published', managerReviewed: true });
    setIsMarkedDone(true);
    toast.success('Tour approved and marked as reviewed');
  }, [tour, isMarkedDone, updateTour]);

  if (!tour) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2 }}>
      <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: colors.borderLight }}>404</Typography>
      <Typography sx={{ color: colors.textMuted }}>Tour not found</Typography>
      <Box component={Link} to={listBackTo} sx={{ color: colors.primary, textDecoration: 'none', fontSize: '0.875rem' }}>← {listBackLabel}</Box>
    </Box>
  );

  const ts = (statusConfig.tour as Record<string, { label: string; color: string; bg: string }>)[tour.status] ?? statusConfig.tour.draft;
  const capture = captures.find(c => c.id === tour.captureId) ?? mockCaptures.find(c => c.id === tour.captureId);
  const floorId = resolvedFloorId;
  const floorPlanLink = floorId
    ? `/floor-plans/${tour.projectId}/${tour.towerId}/${floorId}?pinsOnly=1&returnTo=/tours/${tour.id}`
    : null;
  const canReviewTour = isManager(user);

  const breadcrumb: { label: string; to?: string }[] = [
    { label: listBackLabel, to: listBackTo },
    { label: tour.projectName },
    { label: tour.towerName },
    { label: tour.floorLabel },
    { label: tour.roomName },
  ];

  const viewer = (
    <Box sx={{
      borderRadius: fullscreen ? 0 : { xs: '16px', md: '20px' },
      width: '100%',
      height: fullscreen ? '100vh' : {
        xs: 'clamp(320px, 62vw, 420px)',
        sm: 'clamp(380px, 54vw, 500px)',
        md: 'clamp(440px, 48vw, 600px)',
        lg: 'clamp(480px, 44vw, 680px)',
      },
      minHeight: fullscreen ? '100vh' : { xs: 320, md: 440 },
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#0f1929',
      '& .psv-container': { borderRadius: fullscreen ? 0 : { xs: '16px', md: '20px' } },
    }}>
      {panoramaUrl ? (
        <PanoramaViewer
          panoramaUrl={panoramaUrl}
          tourId={tourId ?? ''}
          autoRotate={autoRotate}
          onAutoRotateChange={setAutoRotate}
          hotspots={hotspots}
          onHotspotClick={handleHotspotClick}
          panoOrientation={panoOrientation}
        />
      ) : (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.25, px: 3, textAlign: 'center' }}>
          <ViewInArRounded sx={{ fontSize: 40, color: 'rgba(255,255,255,0.35)' }} />
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
            Panorama not ready yet
          </Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.55)', maxWidth: 320 }}>
            This capture is still being stitched. It will appear here automatically once processing finishes.
          </Typography>
        </Box>
      )}

      {analysisLoading && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            backgroundColor: 'rgba(15,25,41,0.72)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <CircularProgress size={36} sx={{ color: '#a78bfa' }} />
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: '#fff' }}>
            Analyzing construction progress...
          </Typography>
        </Box>
      )}

      {/* Top-right controls */}
      <Box sx={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 0.75, zIndex: 10 }}>
        {floorPlanImageUrl && tourPins.length > 0 && (
          <Tooltip title={showFloorPlan ? 'Hide floor plan' : 'Open floor plan'}>
            <IconButton
              onClick={() => setShowFloorPlan(v => !v)}
              size="small"
              sx={{
                backgroundColor: showFloorPlan ? 'rgba(37,99,235,0.85)' : 'rgba(0,0,0,0.45)',
                color: '#fff',
                backdropFilter: 'blur(8px)',
                '&:hover': { backgroundColor: showFloorPlan ? 'rgba(37,99,235,0.95)' : 'rgba(0,0,0,0.6)' },
              }}
            >
              <MapRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={autoRotate ? 'Stop auto rotate' : 'Auto rotate — tap to spin the tour'}>
          <IconButton
            onClick={() => setAutoRotate(v => !v)}
            size="small"
            aria-pressed={autoRotate}
            aria-label={autoRotate ? 'Stop auto rotate' : 'Start auto rotate'}
            sx={{
              // Idle: still “highlighted” so the control is obvious on first entry
              // (soft blue ring + pulse). Active: solid blue = currently rotating.
              backgroundColor: autoRotate ? 'rgba(37,99,235,0.95)' : 'rgba(37,99,235,0.55)',
              color: '#fff',
              backdropFilter: 'blur(8px)',
              boxShadow: autoRotate
                ? '0 0 0 2px rgba(147,197,253,0.9)'
                : '0 0 0 2px rgba(147,197,253,0.75)',
              animation: autoRotate ? 'none' : 'tourAutoRotateHint 1.8s ease-in-out 2',
              '@keyframes tourAutoRotateHint': {
                '0%, 100%': { boxShadow: '0 0 0 2px rgba(147,197,253,0.55)' },
                '50%': { boxShadow: '0 0 0 4px rgba(147,197,253,0.95)' },
              },
              '&:hover': { backgroundColor: autoRotate ? 'rgba(37,99,235,1)' : 'rgba(37,99,235,0.75)' },
            }}
          >
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

      {/* Walkthrough step indicator (Flat · Room) */}
      {isWalkthrough && currentStep && (
        <Box sx={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10, px: 2, py: 0.875, borderRadius: '999px', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', gap: 1, maxWidth: '90%' }}>
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: '#fff' }} noWrap>{currentPinLabel}</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', flexShrink: 0 }}>{clampedStep + 1} of {steps.length}</Typography>
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

      {/* Prev/Next between pins only — never for a single-pin tour (even when that
          pin has multiple visits over time; the timeline handles those). Also do
          not fall back to hopping between unrelated tours in the catalog. */}
      {isWalkthrough && (
        <Box sx={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 0.75, zIndex: 12 }}>
          <Box onClick={() => setStepIdx(i => Math.max(0, i - 1))} sx={{ visibility: clampedStep > 0 ? 'visible' : 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: '#fff', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' } }}>
            <NavigateBefore sx={{ fontSize: 22 }} />
          </Box>
          <Box onClick={() => setStepIdx(i => Math.min(steps.length - 1, i + 1))} sx={{ visibility: clampedStep < steps.length - 1 ? 'visible' : 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', color: '#fff', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' } }}>
            <NavigateNextRounded sx={{ fontSize: 22 }} />
          </Box>
        </Box>
      )}

      {showFloorPlan && floorPlanImageUrl && tourPins.length > 0 && (
        <TourFloorPlanPanel
          imageUrl={floorPlanImageUrl}
          floorLabel={tour.floorLabel}
          pins={tourPins}
          activePinId={currentStep?.pinId}
          onPinClick={handleFloorPlanPinClick}
          onClose={() => setShowFloorPlan(false)}
        />
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
        <Box component={Link} to={listBackTo} sx={{ cursor: 'pointer', border: 'none', color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', width: 30, height: 30, borderRadius: '8px', justifyContent: 'center', backgroundColor: colors.card, boxShadow: '0 1px 3px rgba(15,23,42,0.06)', '&:hover': { color: colors.textStrong }, flexShrink: 0 }}>
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

        <TourViewerHeaderActions
          floorPlanTo={floorPlanLink}
          statusChip={ts}
          tour={tour}
          canReview={canReviewTour}
          isMarkedDone={isMarkedDone}
          onApproveReview={handleApproveReview}
        />
      </Box>

      {tour.status === 'in_review' && canReviewTour && !isMarkedDone && !tour.managerReviewed && (
        <Box
          sx={{
            display: 'flex',
            alignItems: { xs: 'flex-start', sm: 'center' },
            gap: 1,
            mb: { xs: 1.5, md: 2 },
            px: 1.5,
            py: 1,
            borderRadius: '10px',
            backgroundColor: 'rgba(124,58,237,0.06)',
            border: '1px solid rgba(124,58,237,0.18)',
          }}
        >
          <CheckCircleRounded sx={{ fontSize: 16, color: '#7c3aed', flexShrink: 0, mt: { xs: 0.125, sm: 0 } }} />
          <Typography sx={{ fontSize: '0.75rem', color: colors.textSecondary, lineHeight: 1.45 }}>
            <Box component="span" sx={{ fontWeight: 700, color: '#7c3aed' }}>Manager review</Box>
            {' — '}walk through the captures below. When everything looks correct, use{' '}
            <Box component="span" sx={{ fontWeight: 700, color: colors.textStrong }}>Approve tour</Box>
            {' '}in the header to finish.
          </Typography>
        </Box>
      )}

      {/* ── Full-width viewer + capture timeline below ───────────────────── */}
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        {viewer}

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
                <Box
                  sx={{
                    mt: 2,
                    borderRadius: '16px',
                    backgroundColor: colors.card,
                    boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
                    overflow: 'hidden',
                    width: '100%',
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                      px: 2,
                      py: 1.25,
                      borderBottom: `1px solid ${colors.borderLight}`,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      <Box
                        sx={{
                          width: 30, height: 30, borderRadius: '9px', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          backgroundColor: colors.primarySoft,
                        }}
                      >
                        <HistoryRounded sx={{ fontSize: 16, color: colors.primary }} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong, lineHeight: 1.25 }}>
                          Capture timeline
                        </Typography>
                        <Typography noWrap sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textMuted, lineHeight: 1.3, mt: '1px' }}>
                          {currentPinLabel} · {pinTimeline.length} visit{pinTimeline.length !== 1 ? 's' : ''}
                        </Typography>
                      </Box>
                    </Box>
                    {pinTimeline.length > 1 && (
                      <Box
                        onClick={() => setCompareIds(isComparing ? [null, null] : [latestSnap.id, null])}
                        sx={{
                          display: 'inline-flex', alignItems: 'center', gap: 0.5,
                          px: 1.25, py: 0.375, borderRadius: '8px', cursor: 'pointer',
                          fontSize: '0.6875rem', fontWeight: 600, flexShrink: 0,
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

                    {isComparing && (
                      <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                        {!bothSelected && (
                          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, fontWeight: 500 }}>
                            {!compareIds[0]
                              ? 'Select two visits on the timeline'
                              : 'Select a second visit'}
                          </Typography>
                        )}

                        {!bothSelected && (
                          <CompareSlotRow
                            compareIds={compareIds}
                            pinTimeline={pinTimeline}
                            onView={(id) => { setActiveSnapId(id); setPanoramaOverride(resolvePanorama(id)); }}
                          />
                        )}

                        {bothSelected && orderedComparePreview && (
                          <CompareWillAnalyzePreview
                            key={`${orderedComparePreview.beforeCaptureId}-${orderedComparePreview.afterCaptureId}`}
                            before={{
                              label: orderedComparePreview.beforeLabel,
                              date: orderedComparePreview.beforeDate,
                              imageUrl: orderedComparePreview.beforeImageUrl,
                              captureId: orderedComparePreview.beforeCaptureId,
                            }}
                            after={{
                              label: orderedComparePreview.afterLabel,
                              date: orderedComparePreview.afterDate,
                              imageUrl: orderedComparePreview.afterImageUrl,
                              captureId: orderedComparePreview.afterCaptureId,
                            }}
                          />
                        )}

                        {bothSelected && (
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                            <CompareAnalyzeButton
                              loading={analysisLoading}
                              onClick={handleAnalyzeProgress}
                            />
                            <Box
                              onClick={() => setCompareIds([null, null])}
                              sx={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
                                py: 0.5, color: colors.textMuted, fontSize: '0.6875rem', fontWeight: 600,
                                cursor: 'pointer', '&:hover': { color: colors.danger },
                              }}
                            >
                              <CloseRounded sx={{ fontSize: 13 }} /> Clear selection
                            </Box>
                          </Box>
                        )}

                        {canViewPreviousReports && (
                          <PreviousReportsPanel
                            projectId={tour.projectId}
                            pinName={currentPinLabel}
                            validTimelineIds={pinTimeline.map(s => s.id)}
                            onSelect={handleOpenPreviousReport}
                          />
                        )}
                      </Box>
                    )}

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
                  </Box>
                </Box>
              );
            })()}
      </Box>

      <ProgressAnalysisDrawer
        open={analysisDrawerOpen}
        onClose={() => setAnalysisDrawerOpen(false)}
        report={analysisReport}
        meta={analysisMeta ?? undefined}
        reportId={analysisReportId}
        saved={analysisSaved}
        onSave={canViewPreviousReports ? handleSaveAnalysisReport : undefined}
        saveLoading={analysisSaveLoading}
      />
    </Box>
  );
}
