import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip, useMediaQuery, useTheme, Drawer, Snackbar, Alert } from '@mui/material';
import {
  ArrowBackRounded, ZoomInRounded, ZoomOutRounded, FullscreenRounded,
  FullscreenExitRounded, CenterFocusStrongRounded, UploadFileRounded,
  LayersRounded, RoomRounded, CameraAltRounded, ViewInArRounded, ArrowForwardRounded,
  CloudOffRounded, KeyboardArrowDownRounded, AddLocationAltRounded, CheckRounded,
  PublishRounded,
} from '@mui/icons-material';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isFieldEngineer } from '@store/authStore';
import { getFloorPlanByFloor, getFloorsByTower, getCapturePinsByFloorPlan } from '@store/workflowSelectors';
import type { MockRoomMarker } from '@/data/mockData';
import type { WfCapturePin } from '@store/workflowStore';
import { useDeviceType, usesCameraCapture } from '@/hooks/useDeviceType';
import { uploadCaptureFiles } from '@/services/uploadService';
import CapturePinMarker from '@features/capturePins/CapturePinMarker';
import PinActionPanel from '@features/capturePins/PinActionPanel';
import CameraCaptureDialog from '@features/capturePins/CameraCaptureDialog';
import PinUploadDialog from '@features/capturePins/PinUploadDialog';

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

  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const device   = useDeviceType();
  const useCamera = usesCameraCapture(device);

  const user       = useAuthStore(s => s.user);
  const isEngineer = isFieldEngineer(user);

  const project    = useWorkflowStore(s => s.projects.find(p => p.id === projectId));
  const tower      = useWorkflowStore(s => s.towers.find(t => t.id === towerId));
  const floors     = useWorkflowStore(s => s.floors);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const allPins    = useWorkflowStore(s => s.capturePins);
  const captures   = useWorkflowStore(s => s.captures);
  const createCapturePin     = useWorkflowStore(s => s.createCapturePin);
  const attachCaptureToPin   = useWorkflowStore(s => s.attachCaptureToPin);
  const deleteCapturePin     = useWorkflowStore(s => s.deleteCapturePin);
  const publishFloorPlanTour = useWorkflowStore(s => s.publishFloorPlanTour);

  const towerFloors = [...getFloorsByTower(floors, towerId ?? '')].sort((a, b) => a.number - b.number);
  const floor       = towerFloors.find(f => f.id === floorId);
  const floorPlan   = getFloorPlanByFloor(floorPlans, towerId ?? '', floorId ?? '');
  const pins        = floorPlan ? getCapturePinsByFloorPlan(allPins, floorPlan.id) : [];

  // Pin-based capture workflow is the field engineer's job.
  const canUsePins = isEngineer && !!floorPlan;

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
  const isPdf = fileFormat === 'pdf' || (imageUrl?.toLowerCase().includes('.pdf') ?? false);

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
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [activePin, setActivePin]         = useState<WfCapturePin | null>(null); // pin being captured
  const [publishToast, setPublishToast]   = useState('');
  const selectedPin = pins.find(p => p.id === selectedPinId) ?? null;
  const pinsWithCaptures = pins.filter(p => p.captureIds.length > 0).length;

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
  const viewerRef       = useRef<HTMLDivElement>(null);
  const pdfDocRef       = useRef<PdfDoc | null>(null);
  const renderingRef    = useRef(false);
  const lastRenderScale = useRef(0);

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

  /* ── pointer drag ───────────────────────────────────────────────────── */
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      draggingRef.current = true;
      movedRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const nx = dragStartRef.current.ox + e.clientX - dragStartRef.current.x;
      const ny = dragStartRef.current.oy + e.clientY - dragStartRef.current.y;
      // Mark as a real pan only past a small threshold so a tiny jitter on a tap
      // still counts as a click (and places a pin in capture mode).
      if (Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y) > 4) {
        movedRef.current = true;
      }
      setOffset({ x: nx, y: ny });
      offsetRef.current = { x: nx, y: ny };
    };
    const onUp = () => { draggingRef.current = false; setIsDragging(false); };
    const onDownVis = () => setIsDragging(true);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup',   onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerdown', onDownVis);
    el.addEventListener('pointerup',   onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup',   onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerdown', onDownVis);
      el.removeEventListener('pointerup',   onUp);
    };
  }, [fullscreen]);

  /* ── Ctrl+Wheel zoom ────────────────────────────────────────────────── */
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.12 : -0.12;
      const next  = Math.min(20, Math.max(0.05, scaleRef.current + delta));
      const rect  = el.getBoundingClientRect();
      const mx    = e.clientX - rect.left;
      const my    = e.clientY - rect.top;
      const ratio = next / scaleRef.current;
      const nx    = mx - ratio * (mx - offsetRef.current.x);
      const ny    = my - ratio * (my - offsetRef.current.y);
      scaleRef.current  = next;
      offsetRef.current = { x: nx, y: ny };
      setScale(next);
      setOffset({ x: nx, y: ny });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fullscreen]);

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
  const handlePlacePin = useCallback((e: React.MouseEvent<SVGElement>) => {
    if (!captureMode || !floorPlan || !pageSize.w) return;
    // A pan (drag that moved) ends in a click — don't drop a pin at the release point.
    if (movedRef.current) { movedRef.current = false; return; }
    // A click that landed on an existing pin selects/captures it — don't also
    // drop a new pin underneath it. (pointer stopPropagation doesn't stop the
    // synthesized click event, so we filter on the target here.)
    if ((e.target as Element).closest?.('#layer-captures')) return;
    const el = viewerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pageX = (mx - offsetRef.current.x) / scaleRef.current;
    const pageY = (my - offsetRef.current.y) / scaleRef.current;
    // Ignore clicks outside the floor-plan sheet.
    if (pageX < 0 || pageY < 0 || pageX > pageSize.w || pageY > pageSize.h) return;
    const xPct = (pageX / pageSize.w) * 100;
    const yPct = (pageY / pageSize.h) * 100;
    const pinId = createCapturePin({
      floorPlanId: floorPlan.id,
      floorId: floor!.id,
      towerId: tower!.id,
      projectId: project!.id,
      x: xPct, y: yPct,
    });
    setSelectedPinId(pinId);
  }, [captureMode, floorPlan, pageSize.w, pageSize.h, createCapturePin, floor, tower, project]);

  /* ── Begin capture for a pin (long-press or panel button) ───────────── */
  const beginCapture = useCallback((pin: WfCapturePin) => {
    setSelectedPinId(pin.id);
    setActivePin(pin);
  }, []);

  /* ── Perform the upload via the EXISTING pipeline, attach to pin ────── */
  const performAttach = useCallback(async (files: File[]) => {
    if (!activePin) return;
    const result = await uploadCaptureFiles(files);
    attachCaptureToPin(activePin.id, result.count || files.length, result.files);
  }, [activePin, attachCaptureToPin]);

  /* ── Publish the pin-ordered walkthrough ────────────────────────────── */
  const handlePublishWalkthrough = useCallback(() => {
    if (!floorPlan) return;
    const tourIds = publishFloorPlanTour(floorPlan.id);
    setPublishToast(tourIds.length
      ? `Published walkthrough · ${tourIds.length} tour${tourIds.length !== 1 ? 's' : ''} in pin order`
      : 'No pins with captures to publish yet');
  }, [floorPlan, publishFloorPlanTour]);

  if (!project || !tower || !floor) {
    return (
      <Box sx={{ p: 4 }}>
        <Box component={Link} to="/floor-plans" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: P.blue, textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
          <ArrowBackRounded sx={{ fontSize: 16 }} /> Back to Floor Plans
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
        height: fullscreen ? undefined : { xs: 260, sm: 400, md: 'calc(100vh - 280px)' },
        minHeight: { xs: 260, md: 480 },
        borderRadius: fullscreen ? 0 : '16px',
        overflow: 'hidden',
        backgroundColor: '#f1f3f7',
        backgroundImage: `radial-gradient(circle, #d1d5db 1px, transparent 1px)`,
        backgroundSize: '24px 24px',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* ── SVG viewer: single coordinate system for floor plan + all layers ── */}
      {renderedImageUrl && pageSize.w > 0 && (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', overflow: 'visible', cursor: captureMode ? 'crosshair' : undefined }}
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          preserveAspectRatio="none"
          onClick={handlePlacePin}
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

          {/* Layer 2: Capture pins — numbered walkthrough markers */}
          {pinsOnly && floorPlan && pins.length > 0 && (
            <g id="layer-captures">
              {pins.map(pin => (
                <CapturePinMarker
                  key={pin.id}
                  pin={pin}
                  pageW={pageSize.w}
                  pageH={pageSize.h}
                  scale={scale}
                  selected={selectedPinId === pin.id}
                  onActivate={canUsePins ? beginCapture : () => setSelectedPinId(pin.id)}
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

      {/* Capture-mode hint banner */}
      {captureMode && (
        <Box sx={{ position: 'absolute', top: fullscreen ? 56 : 12, left: '50%', transform: 'translateX(-50%)', zIndex: 15, display: 'flex', alignItems: 'center', gap: 0.875, px: 1.75, py: 0.875, borderRadius: '10px', backgroundColor: 'rgba(37,99,235,0.95)', backdropFilter: 'blur(8px)', boxShadow: '0 4px 16px rgba(37,99,235,0.35)', pointerEvents: 'none', maxWidth: '90%' }}>
          <AddLocationAltRounded sx={{ fontSize: 16, color: '#fff', flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff', lineHeight: 1.3 }}>
            Tap the plan to place pin {pins.length + 1} · {useCamera ? 'long-press a pin to open the camera' : 'long-press a pin to upload'}
          </Typography>
        </Box>
      )}

      {/* Controls */}
      <Box sx={{ position: 'absolute', top: fullscreen ? 56 : 12, left: 12, display: 'flex', flexDirection: 'column', gap: 0.625, zIndex: 10 }}>
        <CtrlBtn title="Zoom in" small={isMobile} onClick={() => {
          const n = Math.min(20, scaleRef.current + 0.25);
          const cx = (viewerRef.current?.clientWidth ?? 0) / 2;
          const cy = (viewerRef.current?.clientHeight ?? 0) / 2;
          const r = n / scaleRef.current;
          scaleRef.current = n; setScale(n);
          setOffset(o => { const nx = cx - r*(cx-o.x); const ny = cy - r*(cy-o.y); offsetRef.current={x:nx,y:ny}; return {x:nx,y:ny}; });
        }}><ZoomInRounded sx={{ fontSize: isMobile ? 15 : 17 }} /></CtrlBtn>
        <CtrlBtn title="Zoom out" small={isMobile} onClick={() => {
          const n = Math.max(0.05, scaleRef.current - 0.25);
          const cx = (viewerRef.current?.clientWidth ?? 0) / 2;
          const cy = (viewerRef.current?.clientHeight ?? 0) / 2;
          const r = n / scaleRef.current;
          scaleRef.current = n; setScale(n);
          setOffset(o => { const nx = cx - r*(cx-o.x); const ny = cy - r*(cy-o.y); offsetRef.current={x:nx,y:ny}; return {x:nx,y:ny}; });
        }}><ZoomOutRounded sx={{ fontSize: isMobile ? 15 : 17 }} /></CtrlBtn>
        <CtrlBtn title="Fit to screen" small={isMobile} onClick={centerImage}><CenterFocusStrongRounded sx={{ fontSize: isMobile ? 15 : 17 }} /></CtrlBtn>
        <CtrlBtn title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} small={isMobile} onClick={() => setFullscreen(f => !f)}>
          {fullscreen ? <FullscreenExitRounded sx={{ fontSize: isMobile ? 15 : 17 }} /> : <FullscreenRounded sx={{ fontSize: isMobile ? 15 : 17 }} />}
        </CtrlBtn>
      </Box>

      {/* Fullscreen back button */}
      {fullscreen && (
        <Box
          onClick={() => setFullscreen(false)}
          onPointerDown={e => e.stopPropagation()}
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

      {selectedPin && (
        <PinActionPanel
          pin={selectedPin}
          captures={captures}
          isMobile={isMobile}
          canCapture={canUsePins}
          usesCamera={useCamera}
          onCapture={beginCapture}
          onDelete={p => { deleteCapturePin(p.id); setSelectedPinId(null); }}
          onClose={() => setSelectedPinId(null)}
        />
      )}
    </Box>
  );

  /* ── capture dialogs (shared across normal + fullscreen) ───────────── */
  const captureDialogs = activePin && (
    useCamera ? (
      <CameraCaptureDialog
        open={!!activePin}
        pinLabel={`Pin ${activePin.sequenceNumber}`}
        onCapture={file => performAttach([file])}
        onClose={() => setActivePin(null)}
      />
    ) : (
      <PinUploadDialog
        open={!!activePin}
        pinLabel={`Pin ${activePin.sequenceNumber}`}
        onUpload={performAttach}
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
      pb: 6,
      opacity: fadeIn ? 1 : 0,
      transform: fadeIn ? 'translateY(0)' : 'translateY(6px)',
      transition: 'opacity 220ms ease, transform 220ms ease',
    }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0, flex: 1 }}>
          <Box component={Link} to={returnTo ? returnTo : (pinsOnly ? (isEngineer ? '/my-captures' : '/captures') : `/floor-plans?project=${projectId}&tower=${towerId}`)}
            sx={{ mt: 0.5, width: 32, height: 32, borderRadius: '9px', border: `1.5px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.muted, textDecoration: 'none', flexShrink: 0, transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } }}>
            <ArrowBackRounded sx={{ fontSize: 16 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.75rem', color: P.muted, mb: 0.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name} · {tower.name}</Typography>
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.125rem', sm: '1.625rem' }, fontWeight: 800, color: P.strong, letterSpacing: '-0.045em', lineHeight: 1.1 }}>
              {floor.label}{pinsOnly ? ' — Capture Pins' : ' — Floor Plan'}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {!isEngineer && !pinsOnly && (
            <Box component={Link} to={`/floor-plans/${projectId}/${towerId}/${floorId}/upload`}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: { xs: 0, sm: 0.75 },
                px: { xs: 0.875, sm: 1.75 }, py: 0.875,
                minWidth: { xs: 36, sm: 'auto' }, width: { xs: 36, sm: 'auto' }, height: { xs: 36, sm: 'auto' },
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
          )}
        </Box>
      </Box>

      {/* Legend strip */}
      {!pinsOnly && statusCounts && floorPlan && floorPlan.rooms.length > 0 && (
        <Box sx={{
          display: 'flex', gap: 1, mb: 2.5,
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
    </Box>
  );
}
