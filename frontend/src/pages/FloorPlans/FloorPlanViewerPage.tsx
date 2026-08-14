import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip, useMediaQuery, useTheme, Drawer, Snackbar, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Button, MenuItem, Select, FormControl, InputLabel, TextField } from '@mui/material';
import {
  ArrowBackRounded, ZoomInRounded, ZoomOutRounded, FullscreenRounded,
  FullscreenExitRounded, CenterFocusStrongRounded, UploadFileRounded,
  LayersRounded, RoomRounded, CameraAltRounded, ViewInArRounded, ArrowForwardRounded,
  CloudOffRounded, KeyboardArrowDownRounded, AddLocationAltRounded, CheckRounded,
  PublishRounded, VisibilityRounded, VisibilityOffRounded, ContentCopyRounded, EditLocationAltRounded,
  DeleteOutlineRounded, MapRounded,
} from '@mui/icons-material';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isFieldEngineer, isManagerOrAdmin } from '@store/authStore';
import { getFloorPlanByFloor, getFloorsByTower, getCapturePinsByFloorPlan } from '@store/workflowSelectors';
import type { MockRoomMarker } from '@/data/mockData';
import type { WfCapturePin } from '@store/workflowStore';
import { useDeviceType, usesCameraCapture } from '@/hooks/useDeviceType';
import { enqueueFileUpload } from '@store/fileUploadQueue';
import CapturePinMarker from '@features/capturePins/CapturePinMarker';
import PinActionPanel from '@features/capturePins/PinActionPanel';
import CameraCaptureDialog from '@features/capturePins/CameraCaptureDialog';
import PinUploadDialog from '@features/capturePins/PinUploadDialog';
import { PREDEF_FLAT_OPTIONS, PREDEF_ROOM_OTHER, roomOptionsForFlat, isCustomRoomName } from '@features/capturePins/predefRoomOptions';
import CaptureTimeline from '@shared/components/CaptureTimeline/CaptureTimeline';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import type { CaptureSnapshot } from '@/data/mockData';
import { formatCaptureDateTime, uploadSequenceByPinId } from '@/utils/pinLabels';
import { normaliseError } from '@/services/apiClient';

/* ── PDF.js (lazy-loaded so bundle stays small until a PDF is needed) ──── */
type PdfViewport = { width: number; height: number };
type PdfPage = {
  getViewport: (opts: { scale: number }) => PdfViewport;
  render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void> };
};
type PdfDoc = {
  getPage: (n: number) => Promise<PdfPage>;
  numPages: number;
};
type PdfJsLib = {
  getDocument: (src: { url: string }) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
  version: string;
};

let _pdfjs: PdfJsLib | null = null;

async function getPdfJs(): Promise<PdfJsLib> {
  if (!_pdfjs) {
    const mod = await import('pdfjs-dist');
    _pdfjs = mod as unknown as PdfJsLib;
    _pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${_pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  return _pdfjs;
}

/* ── palette ────────────────────────────────────────────────────────────── */
const P = {
  border:   '#e4e7ec',
  muted:    '#6b7280',
  subtle:   '#9ca3af',
  strong:   '#111827',
  blue:     '#2563eb',
  blueSoft: 'rgba(37,99,235,0.08)',
  white:    '#ffffff',
  bg:       '#f7f8fa',
  card:     '#ffffff',
};
const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

const STATUS_COLOR: Record<string, { fill: string; stroke: string; label: string }> = {
  not_started: { fill: 'rgba(100,116,139,0.15)', stroke: '#64748b', label: 'Not Started' },
  in_progress: { fill: 'rgba(217,119,6,0.15)',   stroke: '#d97706', label: 'In Progress' },
  reviewed:    { fill: 'rgba(37,99,235,0.15)',    stroke: '#2563eb', label: 'Reviewed'    },
  published:   { fill: 'rgba(22,163,74,0.15)',    stroke: '#16a34a', label: 'Published'   },
};

/* ── CtrlBtn ─────────────────────────────────────────────────────────────── */
function CtrlBtn({ title, onClick, children, small }: { title: string; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  const size = small ? 28 : 34;
  return (
    <Tooltip title={title} placement="right">
      <IconButton
        onClick={() => onClick()}
        onPointerDown={e => e.stopPropagation()}
        size="small"
        sx={{
          width: size, height: size, borderRadius: '9px',
          backgroundColor: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 1px 6px rgba(15,23,42,0.12)',
          color: P.strong,
          transition: T,
          '&:hover': { backgroundColor: P.white, boxShadow: '0 3px 12px rgba(15,23,42,0.16)', color: P.blue },
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

/* ── Room panel ─────────────────────────────────────────────────────────── */
function RoomActionPanel({ room, onClose, isMobile }: { room: MockRoomMarker; onClose: () => void; isMobile?: boolean }) {
  const sc = STATUS_COLOR[room.status] ?? STATUS_COLOR.not_started;
  return (
    <Box sx={
      isMobile
        ? {
            position: 'absolute', bottom: 0, left: 0, right: 0, width: 'auto',
            borderRadius: '16px 16px 0 0',
            backgroundColor: P.white,
            boxShadow: '0 -4px 24px rgba(15,23,42,0.18)',
            zIndex: 20, overflow: 'hidden',
            border: `1px solid ${P.border}`,
          }
        : {
            position: 'absolute', top: 16, right: 16, width: 260,
            borderRadius: '16px',
            backgroundColor: P.white,
            boxShadow: '0 12px 40px rgba(15,23,42,0.16)',
            zIndex: 20, overflow: 'hidden',
            border: `1px solid ${P.border}`,
          }
    }>
      <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }}>Room {room.number}</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>{room.name}</Typography>
        </Box>
        <Box onClick={onClose} sx={{ cursor: 'pointer', color: P.subtle, fontSize: 18, lineHeight: 1, '&:hover': { color: P.strong } }}>✕</Box>
      </Box>
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 0.75, mb: 1.5, flexWrap: 'wrap' }}>
          <Chip label={sc.label} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, color: sc.stroke, backgroundColor: sc.fill, borderRadius: '6px' }} />
          <Chip label={room.type} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 500, color: P.muted, backgroundColor: P.bg, borderRadius: '6px', textTransform: 'capitalize' }} />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {room.captureId && (
            <Box component={Link} to={`/captures/${room.captureId}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '8px', backgroundColor: P.blueSoft, color: P.blue, fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(37,99,235,0.14)' } }}>
              <CameraAltRounded sx={{ fontSize: 15 }} /> View Capture
              <ArrowForwardRounded sx={{ fontSize: 14, ml: 'auto' }} />
            </Box>
          )}
          {room.tourId && (
            <Box component={Link} to={`/tours/${room.tourId}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '8px', backgroundColor: 'rgba(124,58,237,0.08)', color: '#7c3aed', fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(124,58,237,0.14)' } }}>
              <ViewInArRounded sx={{ fontSize: 15 }} /> Open Tour
              <ArrowForwardRounded sx={{ fontSize: 14, ml: 'auto' }} />
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════════════════════ */
export default function FloorPlanViewerPage() {
  const { projectId, towerId, floorId } = useParams<{ projectId: string; towerId: string; floorId: string }>();
  const [searchParams] = useSearchParams();
  // pinsOnly: a focused view (from Capture History) showing just the plan + pins —
  // no floor switcher, room overlays/legend, capture-mode toggle, or upload button.
  const pinsOnly = searchParams.get('pinsOnly') === '1';
  const returnTo = searchParams.get('returnTo');
  const forceAnnotate = searchParams.get('annotate') === '1';
  const openCopy = searchParams.get('copy') === '1';
  const navigate = useNavigate();

  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const device   = useDeviceType();
  const useCamera = usesCameraCapture(device);

  const user       = useAuthStore(s => s.user);
  const isEngineer = isFieldEngineer(user);
  const canAnnotate = isManagerOrAdmin(user);
  const backDest   = returnTo ?? (pinsOnly ? (isEngineer ? '/my-captures' : '/captures') : `/floor-plans?project=${projectId}&tower=${towerId}`);

  const project    = useWorkflowStore(s => s.projects.find(p => p.id === projectId));
  const tower      = useWorkflowStore(s => s.towers.find(t => t.id === towerId));
  const floors     = useWorkflowStore(s => s.floors);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const allPins    = useWorkflowStore(s => s.capturePins);
  const captures   = useWorkflowStore(s => s.captures);
  const createCapturePin     = useWorkflowStore(s => s.createCapturePin);
  const deleteCapturePin     = useWorkflowStore(s => s.deleteCapturePin);
  const publishFloorPlanTour = useWorkflowStore(s => s.publishFloorPlanTour);
  const copyPinsFromFloor    = useWorkflowStore(s => s.copyPinsFromFloor);
  const setFloorPlanPinsVisible = useWorkflowStore(s => s.setFloorPlanPinsVisible);
  const deleteFloorPlan      = useWorkflowStore(s => s.deleteFloorPlan);
  const updateCapturePinLocal = useWorkflowStore(s => s.updateCapturePinLocal);

  const towerFloors = [...getFloorsByTower(floors, towerId ?? '')].sort((a, b) => a.number - b.number);
  const floor       = towerFloors.find(f => f.id === floorId);

  // A floor can have more than one floor-plan record: re-uploading a plan creates a
  // new record (the old one is only dropped from local state, not the backend), so the
  // snapshot returns duplicates. The plainly-newest record is often NOT the one the
  // capture pins / published tour were attached to — which made "View on floor plan"
  // render the wrong (empty) plan. Prefer the record that actually owns the pins so
  // every captured pin shows up.
  const floorPlansForFloor = floorPlans.filter(fp => fp.towerId === (towerId ?? '') && fp.floorId === (floorId ?? ''));
  const floorPlan =
    floorPlansForFloor.find(fp => allPins.some(p => p.floorPlanId === fp.id && p.captureIds.length > 0)) ??
    floorPlansForFloor.find(fp => allPins.some(p => p.floorPlanId === fp.id)) ??
    floorPlansForFloor[0] ??
    getFloorPlanByFloor(floorPlans, towerId ?? '', floorId ?? '');

  // Pins for the chosen plan, falling back to every pin on this floor (covers pins
  // attached to a sibling/older floor-plan record for the same floor).
  const pinsAll = (() => {
    if (!floorPlan) return [];
    const byPlan = getCapturePinsByFloorPlan(allPins, floorPlan.id);
    if (byPlan.length > 0) return byPlan;
    return [...allPins.filter(p => p.floorId === (floorId ?? ''))].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  })();
  const pinsVisible = floorPlan?.pinsVisible !== false;

  // Free-place capture pins on Floor Plans are for managers/admins only.
  // Field engineers capture via Capture Workflow, not this viewer.
  const canUsePins = canAnnotate && !!floorPlan;

  // Derive image / PDF URLs before any early returns
  const planRecord  = floorPlan as (typeof floorPlan & Record<string, unknown>) | null;
  const mediaAssets = (planRecord?.mediaAssets as { original_url?: string }[] | undefined) ?? [];
  const imageUrl: string | null =
    (planRecord?.fileUrl as string | undefined)
    ?? (planRecord?.file_url as string | undefined)
    ?? mediaAssets[0]?.original_url
    ?? null;
  const rawPdfUrl: string | null =
    (planRecord?.rawPdfUrl as string | undefined)
    ?? (planRecord?.raw_pdf_url as string | undefined)
    ?? null;
  const fileFormat = ((planRecord?.format ?? planRecord?.fileType ?? '') as string).toLowerCase();
  // Cloudinary-hosted PDFs are pre-converted to PNG server-side (original_url already
  // points to the PNG render). Only use PDF.js for local/non-Cloudinary PDF sources.
  const isCloudinaryUrl = imageUrl?.includes('res.cloudinary.com') ?? false;
  const isPdf = !isCloudinaryUrl && (fileFormat === 'pdf' || (imageUrl?.toLowerCase().includes('.pdf') ?? false));

  /* ── state ──────────────────────────────────────────────────────────── */
  const [scale, setScale]               = useState(1);
  const [offset, setOffset]             = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen]     = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<MockRoomMarker | null>(null);
  const [isDragging, setIsDragging]     = useState(false);
  const [fadeIn, setFadeIn]             = useState(false);
  const [floorSheetOpen, setFloorSheetOpen] = useState(false);

  // ── Pin capture workflow state ──────────────────────────────────────────────
  const [captureMode, setCaptureMode]     = useState(false);
  const [annotateMode, setAnnotateMode]   = useState(false);
  const [pendingAnnotate, setPendingAnnotate] = useState<{ x: number; y: number } | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [annotateFlat, setAnnotateFlat]   = useState<string>(PREDEF_FLAT_OPTIONS[0]);
  const [annotateRoom, setAnnotateRoom]   = useState<string>('Living / Dining');
  const [annotateCustomRoom, setAnnotateCustomRoom] = useState('');
  const [copyOpen, setCopyOpen]           = useState(false);
  const [copySourceFloorId, setCopySourceFloorId] = useState('');
  const [copyImporting, setCopyImporting] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [activePin, setActivePin]         = useState<WfCapturePin | null>(null); // pin being captured
  const [showTimeline, setShowTimeline]   = useState(false);
  const [timelineActiveId, setTimelineActiveId] = useState<string>('');
  const [publishToast, setPublishToast]   = useState('');
  const [errorToast, setErrorToast]       = useState('');
  const [deletePlanOpen, setDeletePlanOpen] = useState(false);

  // Annotate: show labeled points when visible. pinsOnly (gallery/history): only
  // uploaded green pins. Otherwise: hide empties when toggled off.
  // Do NOT let annotateMode override pinsVisible — that made Hide look broken
  // for managers (annotate mode is on by default).
  const pins = pinsOnly
    ? pinsAll.filter(p => (p.captureIds?.length ?? 0) > 0)
    : pinsVisible
      ? pinsAll
      : pinsAll.filter(p => (p.captureIds?.length ?? 0) > 0);

  // Engineer capture order 1..N (by capture time) — never admin annotation stop #.
  const uploadSeqById = pinsOnly
    ? uploadSequenceByPinId(pins, captures)
    : null;

  const selectedPin = pinsAll.find(p => p.id === selectedPinId) ?? pins.find(p => p.id === selectedPinId) ?? null;
  const pinsWithCaptures = pinsAll.filter(p => p.captureIds.length > 0).length;
  const siblingFloorsWithPins = towerFloors.filter(f =>
    f.id !== floorId
    && allPins.some(p => p.floorId === f.id && p.flatName && p.roomName),
  );

  // Managers/admins annotate (Flat + Room). Engineers view plans only —
  // pin placement happens in Capture Workflow.
  // pinsOnly (from Capture Gallery / History) is a review view — show capture
  // status colors, do not enter annotate mode.
  useEffect(() => {
    if (!floorPlan) return;
    if (pinsOnly) {
      setAnnotateMode(false);
      setCaptureMode(false);
      return;
    }
    if (canAnnotate && !isEngineer) {
      setAnnotateMode(true);
      setCaptureMode(false);
    } else if (isEngineer) {
      setCaptureMode(false);
      setAnnotateMode(false);
    }
  }, [isEngineer, canAnnotate, floorPlan?.id, pinsOnly]);

  // Reset timeline view when the selected pin changes
  useEffect(() => { setShowTimeline(false); }, [selectedPinId]);

  // Deep-link from upload: require annotate / offer copy on new floor (once)
  useEffect(() => {
    if (!canAnnotate || !floorPlan || pinsOnly) return;
    if (forceAnnotate || floorPlan.needsReannotate) {
      setAnnotateMode(true);
      setCaptureMode(false);
    }
    if (openCopy && siblingFloorsWithPins.length > 0) {
      setCopySourceFloorId(siblingFloorsWithPins[0]?.id ?? '');
      setCopyOpen(true);
    }
    // Intentionally only when floor/plan or deep-link params change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAnnotate, floorPlan?.id, floorPlan?.needsReannotate, forceAnnotate, openCopy, pinsOnly]);

  // SVG viewer state
  const [pageSize, setPageSize]                 = useState({ w: 0, h: 0 });
  const [renderedImageUrl, setRenderedImageUrl] = useState<string | null>(null);
  const [containerSize, setContainerSize]       = useState({ w: 1, h: 1 });

  /* trigger fade-in animation every time the floor changes */
  useEffect(() => {
    setFadeIn(false);
    let t1: number, t2: number;
    t1 = requestAnimationFrame(() => {
      t2 = requestAnimationFrame(() => setFadeIn(true));
    });
    return () => { cancelAnimationFrame(t1); cancelAnimationFrame(t2); };
  }, [floorId]);

  /* mutable refs for event handlers */
  const scaleRef        = useRef(1);
  const offsetRef       = useRef({ x: 0, y: 0 });
  const dragStartRef    = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const draggingRef     = useRef(false);
  const movedRef        = useRef(false); // true once a drag actually pans, so a pan-release doesn't drop a pin
  const placePinAtClientRef = useRef<(clientX: number, clientY: number, target?: EventTarget | null) => boolean>(() => false);
  const selectPinByIdRef = useRef<(id: string) => void>(() => undefined);
  useEffect(() => {
    selectPinByIdRef.current = (id: string) => setSelectedPinId(id);
  }, []);
  const viewerRef       = useRef<HTMLDivElement>(null);
  // Pinch-zoom refs
  const pinchActiveRef  = useRef(false);
  const pinchStartDistRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const pinchMidpointRef = useRef({ x: 0, y: 0 }); // midpoint in viewer-local coords
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Inertia refs
  const velocityRef     = useRef({ x: 0, y: 0 });
  const lastMoveTimeRef = useRef(0);
  const inertiaRafRef   = useRef(0);
  const pdfDocRef       = useRef<PdfDoc | null>(null);
  const renderingRef    = useRef(false);
  const lastRenderScale = useRef(0);
  const attachingRef    = useRef(false);

  useEffect(() => { scaleRef.current  = scale;  }, [scale]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  /* ── container size tracking ────────────────────────────────────────── */
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(e => {
      const r = e[0]?.contentRect;
      if (r) setContainerSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen]);

  /* ── clampOffset: keep floor plan visible, not fully dragged off-screen */
  const clampOffset = useCallback((ox: number, oy: number, s: number): { x: number; y: number } => {
    const el = viewerRef.current;
    if (!el || !pageSize.w || !pageSize.h) return { x: ox, y: oy };
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    // The floor plan occupies [ox, ox + pageSize.w*s] × [oy, oy + pageSize.h*s] in viewer px.
    // Keep at least 80px of the floor plan visible on each axis.
    const margin = 80;
    const imgW = pageSize.w * s;
    const imgH = pageSize.h * s;
    const minX = margin - imgW;
    const maxX = vw - margin;
    const minY = margin - imgH;
    const maxY = vh - margin;
    return {
      x: Math.min(maxX, Math.max(minX, ox)),
      y: Math.min(maxY, Math.max(minY, oy)),
    };
  }, [pageSize]);

  /* ── centerImage ────────────────────────────────────────────────────── */
  const centerImage = useCallback(() => {
    const el = viewerRef.current;
    if (!el || !pageSize.w || !pageSize.h) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (!vw || !vh) return;
    const s = Math.min(vw / pageSize.w, vh / pageSize.h) * 0.90;
    const x = (vw - pageSize.w * s) / 2;
    const y = (vh - pageSize.h * s) / 2;
    setScale(s); setOffset({ x, y });
    scaleRef.current = s; offsetRef.current = { x, y };
  }, [pageSize]);

  /* re-center when pageSize arrives */
  useEffect(() => {
    if (pageSize.w > 0) {
      centerImage();
      const t = setTimeout(centerImage, 120);
      return () => clearTimeout(t);
    }
  }, [pageSize, centerImage]);

  /* re-center on fullscreen change */
  useEffect(() => {
    const t = setTimeout(centerImage, 80);
    return () => clearTimeout(t);
  }, [fullscreen, centerImage]);

  /* ── PDF.js rendering ───────────────────────────────────────────────── */
  const renderPdf = useCallback(async (renderScale: number) => {
    if (!pdfDocRef.current || renderingRef.current) return;
    renderingRef.current = true;
    try {
      const page = await pdfDocRef.current.getPage(1);
      const dpr  = window.devicePixelRatio || 1;
      const vp   = page.getViewport({ scale: renderScale * dpr });
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      setRenderedImageUrl(canvas.toDataURL('image/png', 1.0));
      lastRenderScale.current = renderScale;
    } finally {
      renderingRef.current = false;
    }
  }, []);

  /* ── Load image or PDF when imageUrl / rawPdfUrl changes ───────────── */
  useEffect(() => {
    if (!imageUrl) {
      setPageSize({ w: 0, h: 0 });
      setRenderedImageUrl(null);
      pdfDocRef.current = null;
      return;
    }
    if (isPdf) {
      // Load the original PDF via PDF.js for true vector quality
      const pdfSrc = rawPdfUrl || imageUrl;
      let cancelled = false;
      getPdfJs().then(async lib => {
        if (cancelled) return;
        const doc = await lib.getDocument({ url: pdfSrc }).promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        const page = await doc.getPage(1);
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        setPageSize({ w: vp.width, h: vp.height });
        // Initial render at a reasonable resolution; will re-render after centerImage
        await renderPdf(1.5);
      }).catch(() => {
        // PDF.js failed — fall back to the PNG preview from Cloudinary
        if (cancelled) return;
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          setPageSize({ w: img.naturalWidth, h: img.naturalHeight });
          setRenderedImageUrl(imageUrl);
        };
        img.src = imageUrl;
      });
      return () => { cancelled = true; };
    } else {
      // PNG / JPG — load normally
      pdfDocRef.current = null;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let cancelled = false;
      img.onload = () => {
        if (cancelled) return;
        setPageSize({ w: img.naturalWidth, h: img.naturalHeight });
        setRenderedImageUrl(imageUrl);
      };
      img.src = imageUrl;
      return () => { cancelled = true; img.onload = null; };
    }
  }, [imageUrl, isPdf, rawPdfUrl, renderPdf]);

  /* ── Re-render PDF at higher resolution when zoom changes significantly */
  useEffect(() => {
    if (!isPdf || !pdfDocRef.current || !pageSize.w) return;
    const ratio = scale / (lastRenderScale.current || scale);
    if (ratio > 1.6 || ratio < 0.6) {
      const t = setTimeout(() => renderPdf(scale), 120);
      return () => clearTimeout(t);
    }
  }, [scale, isPdf, pageSize.w, renderPdf]);

  /* ── pointer / pinch-zoom / inertia ────────────────────────────────── */
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    // ── helpers ──────────────────────────────────────────────────────────
    const applyTransform = (nx: number, ny: number, ns: number, clamp = true) => {
      const { x, y } = clamp
        ? clampOffset(nx, ny, ns)
        : { x: nx, y: ny };
      scaleRef.current  = ns;
      offsetRef.current = { x, y };
      setScale(ns);
      setOffset({ x, y });
    };

    const getPointerMidpoint = (): { x: number; y: number } | null => {
      const pts = Array.from(activePointersRef.current.values());
      if (pts.length < 2) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: (pts[0].x + pts[1].x) / 2 - rect.left,
        y: (pts[0].y + pts[1].y) / 2 - rect.top,
      };
    };

    const getPointerDistance = (): number => {
      const pts = Array.from(activePointersRef.current.values());
      if (pts.length < 2) return 0;
      return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    };

    // ── inertia ──────────────────────────────────────────────────────────
    const stopInertia = () => {
      cancelAnimationFrame(inertiaRafRef.current);
      velocityRef.current = { x: 0, y: 0 };
    };

    const startInertia = () => {
      cancelAnimationFrame(inertiaRafRef.current);
      const FRICTION = 0.88; // lower = stops faster; 0.88 feels natural
      const MIN_SPEED = 0.5;
      const tick = () => {
        velocityRef.current.x *= FRICTION;
        velocityRef.current.y *= FRICTION;
        if (Math.hypot(velocityRef.current.x, velocityRef.current.y) < MIN_SPEED) {
          velocityRef.current = { x: 0, y: 0 };
          return;
        }
        const { x, y } = clampOffset(
          offsetRef.current.x + velocityRef.current.x,
          offsetRef.current.y + velocityRef.current.y,
          scaleRef.current,
        );
        offsetRef.current = { x, y };
        setOffset({ x, y });
        inertiaRafRef.current = requestAnimationFrame(tick);
      };
      inertiaRafRef.current = requestAnimationFrame(tick);
    };

    // ── pointer events ───────────────────────────────────────────────────
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if ((e.target as HTMLElement).closest('button, a, [data-no-pan], [data-capture-pin], input, textarea, [role="dialog"]')) return;

      stopInertia();
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture(e.pointerId);

      if (activePointersRef.current.size === 2) {
        // Second finger down — switch to pinch mode
        pinchActiveRef.current    = true;
        draggingRef.current       = false;
        pinchStartDistRef.current = getPointerDistance();
        pinchStartScaleRef.current = scaleRef.current;
        const mid = getPointerMidpoint();
        if (mid) pinchMidpointRef.current = mid;
      } else {
        // First finger — start pan
        pinchActiveRef.current = false;
        draggingRef.current    = true;
        movedRef.current       = false;
        dragStartRef.current   = { x: e.clientX, y: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
        setIsDragging(true);
      }
    };

    const onMove = (e: PointerEvent) => {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinchActiveRef.current && activePointersRef.current.size >= 2) {
        // ── Pinch-zoom ──────────────────────────────────────────────────
        movedRef.current = true;
        const dist = getPointerDistance();
        if (pinchStartDistRef.current < 1) return;

        const rawScale = pinchStartScaleRef.current * (dist / pinchStartDistRef.current);
        const ns = Math.min(40, Math.max(0.05, rawScale));

        // Zoom toward the CURRENT midpoint between fingers (not the fixed start).
        // Also translate by midpoint movement so the scene tracks the fingers.
        const mid = getPointerMidpoint();
        if (!mid) return;
        const prevMid = pinchMidpointRef.current;
        const ratio = ns / scaleRef.current;
        const nx = mid.x - ratio * (mid.x - offsetRef.current.x) + (mid.x - prevMid.x);
        const ny = mid.y - ratio * (mid.y - offsetRef.current.y) + (mid.y - prevMid.y);
        pinchMidpointRef.current = mid;
        applyTransform(nx, ny, ns);

      } else if (draggingRef.current && activePointersRef.current.size === 1) {
        // ── Pan ─────────────────────────────────────────────────────────
        const nx = dragStartRef.current.ox + e.clientX - dragStartRef.current.x;
        const ny = dragStartRef.current.oy + e.clientY - dragStartRef.current.y;

        if (Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y) > 4) {
          movedRef.current = true;
        }

        // Track velocity for inertia (capped to prevent explosive launch)
        const now = performance.now();
        const dt = now - lastMoveTimeRef.current;
        if (dt > 0 && dt < 100) {
          const MAX_V = 40;
          velocityRef.current = {
            x: Math.max(-MAX_V, Math.min(MAX_V, nx - offsetRef.current.x)),
            y: Math.max(-MAX_V, Math.min(MAX_V, ny - offsetRef.current.y)),
          };
        }
        lastMoveTimeRef.current = now;

        const clamped = clampOffset(nx, ny, scaleRef.current);
        offsetRef.current = clamped;
        setOffset(clamped);
      }
    };

    const onUp = (e: PointerEvent) => {
      activePointersRef.current.delete(e.pointerId);

      if (activePointersRef.current.size === 1) {
        // One finger lifted from a pinch — reset to single-finger pan state
        pinchActiveRef.current = false;
        draggingRef.current    = true;
        movedRef.current       = true; // prevent accidental pin drop
        const remaining = Array.from(activePointersRef.current.entries())[0];
        if (remaining) {
          dragStartRef.current = {
            x: remaining[1].x, y: remaining[1].y,
            ox: offsetRef.current.x, oy: offsetRef.current.y,
          };
        }
        return;
      }

      if (activePointersRef.current.size === 0) {
        const wasDragging = draggingRef.current;
        const didPan = movedRef.current;
        pinchActiveRef.current = false;
        draggingRef.current    = false;
        setIsDragging(false);
        // Tap (no pan): select existing pin if hit, otherwise place a new one.
        // Use elementFromPoint because setPointerCapture retargets e.target to the container.
        if (!didPan) {
          const hit = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
          // Never place/select when interacting with overlays (Edit/Delete panel, etc.).
          if (hit?.closest?.('[data-no-pan], button, a, input, textarea, [role="dialog"]')) {
            movedRef.current = false;
          } else {
            const pinHost = hit?.closest?.('[data-capture-pin]') as HTMLElement | SVGElement | null;
            const pinId = pinHost?.getAttribute?.('data-capture-pin');
            if (pinId) {
              selectPinByIdRef.current(pinId);
            } else {
              placePinAtClientRef.current(e.clientX, e.clientY, e.target);
            }
          }
        }
        movedRef.current = false;
        // Kick off inertia only on single-finger pan release, not pinch
        if (wasDragging && didPan && !pinchActiveRef.current) {
          startInertia();
        }
      }
    };

    el.addEventListener('pointerdown',   onDown);
    el.addEventListener('pointermove',   onMove);
    el.addEventListener('pointerup',     onUp);
    el.addEventListener('pointercancel', onUp);

    return () => {
      el.removeEventListener('pointerdown',   onDown);
      el.removeEventListener('pointermove',   onMove);
      el.removeEventListener('pointerup',     onUp);
      el.removeEventListener('pointercancel', onUp);
      cancelAnimationFrame(inertiaRafRef.current);
      activePointersRef.current.clear();
    };
  }, [fullscreen, clampOffset]);

  /* ── Ctrl+Wheel zoom ────────────────────────────────────────────────── */
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.12 : -0.12;
      const next  = Math.min(40, Math.max(0.05, scaleRef.current + delta));
      const rect  = el.getBoundingClientRect();
      const mx    = e.clientX - rect.left;
      const my    = e.clientY - rect.top;
      const ratio = next / scaleRef.current;
      const nx    = mx - ratio * (mx - offsetRef.current.x);
      const ny    = my - ratio * (my - offsetRef.current.y);
      const clamped = clampOffset(nx, ny, next);
      scaleRef.current  = next;
      offsetRef.current = clamped;
      setScale(next);
      setOffset(clamped);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fullscreen, clampOffset]);

  /* ── Escape exits fullscreen ────────────────────────────────────────── */
  useEffect(() => {
    if (!fullscreen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fullscreen]);

  /* ── Pin placement: screen → page-space % ───────────────────────────── */
  // The SVG viewBox is `${-offset.x/scale} ${-offset.y/scale} ${cw/scale} ${ch/scale}`
  // with preserveAspectRatio="none", so a click at viewer-relative (mx,my) maps to
  // page coords ((mx-offset.x)/scale, (my-offset.y)/scale). We store as % of the
  // page so pins stay aligned at any zoom/pan.
  //
  // Placement is driven from pointerup (not SVG onClick): the viewer calls
  // setPointerCapture on the container, which retargets click away from the SVG
  // so SVG onClick never fires after a pan gesture setup.
  const placePinAtClient = useCallback((clientX: number, clientY: number, target?: EventTarget | null) => {
    const mayPlace = canAnnotate || canUsePins;
    if (!mayPlace || !floorPlan || !pageSize.w) return false;

    let placingAnnotate = annotateMode;
    let placingCapture = captureMode;
    if (!placingAnnotate && !placingCapture) {
      if (canAnnotate && !isEngineer) {
        placingAnnotate = true;
        setAnnotateMode(true);
        setCaptureMode(false);
      } else if (canUsePins || canAnnotate) {
        placingCapture = true;
        setCaptureMode(true);
        setAnnotateMode(false);
      }
    }
    if (!placingAnnotate && !placingCapture) return false;

    if ((target as Element | null)?.closest?.('#layer-captures')) return false;
    if ((target as Element | null)?.closest?.('button, a, [data-no-pan]')) return false;

    const el = viewerRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const pageX = (mx - offsetRef.current.x) / scaleRef.current;
    const pageY = (my - offsetRef.current.y) / scaleRef.current;
    if (pageX < 0 || pageY < 0 || pageX > pageSize.w || pageY > pageSize.h) return false;
    const xPct = (pageX / pageSize.w) * 100;
    const yPct = (pageY / pageSize.h) * 100;

    if (placingAnnotate) {
      setPendingAnnotate({ x: xPct, y: yPct });
      return true;
    }

    // Capture mode: when labeled admin points exist, map any tap to the
    // nearest labeled Flat · Room point (never free-place duplicates).
    const existingOnPlan = useWorkflowStore.getState().capturePins.filter(
      p => p.floorPlanId === floorPlan.id || p.floorId === floor!.id,
    );
    const labeled = existingOnPlan.filter(p => p.flatName && p.roomName);
    if (labeled.length > 0) {
      let nearest = labeled[0];
      let bestD = Infinity;
      for (const p of labeled) {
        const d = Math.hypot(p.x - xPct, p.y - yPct);
        if (d < bestD) { bestD = d; nearest = p; }
      }
      setSelectedPinId(nearest.id);
      return true;
    }

    const pinId = createCapturePin({
      floorPlanId: floorPlan.id,
      floorId: floor!.id,
      towerId: tower!.id,
      projectId: project!.id,
      x: xPct, y: yPct,
    });
    if (!pinsVisible) setFloorPlanPinsVisible(floorPlan.id, true);
    const created = useWorkflowStore.getState().capturePins.find(p => p.id === pinId);
    if (created?.roomName) {
      setPublishToast(`Pin ${created.sequenceNumber} · Mapped to ${created.flatName ?? ''} · ${created.roomName}`);
    } else if (created) {
      setPublishToast(`Pin ${created.sequenceNumber} placed`);
    }
    setSelectedPinId(pinId);
    return true;
  }, [captureMode, annotateMode, canAnnotate, canUsePins, isEngineer, floorPlan, pageSize.w, pageSize.h, createCapturePin, floor, tower, project, pinsVisible, setFloorPlanPinsVisible]);

  useEffect(() => { placePinAtClientRef.current = placePinAtClient; }, [placePinAtClient]);

  // Build CaptureSnapshot[] from this pin's real captures for the timeline
  const pinTimeline: CaptureSnapshot[] = selectedPin
    ? (selectedPin.captureIds
        .map((id, i) => {
          const cap = captures.find(c => c.id === id);
          if (!cap) return null;
          const isLatest = i === selectedPin.captureIds.length - 1;
          const snap: CaptureSnapshot = {
            id: cap.id,
            baseCaptureId: cap.id,
            roomId: cap.roomId,
            date: cap.capturedAt ?? '',
            dateLabel: formatCaptureDateTime(cap.capturedAt, cap.uploadedAt) || `Visit ${i + 1}`,
            monthLabel: '',
            reviewStatus: cap.reviewStatus ?? 'uploaded',
            progress: isLatest ? 100 : Math.round(((i + 1) / selectedPin.captureIds.length) * 100),
            fileCount: cap.fileCount,
            capturedBy: cap.uploadedBy,
            note: null,
            gradient: cap.gradient,
            isLatest,
          };
          return snap;
        })
        .filter(Boolean) as CaptureSnapshot[])
    : [];

  /* ── Begin capture for a pin (long-press or panel button) ───────────── */
  const beginCapture = useCallback((pin: WfCapturePin) => {
    setSelectedPinId(pin.id);
    setActivePin(pin);
  }, []);

  /* ── Durable file queue (same path as Capture Workflow) ─────────────── */
  // Throws on failure so the caller dialog (CameraCaptureDialog / PinUploadDialog)
  // can show its own error state instead of silently closing. Network failures
  // are handled inside the queue (retry on reconnect); only local persist errors
  // throw from enqueueFileUpload.
  const performAttach = useCallback(async (files: File[]): Promise<void> => {
    if (!activePin || attachingRef.current) throw new Error('No active pin');
    attachingRef.current = true;
    // Snapshot pin id now — activePin may be cleared by the time the upload resolves.
    const pinId = activePin.id;
    try {
      for (const file of files) {
        await enqueueFileUpload(pinId, file);
      }
    } catch (err) {
      const e = err as { message?: string; response?: { data?: { message?: string } } };
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        'Could not save the capture on this device. Please try again.';
      setErrorToast(msg);
      throw err;
    } finally {
      attachingRef.current = false;
    }
  }, [activePin]);

  /* ── Publish the pin-ordered walkthrough ────────────────────────────── */
  const handlePublishWalkthrough = useCallback(() => {
    if (!floorPlan) return;
    const tourIds = publishFloorPlanTour(floorPlan.id);
    setPublishToast(tourIds.length
      ? `Published walkthrough · ${tourIds.length} tour${tourIds.length !== 1 ? 's' : ''} in pin order`
      : 'No pins with captures to publish yet');
  }, [floorPlan, publishFloorPlanTour]);

  if (!project || !tower || !floor) {
    const earlyBackDest = returnTo ?? `/floor-plans?project=${projectId}&tower=${towerId}`;
    return (
      <Box sx={{ p: 4 }}>
        <Box component={Link} to={earlyBackDest} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: P.blue, textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
          <ArrowBackRounded sx={{ fontSize: 16 }} /> Back
        </Box>
        <Typography sx={{ color: P.muted, mt: 2 }}>Floor not found.</Typography>
      </Box>
    );
  }

  const statusCounts = floorPlan ? {
    not_started: floorPlan.rooms.filter(r => r.status === 'not_started').length,
    in_progress: floorPlan.rooms.filter(r => r.status === 'in_progress').length,
    reviewed:    floorPlan.rooms.filter(r => r.status === 'reviewed').length,
    published:   floorPlan.rooms.filter(r => r.status === 'published').length,
  } : null;

  /* ── SVG viewBox: maps scale+offset state to SVG coordinate space ─── */
  // ViewBox defines which portion of "page space" (0,0 → pageW,pageH) is visible.
  // When scale=1 and offset=(0,0), we'd see: x=0, y=0, w=cw, h=ch in page units.
  // Shifting offset moves the window; scaling zooms by shrinking w/h around cursor.
  const vbX = containerSize.w > 0 ? -offset.x / scale : 0;
  const vbY = containerSize.h > 0 ? -offset.y / scale : 0;
  const vbW = containerSize.w > 0 ? containerSize.w / scale : 100;
  const vbH = containerSize.h > 0 ? containerSize.h / scale : 100;

  /* ── viewer box ─────────────────────────────────────────────────────── */
  const viewerBox = (
    <Box
      ref={viewerRef}
      sx={{
        position: 'relative',
        width: '100%',
        flex: fullscreen ? 1 : undefined,
        height: fullscreen ? undefined : { xs: pinsOnly ? 'calc(100dvh - 150px)' : 'calc(100dvh - 190px)', sm: 400, md: 'calc(100vh - 280px)' },
        minHeight: { xs: 340, md: 480 },
        borderRadius: fullscreen ? 0 : '16px',
        overflow: 'hidden',
        backgroundColor: '#f1f3f7',
        backgroundImage: `radial-gradient(circle, #d1d5db 1px, transparent 1px)`,
        backgroundSize: '24px 24px',
        cursor: isDragging
          ? 'grabbing'
          : (captureMode || annotateMode || canAnnotate || canUsePins)
            ? 'crosshair'
            : 'grab',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* ── SVG viewer: single coordinate system for floor plan + all layers ── */}
      {renderedImageUrl && pageSize.w > 0 && (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', overflow: 'visible', cursor: (captureMode || annotateMode || canAnnotate || canUsePins) ? 'crosshair' : undefined }}
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          preserveAspectRatio="none"
        >
          <defs>
            {/* Drop shadow filter for the floor plan sheet */}
            <filter id="fp-shadow" x="-8%" y="-8%" width="116%" height="116%">
              <feDropShadow dx="0" dy="4" stdDeviation="14" floodColor="rgba(15,23,42,0.20)" />
            </filter>
          </defs>

          {/* Layer 0: Floor plan image (PDF.js canvas or PNG/JPG) */}
          {/* White background behind image */}
          <rect x={0} y={0} width={pageSize.w} height={pageSize.h} fill="#ffffff" filter="url(#fp-shadow)" rx={8 / scale} />
          <image
            href={renderedImageUrl}
            x={0} y={0}
            width={pageSize.w}
            height={pageSize.h}
            preserveAspectRatio="none"
            style={{ imageRendering: 'auto' }}
          />

          {/* Layer 1: Room overlays
              All coordinates are % of pageSize, converted to page units.
              vectorEffect="non-scaling-stroke" keeps stroke widths at 1.5px visually
              regardless of zoom level — no thick borders at high zoom. */}
          {!pinsOnly && floorPlan && floorPlan.rooms.length > 0 && (
            <g id="layer-rooms">
              {floorPlan.rooms.map(room => {
                const sc  = STATUS_COLOR[room.status] ?? STATUS_COLOR.not_started;
                const rx  = (room.x      / 100) * pageSize.w;
                const ry  = (room.y      / 100) * pageSize.h;
                const rw  = (room.width  / 100) * pageSize.w;
                const rh  = (room.height / 100) * pageSize.h;
                const sel = selectedRoom?.id === room.id;
                // Font size proportional to room area — stays legible at any zoom
                const fs1 = Math.max(pageSize.w * 0.009, Math.min(rw, rh) * 0.18);
                const fs2 = Math.max(pageSize.w * 0.007, Math.min(rw, rh) * 0.13);
                return (
                  <g
                    key={room.id}
                    onClick={e => { e.stopPropagation(); setSelectedRoom(sel ? null : room); }}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={rx} y={ry} width={rw} height={rh}
                      fill={sel ? sc.stroke : sc.fill}
                      fillOpacity={sel ? 0.38 : 1}
                      stroke={sc.stroke}
                      strokeWidth={sel ? 2.5 : 1.5}
                      vectorEffect="non-scaling-stroke"
                      rx={Math.min(rw, rh) * 0.06}
                    />
                    <text
                      x={rx + rw / 2} y={ry + rh / 2 - fs1 * 0.6}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={fs1}
                      fontWeight={700}
                      fill={sel ? '#fff' : sc.stroke}
                      pointerEvents="none"
                      fontFamily="Inter, system-ui, sans-serif"
                    >{room.number}</text>
                    <text
                      x={rx + rw / 2} y={ry + rh / 2 + fs1 * 0.9}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={fs2}
                      fill={sel ? 'rgba(255,255,255,0.8)' : '#64748b'}
                      pointerEvents="none"
                      fontFamily="Inter, system-ui, sans-serif"
                    >{room.type}</text>
                  </g>
                );
              })}
            </g>
          )}

          {/* Layer 2: Capture points — annotate=all blue; pinsOnly=green + # only */}
          {floorPlan && pins.length > 0 && (
            <g id="layer-captures">
              {pins.map(pin => (
                <CapturePinMarker
                  key={pin.id}
                  pin={pin}
                  pageW={pageSize.w}
                  pageH={pageSize.h}
                  scale={scale}
                  selected={selectedPinId === pin.id}
                  dense={pins.length >= 36}
                  annotationOnly={annotateMode}
                  showSequence={pinsOnly}
                  sequenceNumber={uploadSeqById?.get(pin.id) ?? pin.sequenceNumber}
                  onSelect={p => setSelectedPinId(p.id)}
                />
              ))}
            </g>
          )}

          {/* Layer 3: AI defect markers — future */}
          {/* <g id="layer-defects"> ... </g> */}

          {/* Layer 4: Measurements — future */}
          {/* <g id="layer-measurements"> ... </g> */}

          {/* Layer 5: Navigation paths — future */}
          {/* <g id="layer-nav-paths"> ... </g> */}
        </svg>
      )}

      {/* Empty states */}
      {!imageUrl && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          {floorPlan ? (
            <Box sx={{ pointerEvents: 'all', maxWidth: { xs: '85%', sm: 360 }, width: '100%', borderRadius: '16px', border: `1.5px solid ${P.border}`, backgroundColor: P.white, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, px: 3, py: 4, boxShadow: '0 4px 24px rgba(15,23,42,0.10)' }}>
              <LayersRounded sx={{ fontSize: 40, color: P.subtle }} />
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong }}>{floorPlan.fileName}</Typography>
              {!isEngineer && (
                <Box component={Link} to={`/floor-plans/${projectId}/${towerId}/${floorId}/upload`} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', backgroundColor: P.blue, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
                  <UploadFileRounded sx={{ fontSize: 15 }} /> Re-upload for preview
                </Box>
              )}
            </Box>
          ) : isEngineer ? (
            <Box sx={{ maxWidth: { xs: '85%', sm: 320 }, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25 }}>
              <Box sx={{ width: 56, height: 56, borderRadius: '16px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(15,23,42,0.06)', mb: 0.5 }}>
                <CloudOffRounded sx={{ fontSize: 26, color: P.subtle }} />
              </Box>
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, textAlign: 'center' }}>
                Floor plan not uploaded yet
              </Typography>
              <Typography sx={{ fontSize: '0.875rem', color: P.muted, textAlign: 'center', maxWidth: 240, lineHeight: 1.6 }}>
                The admin hasn't uploaded a plan for this floor. Check back later.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ pointerEvents: 'all', maxWidth: { xs: '85%', sm: 360 }, width: '100%', borderRadius: '16px', border: `2px dashed ${P.border}`, backgroundColor: P.white, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, px: 3, py: 4 }}>
              <RoomRounded sx={{ fontSize: 40, color: P.subtle }} />
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong }}>No floor plan uploaded</Typography>
              <Typography sx={{ fontSize: '0.875rem', color: P.muted, textAlign: 'center', maxWidth: 260 }}>Upload a PNG, JPG or PDF to view the plan here.</Typography>
              <Box component={Link} to={`/floor-plans/${projectId}/${towerId}/${floorId}/upload`} sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.75, px: 2.25, py: 0.875, borderRadius: '8px', backgroundColor: P.blue, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
                <UploadFileRounded sx={{ fontSize: 15 }} /> Upload Floor Plan
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Re-annotate required after plan image replace */}
      {canAnnotate && floorPlan?.needsReannotate && !annotateMode && (
        <Box sx={{ position: 'absolute', top: fullscreen ? 56 : 12, left: '50%', transform: 'translateX(-50%)', zIndex: 15, display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 0.875, borderRadius: '10px', backgroundColor: 'rgba(180,83,9,0.95)', boxShadow: '0 4px 16px rgba(15,23,42,0.25)', maxWidth: '92%' }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff', lineHeight: 1.35 }}>
            New floor-plan drawing uploaded — re-annotate labeled capture points (old coords may not match).
          </Typography>
          <Box
            onClick={() => { setAnnotateMode(true); setCaptureMode(false); }}
            sx={{ flexShrink: 0, px: 1.25, py: 0.5, borderRadius: '8px', backgroundColor: '#fff', color: '#b45309', fontSize: '0.6875rem', fontWeight: 700, cursor: 'pointer' }}
          >
            Annotate
          </Box>
        </Box>
      )}

      {/* Capture-mode / annotate-mode hint banner */}
      {(captureMode || annotateMode) && !(canAnnotate && floorPlan?.needsReannotate && !annotateMode) && (
        <Box sx={{ position: 'absolute', top: fullscreen ? 56 : 12, left: '50%', transform: 'translateX(-50%)', zIndex: 15, display: 'flex', alignItems: 'center', gap: 0.875, px: 1.75, py: 0.875, borderRadius: '10px', backgroundColor: annotateMode ? 'rgba(15,118,110,0.95)' : 'rgba(37,99,235,0.95)', backdropFilter: 'blur(8px)', boxShadow: '0 4px 16px rgba(15,23,42,0.25)', pointerEvents: 'none', maxWidth: '90%' }}>
          <AddLocationAltRounded sx={{ fontSize: 16, color: '#fff', flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff', lineHeight: 1.3 }}>
            {annotateMode
              ? 'Annotating capture points · Flat + Room only (field captures hidden)'
              : `Tap plan to place a capture point`}
          </Typography>
        </Box>
      )}

      {/* Controls */}
      <Box sx={{ position: 'absolute', top: fullscreen ? 56 : 12, left: 12, display: 'flex', flexDirection: 'column', gap: 0.625, zIndex: 10 }}>
        <CtrlBtn title="Zoom in" small={isMobile} onClick={() => {
          const n = Math.min(40, scaleRef.current * 1.35);
          const cx = (viewerRef.current?.clientWidth ?? 0) / 2;
          const cy = (viewerRef.current?.clientHeight ?? 0) / 2;
          const r = n / scaleRef.current;
          const raw = { x: cx - r*(cx-offsetRef.current.x), y: cy - r*(cy-offsetRef.current.y) };
          const clamped = clampOffset(raw.x, raw.y, n);
          scaleRef.current = n; offsetRef.current = clamped; setScale(n); setOffset(clamped);
        }}><ZoomInRounded sx={{ fontSize: isMobile ? 15 : 17 }} /></CtrlBtn>
        <CtrlBtn title="Zoom out" small={isMobile} onClick={() => {
          const n = Math.max(0.05, scaleRef.current / 1.35);
          const cx = (viewerRef.current?.clientWidth ?? 0) / 2;
          const cy = (viewerRef.current?.clientHeight ?? 0) / 2;
          const r = n / scaleRef.current;
          const raw = { x: cx - r*(cx-offsetRef.current.x), y: cy - r*(cy-offsetRef.current.y) };
          const clamped = clampOffset(raw.x, raw.y, n);
          scaleRef.current = n; offsetRef.current = clamped; setScale(n); setOffset(clamped);
        }}><ZoomOutRounded sx={{ fontSize: isMobile ? 15 : 17 }} /></CtrlBtn>
        <CtrlBtn title="Fit to screen" small={isMobile} onClick={centerImage}><CenterFocusStrongRounded sx={{ fontSize: isMobile ? 15 : 17 }} /></CtrlBtn>
        <CtrlBtn title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} small={isMobile} onClick={() => setFullscreen(f => !f)}>
          {fullscreen ? <FullscreenExitRounded sx={{ fontSize: isMobile ? 15 : 17 }} /> : <FullscreenRounded sx={{ fontSize: isMobile ? 15 : 17 }} />}
        </CtrlBtn>
        {floorPlan && !pinsOnly && (
          <CtrlBtn
            title={pinsVisible ? 'Hide empty capture points' : 'Show empty capture points'}
            small={isMobile}
            onClick={() => {
              const next = !pinsVisible;
              // Keep every plan record for this floor in sync (re-uploads leave siblings).
              const ids = floorId
                ? floorPlans.filter(fp => fp.floorId === floorId).map(fp => fp.id)
                : [floorPlan.id];
              (ids.length ? ids : [floorPlan.id]).forEach(id => setFloorPlanPinsVisible(id, next));
            }}
          >
            {pinsVisible
              ? <VisibilityOffRounded sx={{ fontSize: isMobile ? 15 : 17 }} />
              : <VisibilityRounded sx={{ fontSize: isMobile ? 15 : 17 }} />}
          </CtrlBtn>
        )}
        {canAnnotate && floorPlan && !pinsOnly && (
          <CtrlBtn
            title={annotateMode
              ? 'Done annotating'
              : 'Annotate labeled points — tap plan, then choose Flat + Room'}
            small={isMobile}
            onClick={() => {
              setAnnotateMode(v => {
                const next = !v;
                if (next) setShowTimeline(false);
                return next;
              });
              setCaptureMode(false);
            }}
          >
            <EditLocationAltRounded sx={{ fontSize: isMobile ? 15 : 17, color: annotateMode ? '#0f766e' : undefined }} />
          </CtrlBtn>
        )}
        {canAnnotate && floorPlan && !pinsOnly && siblingFloorsWithPins.length > 0 && (
          <CtrlBtn
            title="Import annotations from another annotated floor"
            small={isMobile}
            onClick={() => {
              setCopySourceFloorId(siblingFloorsWithPins[0]?.id ?? '');
              setCopyOpen(true);
            }}
          >
            <ContentCopyRounded sx={{ fontSize: isMobile ? 15 : 17 }} />
          </CtrlBtn>
        )}
        {canUsePins && (
          <CtrlBtn
            title={captureMode
              ? 'Exit free-place mode'
              : 'Free-place capture pins — tap to drop a point without Flat/Room dialog (inherits nearest labeled Flat · Room)'}
            small={isMobile}
            onClick={() => {
              setCaptureMode(v => !v);
              setAnnotateMode(false);
            }}
          >
            <AddLocationAltRounded sx={{ fontSize: isMobile ? 15 : 17, color: captureMode ? P.blue : undefined }} />
          </CtrlBtn>
        )}
      </Box>

      {/* Fullscreen back button — navigates away (same destination as header back link) */}
      {fullscreen && (
        <Box
          data-no-pan
          onClick={() => navigate(backDest)}
          sx={{
            position: 'absolute', top: 14, left: 14, zIndex: 30,
            display: 'inline-flex', alignItems: 'center', gap: 0.625,
            px: 1.375, py: 0.625, borderRadius: '10px', cursor: 'pointer',
            backgroundColor: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(12px)',
            border: `1.5px solid ${P.border}`, color: P.strong,
            boxShadow: '0 2px 8px rgba(15,23,42,0.10)',
            transition: T, '&:hover': { backgroundColor: P.white, borderColor: P.blue, color: P.blue },
          }}
        >
          <ArrowBackRounded sx={{ fontSize: 14 }} />
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1 }}>Back</Typography>
        </Box>
      )}

      {/* Zoom indicator + hint */}
      <Box sx={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10, display: 'flex', alignItems: 'center', gap: 0.625 }}>
        {!fullscreen && (
          <Box sx={{ display: { xs: 'none', sm: 'block' }, px: 1.125, py: 0.375, borderRadius: '6px', backgroundColor: 'rgba(17,24,39,0.55)', backdropFilter: 'blur(8px)' }}>
            <Typography sx={{ fontSize: '0.5625rem', color: 'rgba(255,255,255,0.55)', fontWeight: 500, letterSpacing: '0.04em' }}>Ctrl + Scroll to zoom</Typography>
          </Box>
        )}
        <Box sx={{ px: 1.125, py: 0.375, borderRadius: '6px', backgroundColor: 'rgba(17,24,39,0.65)', backdropFilter: 'blur(8px)' }}>
          <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.92)', fontWeight: 700 }}>{Math.round(scale * 100)}%</Typography>
        </Box>
      </Box>

      {selectedRoom && <RoomActionPanel room={selectedRoom} onClose={() => setSelectedRoom(null)} isMobile={isMobile} />}

      {selectedPin && !showTimeline && (
        <PinActionPanel
          pin={selectedPin}
          isMobile={isMobile}
          canEdit={!pinsOnly && canAnnotate}
          annotationOnly={annotateMode}
          uploadSequence={pinsOnly ? uploadSeqById?.get(selectedPin.id) : undefined}
          onEdit={(p) => {
            const flat = p.flatName || PREDEF_FLAT_OPTIONS[0];
            const room = p.roomName || '';
            setAnnotateFlat(flat);
            if (isCustomRoomName(flat, room)) {
              setAnnotateRoom(PREDEF_ROOM_OTHER);
              setAnnotateCustomRoom(room);
            } else {
              setAnnotateRoom(room || roomOptionsForFlat(flat)[0] || '');
              setAnnotateCustomRoom('');
            }
            setEditingPinId(p.id);
            setPendingAnnotate(null);
            setSelectedPinId(null);
          }}
          onDelete={p => { deleteCapturePin(p.id); setSelectedPinId(null); }}
          onClose={() => setSelectedPinId(null)}
        />
      )}

      {selectedPin && !annotateMode && showTimeline && pinTimeline.length > 0 && (
        <Box sx={
          isMobile
            ? { position: 'absolute', bottom: 0, left: 0, right: 0, borderRadius: '16px 16px 0 0', backgroundColor: P.white, boxShadow: '0 -4px 24px rgba(15,23,42,0.18)', zIndex: 20, overflow: 'hidden', border: `1px solid ${P.border}`, p: 2.5 }
            : { position: 'absolute', top: 16, right: 16, width: 340, borderRadius: '16px', backgroundColor: P.white, boxShadow: '0 12px 40px rgba(15,23,42,0.16)', zIndex: 20, overflow: 'hidden', border: `1px solid ${P.border}`, p: 2.5 }
        }>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }}>
              {(selectedPin.flatName && selectedPin.roomName)
                ? `${selectedPin.flatName} · ${selectedPin.roomName}`
                : (selectedPin.roomName || selectedPin.label || 'Capture point')}
              {' '}— History
            </Typography>
            <Box onClick={() => setShowTimeline(false)} sx={{ cursor: 'pointer', color: P.subtle, display: 'flex', '&:hover': { color: P.strong } }}>
              <Box component="span" sx={{ fontSize: 18, lineHeight: 1 }}>✕</Box>
            </Box>
          </Box>
          <CaptureTimeline
            series={pinTimeline}
            activeId={timelineActiveId}
            onSelect={snap => setTimelineActiveId(snap.id)}
          />
        </Box>
      )}
    </Box>
  );

  /* ── capture dialogs (shared across normal + fullscreen) ───────────── */
  const captureDialogs = activePin && (
    useCamera ? (
      <CameraCaptureDialog
        open={!!activePin}
        pinLabel={
          activePin.flatName && activePin.roomName
            ? `${activePin.flatName} · ${activePin.roomName}`
            : (activePin.roomName || activePin.label || 'Capture point')
        }
        onCapture={file => performAttach([file])}
        onClose={() => setActivePin(null)}
      />
    ) : (
      <PinUploadDialog
        open={!!activePin}
        pinLabel={
          activePin.flatName && activePin.roomName
            ? `${activePin.flatName} · ${activePin.roomName}`
            : (activePin.roomName || activePin.label || 'Capture point')
        }
        onUpload={files => performAttach(files)}
        onClose={() => setActivePin(null)}
      />
    )
  );

  /* ── fullscreen overlay ─────────────────────────────────────────────── */
  if (fullscreen) {
    return (
      <Box sx={{ position: 'fixed', inset: 0, zIndex: 1400, backgroundColor: '#0d1117', display: 'flex', flexDirection: 'column' }}>
        {viewerBox}
        {captureDialogs}
      </Box>
    );
  }

  /* ── normal page ────────────────────────────────────────────────────── */
  return (
    <Box sx={{
      pb: { xs: 2, sm: 6 },
      opacity: fadeIn ? 1 : 0,
      transform: fadeIn ? 'translateY(0)' : 'translateY(6px)',
      transition: 'opacity 220ms ease, transform 220ms ease',
    }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: { xs: 1.5, sm: 3 }, gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }}>
          <Box component={Link} to={backDest}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, px: 1.125, py: 0.625, borderRadius: '9px', border: `1.5px solid ${P.border}`, color: P.muted, textDecoration: 'none', flexShrink: 0, transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft }, whiteSpace: 'nowrap', fontSize: '0.8125rem', fontWeight: 600 }}>
            <ArrowBackRounded sx={{ fontSize: 15 }} />
            Back
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.6875rem', color: P.muted, mb: 0.125, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: { xs: 'none', sm: 'block' } }}>{project.name} · {tower.name}</Typography>
            <Typography sx={{ fontSize: { xs: '0.9375rem', sm: '1.375rem' }, fontWeight: 800, color: P.strong, letterSpacing: '-0.03em', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {floor.label}{pinsOnly ? ' — Capture Pins' : ' — Floor Plan'}
            </Typography>
            {/* Mobile: project context below title */}
            <Typography sx={{ fontSize: '0.6875rem', color: P.muted, display: { xs: 'block', sm: 'none' }, mt: 0.25 }}>{tower.name}</Typography>
          </Box>
        </Box>
        {!isEngineer && !pinsOnly && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {floorPlan && canAnnotate && siblingFloorsWithPins.length > 0 && (
              <Box
                onClick={() => {
                  setCopySourceFloorId(siblingFloorsWithPins[0]?.id ?? '');
                  setCopyOpen(true);
                }}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: { xs: 0, sm: 0.75 },
                  px: { xs: 0.75, sm: 1.5 }, py: 0.75,
                  minWidth: { xs: 34, sm: 'auto' }, height: { xs: 34, sm: 'auto' },
                  borderRadius: '9px', border: `1.5px solid ${P.border}`,
                  color: P.muted, cursor: 'pointer', whiteSpace: 'nowrap', transition: T,
                  '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
                }}
              >
                <ContentCopyRounded sx={{ fontSize: 15 }} />
                <Typography component="span" sx={{ display: { xs: 'none', sm: 'inline' }, fontSize: '0.8125rem', fontWeight: 600, ml: 0.75 }}>
                  Import annotations
                </Typography>
              </Box>
            )}
            {floorPlan && canAnnotate && (
              <Box
                onClick={() => setDeletePlanOpen(true)}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: { xs: 0, sm: 0.75 },
                  px: { xs: 0.75, sm: 1.5 }, py: 0.75,
                  minWidth: { xs: 34, sm: 'auto' }, height: { xs: 34, sm: 'auto' },
                  borderRadius: '9px', border: `1.5px solid ${P.border}`,
                  color: P.muted, cursor: 'pointer', whiteSpace: 'nowrap', transition: T,
                  '&:hover': { borderColor: '#ef4444', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.06)' },
                }}
              >
                <DeleteOutlineRounded sx={{ fontSize: 15 }} />
                <Typography component="span" sx={{ display: { xs: 'none', sm: 'inline' }, fontSize: '0.8125rem', fontWeight: 600, ml: 0.75 }}>
                  Delete Plan
                </Typography>
              </Box>
            )}
            <Box component={Link} to={`/floor-plans/${projectId}/${towerId}/${floorId}/upload`}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: { xs: 0, sm: 0.75 },
                px: { xs: 0.75, sm: 1.5 }, py: 0.75,
                minWidth: { xs: 34, sm: 'auto' }, height: { xs: 34, sm: 'auto' },
                borderRadius: '9px', border: `1.5px solid ${P.border}`,
                color: P.muted, textDecoration: 'none', whiteSpace: 'nowrap', transition: T,
                '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
                flexShrink: 0,
              }}>
              <UploadFileRounded sx={{ fontSize: 15 }} />
              <Typography component="span" sx={{ display: { xs: 'none', sm: 'inline' }, fontSize: '0.8125rem', fontWeight: 600, ml: 0.75 }}>
                {floorPlan ? 'Replace Plan' : 'Upload Plan'}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>

      {/* Legend strip — hidden on mobile to maximise viewer height */}
      {!pinsOnly && statusCounts && floorPlan && floorPlan.rooms.length > 0 && (
        <Box sx={{
          display: { xs: 'none', sm: 'flex' }, gap: 1, mb: 2.5,
          overflowX: { xs: 'auto', sm: 'visible' },
          flexWrap: { xs: 'nowrap', sm: 'wrap' },
          pb: { xs: 0.5, sm: 0 },
          '&::-webkit-scrollbar': { height: 3 },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: P.border, borderRadius: '99px' },
        }}>
          {(Object.entries(STATUS_COLOR) as [string, typeof STATUS_COLOR[string]][]).map(([key, val]) => (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.625, px: 1.25, py: 0.5, borderRadius: '7px', backgroundColor: P.white, border: `1px solid ${P.border}`, flexShrink: 0 }}>
              <Box sx={{ width: 9, height: 9, borderRadius: '2px', backgroundColor: val.fill, border: `1.5px solid ${val.stroke}` }} />
              <Typography sx={{ fontSize: '0.75rem', color: P.muted, fontWeight: 500 }}>{val.label}</Typography>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: val.stroke }}>{statusCounts[key as keyof typeof statusCounts]}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Viewer + Floor sidebar */}
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' } }}>
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>{viewerBox}</Box>

        {/* Floor switcher */}
        {!pinsOnly && towerFloors.length > 1 && (
          <>
            {/* Mobile: compact dropdown → bottom sheet */}
            <Box sx={{ display: { xs: 'block', md: 'none' }, width: '100%' }}>
              <Box
                onClick={() => setFloorSheetOpen(true)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.25,
                  px: 1.5, py: 1.125, borderRadius: '12px',
                  border: `1.5px solid ${floorSheetOpen ? P.blue : P.border}`,
                  backgroundColor: P.white, cursor: 'pointer', transition: T,
                  '&:hover': { borderColor: P.blue },
                }}
              >
                <Box sx={{ width: 28, height: 28, borderRadius: '7px', backgroundColor: P.blueSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <LayersRounded sx={{ fontSize: 15, color: P.blue }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }}>{floor.label}</Typography>
                </Box>
                <Typography sx={{ fontSize: '0.75rem', color: P.muted, mr: 0.5 }}>
                  {towerFloors.length} floors
                </Typography>
                <KeyboardArrowDownRounded sx={{ fontSize: 18, color: P.muted, flexShrink: 0, transform: floorSheetOpen ? 'rotate(180deg)' : 'none', transition: T }} />
              </Box>
              <Drawer
                anchor="bottom"
                open={floorSheetOpen}
                onClose={() => setFloorSheetOpen(false)}
                slotProps={{ paper: { sx: { borderRadius: '20px 20px 0 0', pt: 0, pb: 'env(safe-area-inset-bottom, 16px)', maxHeight: '70vh' } } }}
              >
                <Box sx={{ width: 36, height: 4, borderRadius: '99px', backgroundColor: '#e4e7ec', mx: 'auto', mt: 1.5, mb: 2 }} />
                <Typography sx={{ px: 2.5, pb: 1.5, fontSize: '0.6875rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Floors
                </Typography>
                <Box sx={{ overflowY: 'auto', px: 1.5, pb: 2 }}>
                  {towerFloors.map(f => {
                    const active = f.id === floorId;
                    const hasPlan = !!getFloorPlanByFloor(floorPlans, towerId ?? '', f.id);
                    return (
                      <Box
                        key={f.id}
                        component={Link}
                        to={`/floor-plans/${projectId}/${towerId}/${f.id}`}
                        onClick={() => setFloorSheetOpen(false)}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 1, borderRadius: '9px', textDecoration: 'none', backgroundColor: active ? P.blueSoft : 'transparent', '&:hover': { backgroundColor: active ? P.blueSoft : P.bg } }}
                      >
                        <Box sx={{ width: 28, height: 28, borderRadius: '7px', backgroundColor: active ? P.blue : P.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: active ? P.white : P.muted }}>{f.number}</Typography>
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography sx={{ fontSize: '0.875rem', fontWeight: active ? 700 : 500, color: active ? P.blue : P.strong }}>{f.label}</Typography>
                          <Typography sx={{ fontSize: '0.6875rem', color: hasPlan ? P.muted : '#d1d5db' }}>{hasPlan ? 'View plan' : 'Not uploaded'}</Typography>
                        </Box>
                        {active && <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: P.blue, flexShrink: 0 }} />}
                      </Box>
                    );
                  })}
                </Box>
              </Drawer>
            </Box>

            {/* Desktop: vertical pill list */}
            <Box sx={{
              display: { xs: 'none', md: 'flex' },
              width: 108, flexShrink: 0,
              backgroundColor: P.white,
              border: `1.5px solid ${P.border}`,
              borderRadius: '14px',
              flexDirection: 'column',
            }}>
              <Box sx={{ px: 1.5, pt: 1.5, pb: 1, borderBottom: `1px solid ${P.border}`, borderRadius: '14px 14px 0 0' }}>
                <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: P.subtle, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Floors
                </Typography>
              </Box>
              <Box sx={{
                overflowY: 'auto', maxHeight: 'calc(100vh - 340px)',
                '&::-webkit-scrollbar': { width: 3 },
                '&::-webkit-scrollbar-track': { background: 'transparent' },
                '&::-webkit-scrollbar-thumb': { background: P.border, borderRadius: '99px' },
                p: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5,
              }}>
                {towerFloors.map(f => {
                  const active = f.id === floorId;
                  const hasPlan = !!getFloorPlanByFloor(floorPlans, towerId ?? '', f.id);
                  return (
                    <Box key={f.id} component={Link} to={`/floor-plans/${projectId}/${towerId}/${f.id}`}
                      sx={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        gap: 0.25, py: 1.25, px: 0.5, borderRadius: '9px',
                        border: `1.5px solid ${active ? P.blue : 'transparent'}`,
                        backgroundColor: active ? P.blueSoft : 'transparent',
                        color: active ? P.blue : P.muted,
                        textDecoration: 'none', transition: T, cursor: 'pointer',
                        '&:hover': { backgroundColor: active ? P.blueSoft : P.bg, borderColor: active ? P.blue : P.border },
                      }}
                    >
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: active ? 700 : 500, color: 'inherit', lineHeight: 1 }}>{f.number}</Typography>
                      <Typography sx={{ fontSize: '0.5rem', fontWeight: 500, lineHeight: 1.2, letterSpacing: '0.01em', textAlign: 'center', color: active ? P.blue : (hasPlan ? P.subtle : '#d1d5db') }}>
                        {hasPlan ? 'View plan' : 'Not uploaded'}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </>
        )}
      </Box>

      {captureDialogs}

      <Snackbar open={!!publishToast} autoHideDuration={4000} onClose={() => setPublishToast('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setPublishToast('')} sx={{ borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          {publishToast}
        </Alert>
      </Snackbar>
      <Snackbar open={!!errorToast} autoHideDuration={5000} onClose={() => setErrorToast('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setErrorToast('')} sx={{ borderRadius: '12px' }}>{errorToast}</Alert>
      </Snackbar>

      <ConfirmDialog
        open={deletePlanOpen}
        title="Delete floor plan?"
        description={`This removes the ${floor?.label ?? 'floor'} drawing and its capture points. You can upload a new plan afterward.`}
        confirmLabel="Delete Plan"
        destructive
        onCancel={() => setDeletePlanOpen(false)}
        onConfirm={() => {
          if (!floorPlan) { setDeletePlanOpen(false); return; }
          const planId = floorPlan.id;
          setDeletePlanOpen(false);
          deleteFloorPlan(planId);
          navigate(backDest);
        }}
      />

      {/* Annotate / edit: Flat + Room (with Others free-text) */}
      <Dialog
        open={!!pendingAnnotate || !!editingPinId}
        onClose={() => { setPendingAnnotate(null); setEditingPinId(null); }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '1.125rem', pb: 1 }}>
          {editingPinId ? 'Edit capture point' : 'Label capture point'}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.25, pt: '8px !important', pb: 1 }}>
          <Box>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, mb: 0.75 }}>
              Flat / Area
            </Typography>
            <Select
              fullWidth
              size="small"
              displayEmpty
              value={annotateFlat}
              onChange={(e) => {
                const flat = String(e.target.value);
                setAnnotateFlat(flat);
                const rooms = roomOptionsForFlat(flat);
                setAnnotateRoom(rooms[0] ?? '');
                setAnnotateCustomRoom('');
              }}
              sx={{ borderRadius: '10px', fontSize: '0.9375rem', fontWeight: 500 }}
              MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
            >
              {PREDEF_FLAT_OPTIONS.map(f => (
                <MenuItem key={f} value={f} sx={{ fontSize: '0.9375rem' }}>{f}</MenuItem>
              ))}
            </Select>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, mb: 0.75 }}>
              Room
            </Typography>
            <Select
              fullWidth
              size="small"
              displayEmpty
              value={
                annotateRoom === PREDEF_ROOM_OTHER || isCustomRoomName(annotateFlat, annotateRoom)
                  ? PREDEF_ROOM_OTHER
                  : annotateRoom
              }
              onChange={(e) => {
                const room = String(e.target.value);
                setAnnotateRoom(room);
                if (room !== PREDEF_ROOM_OTHER) setAnnotateCustomRoom('');
              }}
              sx={{ borderRadius: '10px', fontSize: '0.9375rem', fontWeight: 500 }}
              MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
            >
              {roomOptionsForFlat(annotateFlat).map(r => (
                <MenuItem key={r} value={r} sx={{ fontSize: '0.9375rem' }}>{r}</MenuItem>
              ))}
            </Select>
          </Box>
          {(annotateRoom === PREDEF_ROOM_OTHER || isCustomRoomName(annotateFlat, annotateRoom)) && (
            <Box>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, mb: 0.75 }}>
                Custom room name
              </Typography>
              <TextField
                size="small"
                fullWidth
                placeholder="Type room name"
                value={annotateCustomRoom}
                onChange={(e) => setAnnotateCustomRoom(e.target.value)}
                autoFocus
                inputProps={{ style: { fontSize: '0.9375rem' } }}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
          <Button onClick={() => { setPendingAnnotate(null); setEditingPinId(null); }} sx={{ textTransform: 'none', fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', px: 2 }}
            disabled={
              !annotateFlat
              || !(annotateRoom === PREDEF_ROOM_OTHER ? annotateCustomRoom.trim() : annotateRoom)
              || (!pendingAnnotate && !editingPinId)
              || !floorPlan
            }
            onClick={() => {
              const resolvedRoom = annotateRoom === PREDEF_ROOM_OTHER
                ? annotateCustomRoom.trim()
                : annotateRoom.trim();
              if (!resolvedRoom || !floorPlan || !floor || !tower || !project) return;

              if (editingPinId) {
                updateCapturePinLocal(editingPinId, {
                  flatName: annotateFlat,
                  roomName: resolvedRoom,
                  label: resolvedRoom,
                  isPredefined: true,
                  source: 'predefined',
                });
                setEditingPinId(null);
                setPublishToast(`Updated ${annotateFlat} · ${resolvedRoom}`);
                return;
              }

              if (!pendingAnnotate) return;
              if (!pinsVisible) setFloorPlanPinsVisible(floorPlan.id, true);
              const pinId = createCapturePin({
                floorPlanId: floorPlan.id,
                floorId: floor.id,
                towerId: tower.id,
                projectId: project.id,
                x: pendingAnnotate.x,
                y: pendingAnnotate.y,
                flatName: annotateFlat,
                roomName: resolvedRoom,
                label: resolvedRoom,
                isPredefined: true,
                source: 'predefined',
              });
              setPendingAnnotate(null);
              setSelectedPinId(pinId);
              setPublishToast(`${annotateFlat} · ${resolvedRoom}`);
            }}
          >
            {editingPinId ? 'Save' : 'Save point'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Import annotations from another annotated floor in the same tower */}
      <Dialog
        open={copyOpen}
        onClose={() => { if (!copyImporting) setCopyOpen(false); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800, fontSize: '1.05rem', pb: 0.5 }}>Import annotations</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1.5 }}>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>
            Choose an annotated floor plan. Its capture points will be copied here with the same coordinates and Flat · Room names.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 360, overflowY: 'auto', pr: 0.5 }}>
            {siblingFloorsWithPins.map(f => {
              const labeledPins = allPins.filter(p => p.floorId === f.id && p.flatName && p.roomName);
              const plan = getFloorPlanByFloor(floorPlans, towerId ?? '', f.id) as
                | (ReturnType<typeof getFloorPlanByFloor> & Record<string, unknown>)
                | undefined;
              const thumbUrl = plan
                ? ((plan as any).fileUrl ?? (plan as any).file_url
                  ?? ((plan as any).mediaAssets as any)?.[0]?.original_url
                  ?? ((plan as any).mediaAssets as any)?.[0]?.thumbnail_url
                  ?? null)
                : null;
              const previewNames = labeledPins
                .slice(0, 3)
                .map(p => `${p.flatName} · ${p.roomName}`)
                .join(', ');
              const selected = copySourceFloorId === f.id;
              return (
                <Box
                  key={f.id}
                  onClick={() => setCopySourceFloorId(f.id)}
                  sx={{
                    display: 'flex', gap: 1.25, alignItems: 'stretch',
                    p: 1, borderRadius: '12px', cursor: 'pointer',
                    border: `1.5px solid ${selected ? P.blue : P.border}`,
                    backgroundColor: selected ? P.blueSoft : P.white,
                    transition: T,
                    '&:hover': { borderColor: P.blue },
                  }}
                >
                  <Box sx={{
                    width: 72, height: 56, flexShrink: 0, borderRadius: '8px', overflow: 'hidden',
                    backgroundColor: P.bg, border: `1px solid ${P.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {thumbUrl ? (
                      <Box component="img" src={thumbUrl} alt={f.label} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <MapRounded sx={{ fontSize: 22, color: P.subtle }} />
                    )}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.25 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                      <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong }}>{f.label}</Typography>
                      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: selected ? P.blue : P.muted, flexShrink: 0 }}>
                        {labeledPins.length} point{labeledPins.length === 1 ? '' : 's'}
                      </Typography>
                    </Box>
                    <Typography noWrap sx={{ fontSize: '0.75rem', color: P.muted }}>
                      {previewNames}{labeledPins.length > 3 ? '…' : ''}
                    </Typography>
                  </Box>
                  {selected && <CheckRounded sx={{ fontSize: 18, color: P.blue, alignSelf: 'center', flexShrink: 0 }} />}
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCopyOpen(false)} disabled={copyImporting}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!copySourceFloorId || !floorId || !floorPlan || copyImporting}
            onClick={async () => {
              if (!floorId || !floorPlan || !copySourceFloorId) return;
              setCopyImporting(true);
              try {
                // Prefer the floor-plan record that actually owns the labeled pins
                // (re-uploads leave annotations on older plans).
                const sourcePins = allPins.filter(
                  p => p.floorId === copySourceFloorId && p.flatName && p.roomName,
                );
                const sourcePlanCounts = new Map<string, number>();
                for (const p of sourcePins) {
                  if (!p.floorPlanId) continue;
                  sourcePlanCounts.set(p.floorPlanId, (sourcePlanCounts.get(p.floorPlanId) ?? 0) + 1);
                }
                let sourceFloorPlanId: string | undefined;
                let best = 0;
                for (const [id, count] of sourcePlanCounts) {
                  if (count > best) { best = count; sourceFloorPlanId = id; }
                }

                const n = await copyPinsFromFloor({
                  targetFloorId: floorId,
                  sourceFloorId: copySourceFloorId,
                  targetFloorPlanId: floorPlan.id,
                  sourceFloorPlanId,
                });
                setCopyOpen(false);
                setAnnotateMode(true);
                setCaptureMode(false);
                setFloorPlanPinsVisible(floorPlan.id, true);
                setPublishToast(`Imported ${n} annotation${n === 1 ? '' : 's'}`);
              } catch (err) {
                if (err instanceof Error && err.message) {
                  setErrorToast(err.message);
                } else {
                  setErrorToast(normaliseError(err).message);
                }
              } finally {
                setCopyImporting(false);
              }
            }}
          >
            {copyImporting ? 'Importing…' : 'Import'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!errorToast} autoHideDuration={6000} onClose={() => setErrorToast('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" variant="filled" onClose={() => setErrorToast('')} sx={{ borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          {errorToast}
        </Alert>
      </Snackbar>
    </Box>
  );
}
