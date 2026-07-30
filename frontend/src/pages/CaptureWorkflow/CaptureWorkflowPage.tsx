import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography, Snackbar, Alert } from '@mui/material';
import {
  FolderRounded, DomainRounded, LayersRounded, PhotoCameraRounded,
  CheckCircleRounded, ArrowForwardRounded, ArrowBackRounded,
  CloudUploadRounded, AddLocationAltRounded, ZoomInRounded, ZoomOutRounded,
  CenterFocusStrongRounded, MyLocationRounded, FullscreenRounded, FullscreenExitRounded,
  AddAPhotoRounded, HistoryRounded, DeleteOutlineRounded, CloseRounded,
  CameraAltRounded,
} from '@mui/icons-material';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { getFloorPlanByFloor, getFloorsWithPlanByTower, countFloorsWithPlanByTower } from '@store/workflowSelectors';
import { uploadCaptureFiles } from '@/services/uploadService';
import {
  enqueueFileUpload, discardFileUpload, retryFileUpload, tryDirectUpload,
  fileUploadStatusForPin, allQueuedPinStatuses, FILE_QUEUE_CHANGED_EVENT, FILE_UPLOAD_SUCCEEDED_EVENT,
} from '@store/fileUploadQueue';
import { useDeviceType, usesCameraCapture } from '@/hooks/useDeviceType';
import CameraCaptureDialog from '@/features/capturePins/CameraCaptureDialog';
import { Insta360Camera } from '@/plugins/insta360Camera';

/* ── palette ────────────────────────────────────────────────────────────── */
const P = {
  border:    '#e4e7ec',
  muted:     '#6b7280',
  subtle:    '#9ca3af',
  strong:    '#111827',
  blue:      '#2563eb',
  blueHover: '#1d4ed8',
  blueSoft:  'rgba(37,99,235,0.08)',
  blueRing:  'rgba(37,99,235,0.18)',
  red:       '#dc2626',
  white:     '#ffffff',
  bg:        '#f7f8fa',
  ink:       '#111318',
};
const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

type Step = 'project' | 'tower' | 'floor' | 'capture';
const STEPS: { key: Step; label: string; num: number }[] = [
  { key: 'project', label: 'Project', num: 1 },
  { key: 'tower',   label: 'Tower',   num: 2 },
  { key: 'floor',   label: 'Floor',   num: 3 },
  { key: 'capture', label: 'Capture', num: 4 },
];

/* ── Last-viewed capture location, persisted across an app restart ───────
   Landing back on the Overview after a force-close (very likely mid-capture,
   e.g. the offline-capture-then-kill flow this page's file queue exists for)
   meant re-selecting Project → Tower → Floor by hand every time before
   reaching the exact floor plan pins live on. Restored on mount ONLY if the
   referenced project/tower/floor still exist (see the validation effect
   below) — a stale reference (deleted/reassigned since) must fall back to a
   normal fresh start, not a broken restored selection. */
const LAST_CAPTURE_LOCATION_KEY = 'sitesurelabs-last-capture-location-v1';

interface LastCaptureLocation {
  step: Step;
  projectId: string;
  towerId: string;
  floorId: string;
}

function loadLastCaptureLocation(): LastCaptureLocation | null {
  try {
    const raw = localStorage.getItem(LAST_CAPTURE_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastCaptureLocation>;
    if (!parsed.step || !parsed.projectId) return null;
    return {
      step: parsed.step,
      projectId: parsed.projectId,
      towerId: parsed.towerId ?? '',
      floorId: parsed.floorId ?? '',
    };
  } catch {
    return null;
  }
}

function saveLastCaptureLocation(loc: LastCaptureLocation): void {
  try {
    localStorage.setItem(LAST_CAPTURE_LOCATION_KEY, JSON.stringify(loc));
  } catch {
    /* best-effort — losing this only means landing on Overview, not data loss */
  }
}

/* Which physical camera captures pins on this device — sticky per-device
   choice (an engineer either carries the Insta360 for a shoot or doesn't;
   re-prompting every pin would be busywork). The Insta360 X3's OSC WiFi AP
   advertises as "X3 <SERIAL>.OSC" (confirmed on-device: "X3 8TV8SF.OSC") —
   note the space after "X3", not an underscore. */
const CAMERA_SOURCE_KEY = 'sitesurelabs-camera-source-v1';
const INSTA360_SSID_PATTERN = 'X3 ';
// Insta360's factory-default WiFi password for the X3's own OSC AP (confirmed
// on-device) — not a per-device secret, so no need to prompt or persist it.
const INSTA360_WIFI_PASSWORD = '88888888';
type CameraSource = 'device' | 'insta360';

function loadCameraSource(): CameraSource {
  // The Insta360 is the only camera this workflow captures with now — the
  // in-app switch-to-phone-camera toggle was removed, but a device-only
  // record can still exist from before that decision, so an explicit
  // 'device' value is honored rather than silently overridden.
  try {
    return localStorage.getItem(CAMERA_SOURCE_KEY) === 'device' ? 'device' : 'insta360';
  } catch {
    return 'insta360';
  }
}

function saveCameraSource(source: CameraSource): void {
  try {
    localStorage.setItem(CAMERA_SOURCE_KEY, source);
  } catch {
    /* best-effort */
  }
}

/* ── Step indicator — clickable to go back ──────────────────────────────── */
function StepIndicator({
  current, selections, onStepClick,
}: {
  current: Step;
  selections: Partial<Record<Step, string>>;
  onStepClick: (step: Step) => void;
}) {
  const currentIdx = STEPS.findIndex(s => s.key === current);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', mb: { xs: 3, md: 4 } }}>
      {STEPS.map((s, i) => {
        const isDone   = i < currentIdx;
        const isActive = s.key === current;
        const canClick = isDone;
        return (
          <React.Fragment key={s.key}>
            <Box
              onClick={() => canClick && onStepClick(s.key)}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 0.5, minWidth: { xs: 48, sm: 64 },
                cursor: canClick ? 'pointer' : 'default',
              }}
            >
              <Box sx={{
                width: { xs: 32, sm: 38 }, height: { xs: 32, sm: 38 }, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: T,
                backgroundColor: isActive ? P.blue : isDone ? P.blueSoft : P.bg,
                border: `2px solid ${isActive ? P.blue : isDone ? P.blue : P.border}`,
                color: isActive ? P.white : isDone ? P.blue : P.subtle,
                boxShadow: isActive ? '0 4px 14px rgba(37,99,235,0.32)' : 'none',
                ...(canClick ? { '&:hover': { backgroundColor: P.blue, color: P.white, borderColor: P.blue } } : {}),
              }}>
                {isDone
                  ? <CheckCircleRounded sx={{ fontSize: { xs: 15, sm: 18 } }} />
                  : <Typography sx={{ fontSize: { xs: '0.6875rem', sm: '0.8125rem' }, fontWeight: 700 }}>{s.num}</Typography>}
              </Box>
              <Typography sx={{
                fontSize: { xs: '0.5rem', sm: '0.625rem' },
                fontWeight: isActive ? 700 : 500,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                color: isActive ? P.blue : isDone ? P.muted : P.subtle,
                maxWidth: { xs: 44, sm: 60 }, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center',
              }}>
                {isDone && selections[s.key] ? selections[s.key] : s.label}
              </Typography>
            </Box>
            {i < STEPS.length - 1 && (
              <Box sx={{ flex: 1, height: 2, mx: 0.5, mb: 3.5, borderRadius: 1, backgroundColor: isDone ? P.blue : P.border, transition: T }} />
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );
}

/* ── Context breadcrumb bar ──────────────────────────────────────────────── */
function ContextBar({ items }: { items: { label: string; value: string | undefined }[] }) {
  const visible = items.filter(i => i.value);
  if (!visible.length) return null;
  return (
    <Box sx={{ mb: 3, px: 2.5, py: 1.75, borderRadius: '12px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
      {visible.map((item, idx) => (
        <React.Fragment key={item.label}>
          {idx > 0 && <Box sx={{ mx: 1.5, color: P.subtle, fontSize: '0.75rem' }}>/</Box>}
          <Box>
            <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: P.subtle, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1 }}>{item.label}</Typography>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{item.value}</Typography>
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

/* ── Section heading ─────────────────────────────────────────────────────── */
function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.25rem', sm: '1.375rem' }, fontWeight: 800, color: P.strong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.5 }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>{sub}</Typography>
    </Box>
  );
}

/* ── Project card ────────────────────────────────────────────────────────── */
function ProjectCard({ name, location, gradient, accent, towers, onClick }: {
  name: string; location: string; gradient: string; accent: string; towers: number; onClick: () => void;
}) {
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', alignItems: 'center', gap: 2,
      px: { xs: 2, sm: 2.5 }, py: { xs: 1.75, sm: 2 }, borderRadius: '14px',
      border: `1.5px solid ${P.border}`, backgroundColor: P.white,
      cursor: 'pointer', transition: T,
      '&:hover': { borderColor: accent + '88', transform: 'translateY(-1px)', boxShadow: `0 6px 20px ${accent}14` },
      '&:hover .proj-arrow': { transform: 'translateX(3px)', color: accent },
    }}>
      <Box sx={{ width: { xs: 40, sm: 44 }, height: { xs: 40, sm: 44 }, borderRadius: '12px', background: gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 12px ${accent}28` }}>
        <FolderRounded sx={{ color: '#fff', fontSize: { xs: 19, sm: 22 } }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: { xs: '0.875rem', sm: '0.9375rem' }, fontWeight: 700, color: P.strong, letterSpacing: '-0.01em' }}>{name}</Typography>
        <Typography noWrap sx={{ fontSize: '0.8125rem', color: P.muted }}>{location}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: accent, mb: 0.25 }}>{towers} towers</Typography>
        <ArrowForwardRounded className="proj-arrow" sx={{ fontSize: 16, color: P.subtle, transition: T, display: 'block', ml: 'auto' }} />
      </Box>
    </Box>
  );
}

/* ── Tower card — 2-col grid tile ────────────────────────────────────────── */
function TowerCard({ name, floors, index, onClick }: { name: string; floors: number; index: number; onClick: () => void }) {
  const ACCENTS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];
  const accent  = ACCENTS[index % ACCENTS.length];
  return (
    <Box onClick={onClick} sx={{
      position: 'relative', overflow: 'hidden',
      px: 2, pt: 2.25, pb: 2,
      borderRadius: '16px', border: `1.5px solid ${P.border}`,
      backgroundColor: P.white, cursor: 'pointer', transition: T,
      '&:hover': {
        borderColor: `${accent}60`,
        transform: 'translateY(-3px)',
        boxShadow: `0 10px 28px ${accent}18`,
      },
      '&:hover .tw-icon-box': { background: accent, borderColor: accent },
      '&:hover .tw-icon': { color: '#fff' },
      '&:hover .tw-name': { color: accent },
    }}>
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${accent} 0%, ${accent}44 100%)`, borderRadius: '16px 16px 0 0' }} />
      <Box className="tw-icon-box" sx={{
        width: 40, height: 40, borderRadius: '11px', mb: 1.5,
        background: `${accent}14`, border: `1.5px solid ${accent}28`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: T,
      }}>
        <DomainRounded className="tw-icon" sx={{ fontSize: 20, color: accent, transition: T }} />
      </Box>
      <Typography className="tw-name" sx={{
        fontSize: '0.9375rem', fontWeight: 700, color: P.strong,
        letterSpacing: '-0.02em', lineHeight: 1.2, mb: 0.375, transition: T,
      }}>{name}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>{floors} floors</Typography>
        <Box sx={{ px: 0.875, py: 0.25, borderRadius: '6px', backgroundColor: `${accent}12` }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: accent }}>{floors}F</Typography>
        </Box>
      </Box>
    </Box>
  );
}

/* ── Floor card ───────────────────────────────────────────────────────────── */
function FloorCard({ label, number, onClick }: { label: string; number: number; onClick: () => void }) {
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 0.375, py: { xs: 1.75, sm: 2.25 }, px: 1, borderRadius: '14px',
      border: `1.5px solid ${P.border}`, backgroundColor: P.white,
      cursor: 'pointer', transition: T, textAlign: 'center',
      '&:hover': {
        borderColor: P.blue,
        backgroundColor: P.blueSoft,
        transform: 'translateY(-2px)',
        boxShadow: '0 6px 18px rgba(37,99,235,0.12)',
      },
      '&:hover .fl-num': { color: P.blue },
      '&:hover .fl-lbl': { color: P.blue },
    }}>
      <Box sx={{
        width: 34, height: 34, borderRadius: '10px', mb: 0.5,
        backgroundColor: P.bg, border: `1.5px solid ${P.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography className="fl-num" sx={{ fontSize: '0.875rem', fontWeight: 800, color: P.strong, letterSpacing: '-0.03em', transition: T, lineHeight: 1 }}>
          {number}
        </Typography>
      </Box>
      <Typography className="fl-lbl" sx={{ fontSize: { xs: '0.6875rem', sm: '0.75rem' }, fontWeight: 600, color: P.muted, transition: T, lineHeight: 1.1 }}>
        {label}
      </Typography>
    </Box>
  );
}

/* ── Persisted pin shape for rendering ──────────────────────────────────── */
// 'queued' = written to on-device storage, waiting for connectivity to
// actually upload (see fileUploadQueue.ts) — distinct from 'uploading' so the
// UI can tell "captured, will send later" apart from "sending right now".
type PinUploadStatus = 'queued' | 'uploading' | 'processing' | 'failed';

interface RenderPin {
  id: string;
  sequenceNumber: number;
  x: number;
  y: number;
  hasCapture: boolean;
  /** Optimistic-upload state: set while this pin's capture is uploading or after it failed. */
  status?: PinUploadStatus;
}

/* ── Floor plan viewer with pin, fullscreen, pinch-to-zoom ──────────────── */
function FloorPlanWithPin({
  floorPlan, pin, pins, onPinPlace, onPinClick, onPinActivate, isCaptureModeUI, onLongPressCapture,
}: {
  floorPlan: Record<string, unknown> | null;
  pin: { x: number; y: number } | null;
  pins: RenderPin[];
  onPinPlace: (x: number, y: number) => void;
  onPinClick: (pinId: string) => void;
  onPinActivate: (pinId: string) => void;
  isCaptureModeUI?: boolean;
  /** When set, holding a press on empty floor-plan space for ~500ms places a
   *  pin AND immediately triggers a capture at that spot — skipping the
   *  separate tap-then-Take-Picture step. Only wired up for the Insta360
   *  source (see CaptureWorkflowPage's cameraSource), since the phone-camera
   *  path still needs a live preview to compose the shot. */
  onLongPressCapture?: (x: number, y: number) => void;
}) {
  const [scale, setScale]       = useState(1);
  const [offset, setOffset]     = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const dragStart  = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imgWrapRef   = useRef<HTMLDivElement>(null);

  // Touch / pinch state
  const touchesRef      = useRef<React.Touch[]>([]);
  const pinchStartRef   = useRef<{ dist: number; scale: number; midX: number; midY: number } | null>(null);
  const touchDragStart  = useRef({ ox: 0, oy: 0, mx: 0, my: 0 });
  const touchMovedRef   = useRef(false);

  // Double-tap zoom on empty floor plan space
  const lastTapRef = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 });

  // Long-press-to-capture (Insta360 fast-capture flow — see onLongPressCapture prop).
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE = 10; // px — cancels the hold if it turns into a pan
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);

  function clientToPlanPercent(clientX: number, clientY: number): { x: number; y: number } | null {
    const wrap = imgWrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    if (x < 0 || y < 0 || x > 100 || y > 100) return null;
    return { x, y };
  }

  function cancelLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }

  function armLongPress(clientX: number, clientY: number) {
    if (!onLongPressCapture) return;
    cancelLongPress();
    longPressFiredRef.current = false;
    longPressStartRef.current = { x: clientX, y: clientY };
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      const start = longPressStartRef.current;
      longPressStartRef.current = null;
      if (!start) return;
      const pos = clientToPlanPercent(clientX, clientY);
      if (!pos) return;
      longPressFiredRef.current = true;
      onLongPressCapture(pos.x, pos.y);
    }, LONG_PRESS_MS);
  }

  /** Cancels the pending long-press if the pointer has moved past the pan
   *  tolerance since the press started — called from the existing move
   *  handlers so a real pan/drag never turns into an accidental capture. */
  function maybeCancelLongPressOnMove(clientX: number, clientY: number) {
    const start = longPressStartRef.current;
    if (!start) return;
    const dist = Math.hypot(clientX - start.x, clientY - start.y);
    if (dist > LONG_PRESS_MOVE_TOLERANCE) cancelLongPress();
  }

  const clampOffset = useCallback((ox: number, oy: number, s: number) => {
    const el = containerRef.current;
    const wrap = imgWrapRef.current;
    if (!el || !wrap) return { x: ox, y: oy };
    const { width: cw, height: ch } = el.getBoundingClientRect();
    // wrap.getBoundingClientRect() already reflects the live container scale, so
    // normalise back to the image's natural size, then apply the TARGET scale s.
    const { width: iw, height: ih } = wrap.getBoundingClientRect();
    const naturalW = iw / scale;
    const naturalH = ih / scale;
    const scaledW = naturalW * s;
    const scaledH = naturalH * s;
    // Keep at least 80px of the plan on screen on each axis.
    const margin = 80;
    const maxX = Math.max(0, (scaledW - cw) / 2 + (cw / 2 - margin));
    const maxY = Math.max(0, (scaledH - ch) / 2 + (ch / 2 - margin));
    return {
      x: Math.max(-maxX, Math.min(maxX, ox)),
      y: Math.max(-maxY, Math.min(maxY, oy)),
    };
  }, [scale]);

  const zoom = useCallback((dir: 1 | -1) => {
    setScale(s => {
      const next = Math.min(6, Math.max(0.5, +(s + dir * 0.3).toFixed(2)));
      setOffset(o => clampOffset(o.x, o.y, next));
      return next;
    });
  }, [clampOffset]);

  const resetView = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

  // ── Ctrl/⌘ + scroll wheel zoom (desktop), zooming toward the cursor ───────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain scroll = let the page scroll
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      // Cursor position relative to the container centre (the transform origin).
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      setScale(prev => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = Math.min(6, Math.max(0.5, +(prev * factor).toFixed(3)));
        const ratio = next / prev;
        // Keep the point under the cursor stationary while zooming.
        setOffset(o => clampOffset(cx - ratio * (cx - o.x), cy - ratio * (cy - o.y), next));
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clampOffset]);

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  // ── Mouse pan (desktop) ─────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest?.('[data-pin-id]')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    armLongPress(e.clientX, e.clientY);
  }
  function onMouseMove(e: React.MouseEvent) {
    maybeCancelLongPressOnMove(e.clientX, e.clientY);
    if (!isDragging) return;
    setOffset(clampOffset(dragStart.current.ox + e.clientX - dragStart.current.x, dragStart.current.oy + e.clientY - dragStart.current.y, scale));
  }
  function onMouseUp() { setIsDragging(false); cancelLongPress(); }

  // ── Desktop click → place pin ───────────────────────────────────────────
  function onCanvasClick(e: React.MouseEvent) {
    if (isDragging) return;
    if ((e.target as Element).closest?.('[data-pin-id]')) return;
    // Long-press already placed + captured this exact press — don't also
    // fire the ordinary tap-to-place-pending-pin behavior for the same click.
    if (longPressFiredRef.current) { longPressFiredRef.current = false; return; }
    const wrap = imgWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    if (x < 0 || y < 0 || x > 100 || y > 100) return;
    onPinPlace(x, y);
  }

  // ── Touch handlers (pan, pinch-zoom, double-tap zoom, tap-to-place) ─────
  function getTouchDist(t1: React.Touch, t2: React.Touch) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }
  function getTouchMid(t1: React.Touch, t2: React.Touch) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }

  function onTouchStart(e: React.TouchEvent) {
    // Don't prevent default on pin elements — they need their pointer events.
    if ((e.target as Element).closest?.('[data-pin-id]')) return;
    touchMovedRef.current = false;
    touchesRef.current = Array.from(e.touches) as unknown as React.Touch[];

    if (e.touches.length === 2) {
      cancelLongPress(); // a second finger means pinch-zoom, never a long-press
      const [t1, t2] = [e.touches[0], e.touches[1]] as unknown as [React.Touch, React.Touch];
      pinchStartRef.current = { dist: getTouchDist(t1, t2), scale, midX: getTouchMid(t1, t2).x, midY: getTouchMid(t1, t2).y };
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      touchDragStart.current = { ox: offset.x, oy: offset.y, mx: t.clientX, my: t.clientY };
      armLongPress(t.clientX, t.clientY);
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if ((e.target as Element).closest?.('[data-pin-id]')) return;
    touchMovedRef.current = true;

    if (e.touches.length === 2 && pinchStartRef.current) {
      cancelLongPress();
      const [t1, t2] = [e.touches[0], e.touches[1]] as unknown as [React.Touch, React.Touch];
      const newDist = getTouchDist(t1, t2);
      const rawScale = (newDist / pinchStartRef.current.dist) * pinchStartRef.current.scale;
      const newScale = Math.min(6, Math.max(0.5, +rawScale.toFixed(3)));
      // Pan so the pinch midpoint tracks the fingers, then clamp so the plan
      // can't slip off-screen.
      const { midX, midY } = pinchStartRef.current;
      const mid = getTouchMid(t1, t2);
      setScale(newScale);
      setOffset(prev => clampOffset(prev.x + (mid.x - midX) * 0.4, prev.y + (mid.y - midY) * 0.4, newScale));
    } else if (e.touches.length === 1 && !pinchStartRef.current) {
      const t = e.touches[0];
      maybeCancelLongPressOnMove(t.clientX, t.clientY);
      const dx = t.clientX - touchDragStart.current.mx;
      const dy = t.clientY - touchDragStart.current.my;
      setOffset(clampOffset(touchDragStart.current.ox + dx, touchDragStart.current.oy + dy, scale));
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if ((e.target as Element).closest?.('[data-pin-id]')) return;

    cancelLongPress();
    if (e.touches.length < 2) pinchStartRef.current = null;

    // Double-tap to zoom in/out on empty floor plan space
    if (e.changedTouches.length === 1 && !touchMovedRef.current) {
      const t = e.changedTouches[0];
      const now = performance.now();
      const last = lastTapRef.current;
      const elapsed = now - last.t;
      const dist = Math.hypot(t.clientX - last.x, t.clientY - last.y);

      if (elapsed < 300 && dist < 40) {
        // Double tap — zoom in if near 1×, zoom out if zoomed in
        if (scale < 1.4) {
          const target = 2.5;
          setScale(target);
          // Center on the tap point
          const wrap = imgWrapRef.current;
          if (wrap) {
            const rect = wrap.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            setOffset(clampOffset(-(t.clientX - cx) * 0.8, -(t.clientY - cy) * 0.8, target));
          }
        } else {
          resetView();
        }
        lastTapRef.current = { t: 0, x: 0, y: 0 };
      } else {
        lastTapRef.current = { t: now, x: t.clientX, y: t.clientY };
      }
      return;
    }
  }

  function onTouchCancel() {
    cancelLongPress();
    pinchStartRef.current = null;
    touchMovedRef.current = false;
  }

  // ── Touch tap on pin → place pin if nothing selected ────────────────────
  function onTouchPinPlace(e: React.TouchEvent) {
    // Long-press already placed + captured this exact press — don't also
    // fire the ordinary tap-to-place-pending-pin behavior for the same touch.
    if (longPressFiredRef.current) { longPressFiredRef.current = false; return; }
    if (touchMovedRef.current) return;
    if ((e.target as Element).closest?.('[data-pin-id]')) return;
    if (e.changedTouches.length !== 1) return;

    const wrap = imgWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const t = e.changedTouches[0];
    const x = ((t.clientX - rect.left) / rect.width) * 100;
    const y = ((t.clientY - rect.top) / rect.height) * 100;
    if (x < 0 || y < 0 || x > 100 || y > 100) return;
    onPinPlace(x, y);
  }

  const imageUrl = floorPlan
    ? ((floorPlan as any).fileUrl ?? (floorPlan as any).file_url ?? ((floorPlan as any).mediaAssets as any)?.[0]?.original_url ?? null)
    : null;

  const controls = (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {[
        { icon: <ZoomInRounded sx={{ fontSize: 15 }} />, fn: () => zoom(1) },
        { icon: <ZoomOutRounded sx={{ fontSize: 15 }} />, fn: () => zoom(-1) },
        { icon: <CenterFocusStrongRounded sx={{ fontSize: 15 }} />, fn: resetView },
        ...(isCaptureModeUI ? [] : [{ icon: fullscreen ? <FullscreenExitRounded sx={{ fontSize: 15 }} /> : <FullscreenRounded sx={{ fontSize: 15 }} />, fn: () => setFullscreen(f => !f) }]),
      ].map((b, i) => (
        <Box key={i} onClick={(e) => { e.stopPropagation(); b.fn(); }} sx={{ width: 28, height: 28, borderRadius: '7px', backgroundColor: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', transition: T, '&:hover': { backgroundColor: 'rgba(37,99,235,0.7)' } }}>
          {b.icon}
        </Box>
      ))}
    </Box>
  );

  const isBorderless = fullscreen || isCaptureModeUI;
  const viewer = (
    <Box sx={{
      borderRadius: isBorderless ? 0 : '18px', overflow: 'hidden',
      border: isBorderless ? 'none' : `1.5px solid ${P.border}`,
      backgroundColor: '#0f172a', position: 'relative',
      width: '100%', height: '100%',
      boxShadow: isBorderless ? 'none' : '0 8px 32px rgba(15,23,42,0.16)',
    }}>
      {/* Top bar */}
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, px: 2, py: 1.25, background: 'linear-gradient(180deg,rgba(10,12,20,0.92) 0%,transparent 100%)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {fullscreen && !isCaptureModeUI && (
            <Box onClick={() => setFullscreen(false)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, mr: 1.5, px: 1.25, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', cursor: 'pointer', color: 'rgba(255,255,255,0.85)', fontSize: '0.8125rem', fontWeight: 600, transition: T, '&:hover': { backgroundColor: 'rgba(255,255,255,0.15)' } }}>
              <ArrowBackRounded sx={{ fontSize: 14 }} /> Back
            </Box>
          )}
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: pin ? '#22c55e' : '#f59e0b', boxShadow: pin ? '0 0 6px #22c55e' : '0 0 6px #f59e0b', flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.95)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {pin ? 'Point placed' : onLongPressCapture ? 'Hold to capture' : 'Tap to drop pin'}
          </Typography>
        </Box>
        {controls}
      </Box>

      {/* Canvas */}
      <Box
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={onCanvasClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={(e) => { onTouchEnd(e); onTouchPinPlace(e); }}
        onTouchCancel={onTouchCancel}
        sx={{
          width: '100%', height: '100%', overflow: 'hidden',
          cursor: isDragging ? 'grabbing' : 'crosshair',
          position: 'relative', userSelect: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'none',
        }}
      >
        <Box sx={{
          transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`,
          transition: isDragging ? 'none' : 'transform 0.1s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          maxWidth: '100%', maxHeight: '100%',
        }}>
          {imageUrl ? (
            <Box ref={imgWrapRef} sx={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
              <Box component="img" src={imageUrl} alt="Floor plan" draggable={false}
                sx={{ display: 'block', maxWidth: '88vw', maxHeight: { xs: '48vh', sm: '70vh' }, width: 'auto', height: 'auto' }} />

              {/* Persisted, numbered pins */}
              {pins.map(p => {
                // 'processing' must outrank hasCapture: the capture IS attached
                // while the panorama is still stitching server-side, so keying
                // purely off hasCapture would show a finished-looking green pin
                // for a capture that isn't viewable yet.
                const color = p.status === 'failed'
                  ? '#dc2626'
                  : p.status === 'processing' || p.status === 'uploading'
                    ? '#d97706'
                    : p.hasCapture ? '#16a34a' : '#d97706';
                return (
                  <Box
                    key={p.id}
                    // Purely positional — NOT the click target. This box inherits the
                    // ancestor's zoom `scale()`, so its own layout box (and therefore
                    // its hit-test region) grows with zoom even though the marker drawn
                    // inside it is counter-scaled back to a constant visual size. Putting
                    // the click handler / data-pin-id here made the clickable area grow
                    // with zoom while the visible pin stayed small — clicks far from a
                    // zoomed-in pin were still landing on it. The listener now lives on
                    // the counter-scaled child below, whose hit box tracks its paint size.
                    sx={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%,-100%)', zIndex: 5, pointerEvents: 'none' }}
                  >
                    {/* Counter-scale so the marker AND its clickable hit-box both stay a
                        constant on-screen size regardless of zoom (anchored at the tip). */}
                    <Box
                      data-pin-id={p.id}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        onPinClick(p.id);
                      }}
                      sx={{ transform: `scale(${1 / scale})`, transformOrigin: 'bottom center', cursor: 'pointer', pointerEvents: 'auto', touchAction: 'none' }}
                    >
                      <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.5))', transition: T, opacity: p.status === 'uploading' || p.status === 'processing' ? 0.85 : 1, '&:hover': { transform: 'scale(1.08)' } }}>
                        <Box sx={{ width: { xs: 20, sm: 30 }, height: { xs: 20, sm: 30 }, borderRadius: '50% 50% 50% 0', backgroundColor: color, border: { xs: '2px solid #fff', sm: '3px solid #fff' }, transform: 'rotate(-45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Typography sx={{ fontSize: { xs: '0.625rem', sm: '0.8125rem' }, fontWeight: 800, color: '#fff', transform: 'rotate(45deg)', lineHeight: 1 }}>{p.sequenceNumber}</Typography>
                        </Box>
                        <Box sx={{ width: 2, height: { xs: 4, sm: 6 }, backgroundColor: color, mt: '-1px' }} />
                        {/* Upload-in-progress / background-stitch spinner badge */}
                        {(p.status === 'uploading' || p.status === 'processing') && (
                          <Box sx={{
                            position: 'absolute', top: -5, right: -7,
                            width: 13, height: 13, borderRadius: '50%',
                            border: '2px solid #fff', borderTopColor: 'transparent',
                            backgroundColor: P.blue,
                            animation: 'pinspin 0.8s linear infinite',
                            '@keyframes pinspin': { to: { transform: 'rotate(360deg)' } },
                          }} />
                        )}
                        {/* Upload-failed badge */}
                        {p.status === 'failed' && (
                          <Box sx={{
                            position: 'absolute', top: -6, right: -8,
                            width: 14, height: 14, borderRadius: '50%',
                            backgroundColor: '#dc2626', border: '2px solid #fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Typography sx={{ fontSize: '0.5625rem', fontWeight: 900, color: '#fff', lineHeight: 1 }}>!</Typography>
                          </Box>
                        )}
                      </Box>
                    </Box>
                  </Box>
                );
              })}

              {/* Pending pin */}
              {pin && (
                <Box sx={{ position: 'absolute', left: `${pin.x}%`, top: `${pin.y}%`, transform: 'translate(-50%,-100%)', pointerEvents: 'none', zIndex: 6 }}>
                  {/* Counter-scale so the pending pin stays a constant on-screen size. */}
                  <Box sx={{ transform: `scale(${1 / scale})`, transformOrigin: 'bottom center' }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.5))' }}>
                      <Box sx={{ width: { xs: 22, sm: 34 }, height: { xs: 22, sm: 34 }, borderRadius: '50% 50% 50% 0', backgroundColor: '#22c55e', border: { xs: '2px solid #fff', sm: '3px solid #fff' }, transform: 'rotate(-45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pinpulse 1.2s ease-in-out infinite', '@keyframes pinpulse': { '0%,100%': { boxShadow: '0 0 0 0 rgba(34,197,94,0.5)' }, '50%': { boxShadow: '0 0 0 5px rgba(34,197,94,0)' } } }}>
                        <MyLocationRounded sx={{ fontSize: { xs: 10, sm: 14 }, color: '#fff', transform: 'rotate(45deg)' }} />
                      </Box>
                      <Box sx={{ width: 2, height: { xs: 5, sm: 8 }, backgroundColor: '#22c55e', mt: '-1px' }} />
                      <Box sx={{ width: { xs: 4, sm: 5 }, height: { xs: 4, sm: 5 }, borderRadius: '50%', backgroundColor: '#22c55e', opacity: 0.4 }} />
                    </Box>
                  </Box>
                </Box>
              )}
            </Box>
          ) : (
            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ width: 64, height: 64, borderRadius: '18px', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <LayersRounded sx={{ fontSize: 32, color: 'rgba(255,255,255,0.18)' }} />
              </Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9375rem', fontWeight: 600 }}>No floor plan uploaded yet</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.22)', fontSize: '0.8125rem', textAlign: 'center', maxWidth: 260 }}>A floor plan is required to place capture pins.</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {!pin && !isCaptureModeUI && (
        <Box sx={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', px: 2, py: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)', borderRadius: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, width: 'max-content', maxWidth: '90%' }}>
          <AddLocationAltRounded sx={{ fontSize: 18, color: '#f59e0b' }} />
          <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.95)', fontWeight: 500, textAlign: 'center' }}>
            {onLongPressCapture ? 'Hold anywhere to place a pin and capture' : 'Tap anywhere to drop pin'}
          </Typography>
        </Box>
      )}

      {fullscreen && (
        <Box sx={{ position: 'absolute', bottom: 16, right: 16, px: 1.25, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
          <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500, letterSpacing: '0.02em' }}>Press Esc or Back to exit</Typography>
        </Box>
      )}
    </Box>
  );

  if (isCaptureModeUI) {
    return (
      <Box sx={{ width: '100%', height: '100%' }}>
        {viewer}
      </Box>
    );
  }
  if (!fullscreen) {
    return (
      <Box sx={{
        height: { xs: 'clamp(260px, 52vh, 380px)', sm: 'auto' },
        aspectRatio: { xs: 'unset', sm: '16/9' },
      }}>
        {viewer}
      </Box>
    );
  }
  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 1400, backgroundColor: '#0a0c14' }}>
      {viewer}
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════════════ */
export default function CaptureWorkflowPage() {
  const user       = useAuthStore(s => s.user);
  const projects   = useWorkflowStore(s => s.projects);
  const towers     = useWorkflowStore(s => s.towers);
  const floors     = useWorkflowStore(s => s.floors);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const flats      = useWorkflowStore(s => s.flats);
  const rooms      = useWorkflowStore(s => s.rooms);
  const allPins    = useWorkflowStore(s => s.capturePins);
  const allCaptures = useWorkflowStore(s => s.captures);
  const createRoom         = useWorkflowStore(s => s.createRoom);
  const uploadCapture      = useWorkflowStore(s => s.uploadCapture);
  const createCapturePin   = useWorkflowStore(s => s.createCapturePin);
  // attachCaptureToPin is called from fileUploadQueue.ts now (via getState()),
  // not from this component — the queue may finish an upload long after this
  // page unmounts (offline capture, app restart, later reconnect).
  const deleteCapturePin   = useWorkflowStore(s => s.deleteCapturePin);
  const navigate = useNavigate();

  const deviceType  = useDeviceType();
  const isMobile    = usesCameraCapture(deviceType);

  // Lazy initializers so a restored location is present on the FIRST render
  // (myTowers/myFloors below already filter correctly) rather than flashing
  // an empty Overview step before an effect could restore it.
  const [step, setStep]               = useState<Step>(() => loadLastCaptureLocation()?.step ?? 'project');
  const [selectedProject, setProject] = useState<string>(() => loadLastCaptureLocation()?.projectId ?? '');
  const [selectedTower, setTower]     = useState<string>(() => loadLastCaptureLocation()?.towerId ?? '');
  const [selectedFloor, setFloor]     = useState<string>(() => loadLastCaptureLocation()?.floorId ?? '');
  const [pinPos, setPinPos]           = useState<{ x: number; y: number } | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [activeCapturePinId, setActiveCapturePinId] = useState<string | null>(null);
  const [isCaptureMode, setIsCaptureMode]           = useState(false);

  // Desktop upload state
  const [dragging, setDragging]       = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // Synchronous re-entry guard — React batches setIsUploading(true), so a rapid
  // second call (double-tap "Use Photo", double file-input fire) could read a
  // stale isUploading===false and create a duplicate capture. The ref flips
  // immediately, before any await, so the second call is rejected at once.
  // (Now only guards the legacy no-floor-plan fallback branch; pin uploads use
  // the per-pin guards below.)
  const uploadingRef = useRef(false);

  /* ── Optimistic pin upload tracking ─────────────────────────────────────
     The numbered pin is created in the store BEFORE the upload starts (it's
     already optimistic + writeQueue-persisted), so it renders immediately.
     These track the background upload per pin:
     - pinStatus:        drives the marker/panel UI ('uploading' | 'failed').
     - uploadingPinsRef: synchronous in-flight set — rejects a double-fire on
                         the same pin before React re-renders.
     - failedFilesRef:   original Files kept for "Retry Upload" after failure.
     - pinPosRef:        synchronous mirror of pinPos — consuming it atomically
                         guarantees one placement can never create two pins.   */
  const [pinStatus, setPinStatus] = useState<Record<string, PinUploadStatus>>({});
  const uploadingPinsRef = useRef<Set<string>>(new Set());
  const failedFilesRef   = useRef<Map<string, File[]>>(new Map());
  const pinPosRef        = useRef<{ x: number; y: number } | null>(null);
  const [errorToast, setErrorToast] = useState('');

  /** Keep pinPos state and its synchronous ref mirror in lockstep. */
  const setPendingPin = useCallback((pos: { x: number; y: number } | null) => {
    pinPosRef.current = pos;
    setPinPos(pos);
  }, []);

  /** True while this pin has an in-flight, queued-on-device, or failed
      upload — such pins must never be pruned as "empty", or the queued
      file / retry would be orphaned. */
  const isPinBusy = (id: string) =>
    uploadingPinsRef.current.has(id) ||
    failedFilesRef.current.has(id) ||
    !!fileUploadStatusForPin(id);

  // Mobile camera state
  const [cameraOpen, setCameraOpen]   = useState(false);
  const [cameraSource, setCameraSource] = useState<CameraSource>(() => loadCameraSource());
  // Hidden file input for mobile fallback (capture="environment")
  const mobileInputRef = useRef<HTMLInputElement>(null);

  function toggleCameraSource() {
    setCameraSource(prev => {
      const next = prev === 'insta360' ? 'device' : 'insta360';
      saveCameraSource(next);
      return next;
    });
  }

  // The Insta360 WiFi connection is intentionally kept alive across captures
  // (see CameraCaptureDialog's close-lifecycle comment) so Android's "Connect
  // to device" system picker only appears once per session instead of once
  // per pin. Release it when the engineer actually leaves this page — not
  // sooner — so the underlying NetworkCallback doesn't linger past the
  // workflow it was opened for.
  useEffect(() => {
    return () => { void Insta360Camera.disconnect(); };
  }, []);

  const [toast, setToast] = useState('');

  const assignedIds = new Set(user?.assignedProjectIds ?? []);
  const myProjects  = assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived);

  const myTowers = [...towers.filter(t => t.projectId === selectedProject)]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const myFloors = [...getFloorsWithPlanByTower(floors, floorPlans, selectedTower)]
    .sort((a, b) => a.number - b.number);

  // A floor can accumulate more than one floor-plan record: re-uploading a plan
  // adds a new record on the backend (the old one is only dropped from local
  // state), so a freshly-hydrated device — e.g. the same user on mobile — sees
  // duplicates. The plainly-newest record is often NOT the one the existing pins
  // were placed on, which made the capture workflow show an empty plan even
  // though captures exist. Prefer the record that actually owns pins so every
  // pin shows up and new captures stay on the same plan.
  const floorPlansForFloor = floorPlans.filter(
    fp => fp.towerId === selectedTower && fp.floorId === selectedFloor,
  );
  const floorPlan =
    floorPlansForFloor.find(fp => allPins.some(p => p.floorPlanId === fp.id && p.captureIds.length > 0)) ??
    floorPlansForFloor.find(fp => allPins.some(p => p.floorPlanId === fp.id)) ??
    floorPlansForFloor[0] ??
    getFloorPlanByFloor(floorPlans, selectedTower, selectedFloor);

  const floorPins: RenderPin[] = floorPlan
    ? (() => {
        // Pins for the chosen plan, falling back to every pin on this floor
        // (covers pins attached to a sibling/older floor-plan record).
        const byPlan = allPins.filter(p => p.floorPlanId === floorPlan.id);
        const source = byPlan.length > 0 ? byPlan : allPins.filter(p => p.floorId === selectedFloor);
        return [...source]
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
          .map(p => ({ id: p.id, sequenceNumber: p.sequenceNumber, x: p.x, y: p.y, hasCapture: p.captureIds.length > 0, status: pinStatus[p.id] }));
      })()
    : [];

  // Validate a RESTORED location once the real project/tower/floor lists
  // have loaded (they're empty on the very first render) — a project/tower
  // deleted or reassigned since the last session must fall back to a plain
  // fresh start, not a broken restored selection stuck on missing data.
  const didValidateRestoredLocation = useRef(false);
  useEffect(() => {
    if (didValidateRestoredLocation.current) return;
    if (!projects.length) return; // wait for real data before judging validity
    didValidateRestoredLocation.current = true;
    if (selectedProject && !myProjects.some(p => p.id === selectedProject)) {
      setStep('project'); setProject(''); setTower(''); setFloor('');
    } else if (selectedTower && !myTowers.some(t => t.id === selectedTower)) {
      setStep('tower'); setTower(''); setFloor('');
    } else if (selectedFloor && !myFloors.some(f => f.id === selectedFloor)) {
      setStep('floor'); setFloor('');
    }
  }, [projects.length, myProjects, myTowers, myFloors, selectedProject, selectedTower, selectedFloor]);

  // Persist the current location on every change so a force-close during
  // capture reopens on the same floor plan instead of the Overview step.
  useEffect(() => {
    saveLastCaptureLocation({ step, projectId: selectedProject, towerId: selectedTower, floorId: selectedFloor });
  }, [step, selectedProject, selectedTower, selectedFloor]);

  function handlePinClick(pinId: string) {
    setSelectedPinId(prev => (prev === pinId ? null : pinId));
    setPendingPin(null);
  }

  // Double-tap on an existing selected pin → immediate capture
  function handlePinActivate(pinId: string) {
    setActiveCapturePinId(pinId);
    setSelectedPinId(null);
    setPendingPin(null);
    if (isMobile) {
      setCameraOpen(true);
    }
    // Desktop: the upload zone below becomes active, user clicks Browse
  }

  const selectedPinObj = selectedPinId ? allPins.find(p => p.id === selectedPinId) ?? null : null;

  const stepIdx = STEPS.findIndex(s => s.key === step);
  const selectedProjectObj = projects.find(p => p.id === selectedProject);
  const selectedTowerObj   = towers.find(t => t.id === selectedTower);
  const selectedFloorObj   = floors.find(f => f.id === selectedFloor);

  const selections: Partial<Record<Step, string>> = {
    project: selectedProjectObj?.name,
    tower:   selectedTowerObj?.name,
    floor:   selectedFloorObj?.label,
  };

  function pruneEmptyPinsOnCurrentFloor() {
    if (!floorPlan) return;
    allPins
      .filter(p => p.floorPlanId === floorPlan.id && p.captureIds.length === 0 && !isPinBusy(p.id))
      .forEach(p => deleteCapturePin(p.id));
  }

  // When the capture step loads for a floor, prune any pins placed in a previous
  // session that were never captured (orphans from abandoned sessions).
  // Pins with an in-flight or failed (retryable) upload are NOT orphans — skip them.
  useEffect(() => {
    if (step !== 'capture' || !floorPlan) return;
    allPins
      .filter(p => p.floorPlanId === floorPlan.id && p.captureIds.length === 0 && !isPinBusy(p.id))
      .forEach(p => deleteCapturePin(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, floorPlan?.id]);

  function jumpToStep(target: Step) {
    const targetIdx = STEPS.findIndex(s => s.key === target);
    if (targetIdx >= stepIdx) return;
    // Clean up any pins placed on this floor that were never captured.
    if (step === 'capture') {
      pruneEmptyPinsOnCurrentFloor();
      setIsCaptureMode(false);
    }
    setStep(target);
    if (targetIdx <= 0) { setProject(''); setTower(''); setFloor(''); setPendingPin(null); setActiveCapturePinId(null); }
    else if (targetIdx <= 1) { setTower(''); setFloor(''); setPendingPin(null); setActiveCapturePinId(null); }
    else if (targetIdx <= 2) { setFloor(''); setPendingPin(null); setActiveCapturePinId(null); }
  }

  function goBack() {
    const prev = STEPS[stepIdx - 1];
    if (prev) jumpToStep(prev.key);
  }

  /* ── Background upload for one pin (Phase 1: on-device file queue) ──────
     The pin already exists in the store (numbered, rendered, persisted via
     the writeQueue). The captured file is written to on-device storage and
     handed to fileUploadQueue.ts, which owns the actual network upload +
     attachCaptureToPin call from here on — this function's only job is to
     get the bytes safely onto disk and mark the pin 'queued' so it survives
     the app being closed before connectivity returns. The queue's own status
     changes (queued → uploading → gone/failed) are picked up by the
     `FILE_QUEUE_CHANGED_EVENT` listener below, which re-derives `pinStatus`
     for every pin — this function never sets 'uploading' or clears the
     status itself. */
  async function runPinUpload(pinId: string, files: File[]) {
    uploadingPinsRef.current.add(pinId);            // synchronous — blocks double-fire
    setPinStatus(s => ({ ...s, [pinId]: 'queued' }));
    try {
      // Single-file capture (the normal case — one Insta360/phone photo per
      // pin): try uploading the in-memory File directly first, skipping the
      // durable queue's Filesystem write+read+base64-decode round-trip
      // entirely. Confirmed on-device: for a ~12MB raw capture that round-trip
      // stalled the WebView's JS thread for 44+ seconds with no error — pure
      // main-thread cost, not a network problem — so avoiding it when we're
      // already online (the common case) makes a normal capture upload at
      // ordinary speed instead of paying that cost every time. Only fall back
      // to the durable, retryable queue if the direct attempt fails for any
      // reason (offline, timeout, server error) — that path is unchanged and
      // still the source of truth for offline/interrupted captures.
      if (files.length === 1) {
        // Show 'uploading' (not 'queued') for the direct-upload attempt —
        // this path bypasses fileUploadQueue.ts entirely (see below), so
        // there's no queue-driven status to sync from, and a raw 360 capture
        // can take 20-30+ seconds server-side (fisheye stitch + Cloudinary
        // upload) before this resolves. Left at 'queued' the whole time, the
        // pin looked stuck/idle for that entire window with no visible
        // progress indicator, even though the upload was genuinely in
        // flight and succeeding.
        setPinStatus(s => ({ ...s, [pinId]: 'uploading' }));
        const uploaded = await tryDirectUpload(pinId, files[0]);
        // Raw 360 accepted for background stitching: the capture is already
        // attached to the pin, but the panorama isn't ready. Hand the job to the
        // durable queue so polling survives an app restart, and keep the pin on
        // 'processing' rather than clearing it to green.
        if (typeof uploaded === 'object' && uploaded.pendingJobId) {
          failedFilesRef.current.delete(pinId);
          setPinStatus(s => ({ ...s, [pinId]: 'processing' }));
          await enqueueFileUpload(pinId, files[0], { stitchJobId: uploaded.pendingJobId });
          const pendingSeq = useWorkflowStore.getState().capturePins.find(p => p.id === pinId)?.sequenceNumber;
          setToast(`Capture received for Pin ${pendingSeq ?? ''} · stitching in background`);
          return;
        }
        if (uploaded) {
          failedFilesRef.current.delete(pinId);
          setPinStatus(s => {
            const next = { ...s };
            delete next[pinId];
            return next;
          });
          // tryDirectUpload bypasses fileUploadQueue.ts entirely, so its
          // FILE_UPLOAD_SUCCEEDED_EVENT never fires — show the same success
          // toast directly here to match the queued-upload path's behavior.
          const seq = useWorkflowStore.getState().capturePins.find(p => p.id === pinId)?.sequenceNumber;
          setToast(`Capture uploaded for Pin ${seq ?? ''} · sent for review`);
          return;
        }
        // Direct attempt failed (offline, timeout, server error) — falling
        // through to the durable queue below. Reset to 'queued' so the UI
        // reads as "handed off, will retry" rather than staying on
        // 'uploading' for a request that's no longer in flight.
        setPinStatus(s => ({ ...s, [pinId]: 'queued' }));
      }
      // Multiple files from one capture (e.g. a multi-select desktop upload)
      // enqueue as separate entries; fileUploadQueue.ts uploads them for the
      // same pin strictly in order, so this doesn't reorder captures.
      for (const file of files) {
        await enqueueFileUpload(pinId, file);
      }
      failedFilesRef.current.delete(pinId);
    } catch (err) {
      // Only Filesystem.writeFile (disk full, permission revoked) throws here
      // — network failures are handled entirely inside the queue's own flush
      // loop and surface as a 'failed' queue status, not a thrown error.
      const e = err as { message?: string };
      const msg = e?.message || 'Could not save the capture on this device. Please try again.';
      const pinStillExists = useWorkflowStore.getState().capturePins.some(p => p.id === pinId);
      if (pinStillExists) {
        failedFilesRef.current.set(pinId, files);
        setPinStatus(s => ({ ...s, [pinId]: 'failed' }));
        setErrorToast(msg);
      }
    } finally {
      uploadingPinsRef.current.delete(pinId);
    }
  }

  /** Re-send a pin's queued upload — either replays the on-device queue entry
      (network failure) or, if nothing was ever written to disk (a pure
      writeFile failure), re-enqueues the originally-captured files. */
  function retryPinUpload(pinId: string) {
    if (uploadingPinsRef.current.has(pinId)) return;
    if (fileUploadStatusForPin(pinId)) {
      retryFileUpload(pinId);
      return;
    }
    const files = failedFilesRef.current.get(pinId);
    if (files?.length) void runPinUpload(pinId, files);
  }

  /* Mirror fileUploadQueue.ts's per-pin status into pinStatus so the pin
     marker / action panel reflect 'queued' (on-device, awaiting network) and
     clear automatically once the queue finishes uploading — without this
     page having to poll the queue or duplicate its retry/backoff logic.

     Seed from the FULL queue on mount, not just pins already known to this
     page's local state: pinStatus starts empty on every fresh mount, but a
     pin captured in a PREVIOUS app session (before a kill/restart) already
     has a real, persisted queue entry — without this seed, only pins
     captured within the CURRENT page lifetime ever show the queued/
     uploading marker, even though every pin's file is uploading correctly
     (reproduced: after an offline-capture + app-kill + reopen, only the
     newest pin showed the upload spinner; the earlier pins uploaded and
     turned green with no visible progress indicator at all). */
  useEffect(() => {
    let cancelled = false;
    void allQueuedPinStatuses().then(seed => {
      if (cancelled || !Object.keys(seed).length) return;
      setPinStatus(prev => ({ ...seed, ...prev }));
    });

    function syncFromQueue() {
      setPinStatus(prev => {
        const next: Record<string, PinUploadStatus> = {};
        let changed = false;
        for (const pinId of Object.keys(prev)) {
          const queued = fileUploadStatusForPin(pinId);
          if (queued) {
            next[pinId] = queued;
            if (queued !== prev[pinId]) changed = true;
          } else if (prev[pinId] !== 'failed' || failedFilesRef.current.has(pinId)) {
            // Queue entry is gone (uploaded, or never queued e.g. legacy
            // in-memory retry) — drop the status unless it's a writeFile-
            // level failure being tracked purely via failedFilesRef.
            changed = true;
          } else {
            next[pinId] = prev[pinId];
          }
        }
        return changed ? next : prev;
      });
    }
    window.addEventListener(FILE_QUEUE_CHANGED_EVENT, syncFromQueue);
    return () => {
      cancelled = true;
      window.removeEventListener(FILE_QUEUE_CHANGED_EVENT, syncFromQueue);
    };
  }, []);

  /* The actual attachCaptureToPin call now happens inside fileUploadQueue.ts,
     possibly long after this page queued the file (offline capture, app
     restart, then reconnect) — listen for its success event to show the same
     toast the old inline-upload code used to show synchronously. */
  useEffect(() => {
    function onUploadSucceeded(e: Event) {
      const pinId = (e as CustomEvent<{ pinId: string }>).detail?.pinId;
      if (!pinId) return;
      const seq = useWorkflowStore.getState().capturePins.find(p => p.id === pinId)?.sequenceNumber;
      setToast(`Capture uploaded for Pin ${seq ?? ''} · sent for review`);
    }
    window.addEventListener(FILE_UPLOAD_SUCCEEDED_EVENT, onUploadSucceeded);
    return () => window.removeEventListener(FILE_UPLOAD_SUCCEEDED_EVENT, onUploadSucceeded);
  }, []);

  /* ── Core upload pipeline — optimistic pin, background upload ─────────── */
  async function handleCaptureFiles(fileList: FileList | File[] | null) {
    const files = fileList ? Array.from(fileList as FileList) : [];
    if (!files.length || !selectedFloor) return;
    setUploadError('');

    /* Re-capture on an existing pin: attach in the background. */
    if (activeCapturePinId) {
      const pinId = activeCapturePinId;
      if (uploadingPinsRef.current.has(pinId)) return;   // one in-flight upload per pin
      setActiveCapturePinId(null);
      setPendingPin(null);
      void runPinUpload(pinId, files);
      return;
    }

    /* New pin: create it FIRST (numbered instantly, store-optimistic), then
       upload in the background. pinPosRef is consumed synchronously so a
       double-fire of the same placement can never create two pins. */
    const pos = pinPosRef.current;
    if (floorPlan && pos) {
      pinPosRef.current = null;
      setPendingPin(null);
      const pinId = createCapturePin({
        floorPlanId: floorPlan.id,
        floorId: selectedFloor,
        towerId: selectedTower,
        projectId: selectedProject,
        x: pos.x,
        y: pos.y,
      });
      void runPinUpload(pinId, files);
      return;
    }

    /* Legacy fallback (no floor plan → room-backed capture): unchanged awaited
       flow, still guarded by the original synchronous re-entry ref. */
    if (pos) {
      if (isUploading || uploadingRef.current) return;
      uploadingRef.current = true;
      setIsUploading(true);
      try {
        const result = await uploadCaptureFiles(files);
        const fileCount = result.count || files.length;
        const flat = flats.find(f => f.floorId === selectedFloor);
        const flatId = flat?.id ?? `${selectedFloor}-flat-a`;
        const seq = rooms.filter(r => r.floorId === selectedFloor).length + 1;
        const roomId = createRoom(flatId, `Capture Point ${seq}`, 'custom');
        uploadCapture(roomId, fileCount, result.files);
        setToast('Capture uploaded · sent for review');
        setPendingPin(null);
      } catch (err) {
        const e = err as { message?: string; response?: { data?: { message?: string } } };
        const msg =
          e?.response?.data?.message ||
          e?.message ||
          'Upload failed. Please check your connection and try again.';
        setUploadError(msg);
      } finally {
        setIsUploading(false);
        uploadingRef.current = false;
      }
    }
  }

  /* ── Mobile camera capture ──────────────────────────────────────────── */
  async function handleCameraCapture(file: File) {
    await handleCaptureFiles([file]);
  }

  /* ── Mobile file-input fallback (capture="environment") ─────────────── */
  async function handleMobileFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      await handleCaptureFiles(e.target.files);
    }
    e.target.value = '';
  }

  function openMobileCapture() {
    // Try getUserMedia first (CameraCaptureDialog); if not available the input fallback handles it.
    setCameraOpen(true);
  }

  /* ── "Take Picture" button — places pin + opens camera ─────────────── */
  function handleTakePicture(pinObj: NonNullable<typeof selectedPinObj> | null) {
    if (pinObj) {
      setActiveCapturePinId(pinObj.id);
      setSelectedPinId(null);
    }
    setPendingPin(pinPos); // keep pending pin if set
    openMobileCapture();
  }

  const BackBtn = step !== 'project' ? (
    <Box onClick={goBack} sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.75,
      px: 1.75, py: 0.875, borderRadius: '10px',
      border: `1.5px solid ${P.border}`, cursor: 'pointer',
      fontSize: '0.875rem', fontWeight: 600, color: P.muted,
      transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
    }}>
      <ArrowBackRounded sx={{ fontSize: 16 }} /> Back
    </Box>
  ) : undefined;

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>

      {/* Back to overview */}
      <Box component={Link} to="/dashboard/engineer" sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${P.border}`, color: P.muted,
        fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
        transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
      }}>
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
      </Box>

      {/* Page heading + Back button */}
      <Box sx={{ mb: 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography sx={{
            fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
            fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
            color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
          }}>New Capture</Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
            {user?.name?.split(' ')[0] ?? 'Engineer'} · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </Typography>
        </Box>
        {BackBtn}
      </Box>

      <StepIndicator current={step} selections={selections} onStepClick={jumpToStep} />

      {/* ── PROJECT ─────────────────────────────────────────────────────── */}
      {step === 'project' && (
        <Box>
          <SectionHead title="Select Project" sub="Which site are you visiting today?" />
          {myProjects.length === 0 ? (
            <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
              <FolderRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong }}>No projects assigned</Typography>
              <Typography sx={{ fontSize: '0.875rem', color: P.muted, mt: 0.5 }}>Contact your admin to get assigned.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {myProjects.map(p => (
                <ProjectCard key={p.id} name={p.name} location={p.location} gradient={p.gradient} accent={p.accent}
                  towers={towers.filter(t => t.projectId === p.id).length}
                  onClick={() => { setProject(p.id); setStep('tower'); }} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* ── TOWER ───────────────────────────────────────────────────────── */}
      {step === 'tower' && (
        <Box>
          <ContextBar items={[{ label: 'Project', value: selectedProjectObj?.name }]} />
          <SectionHead title="Select Tower" sub="Which tower are you capturing today?" />
          {myTowers.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '16px' }}>
              <Typography sx={{ color: P.muted }}>No towers found for this project.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(4,1fr)' }, gap: 1.25 }}>
              {myTowers.map((t, i) => (
                <TowerCard key={t.id} name={t.name} floors={countFloorsWithPlanByTower(floors, floorPlans, t.id)} index={i}
                  onClick={() => { setTower(t.id); setStep('floor'); }} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* ── FLOOR ───────────────────────────────────────────────────────── */}
      {step === 'floor' && (
        <Box>
          <ContextBar items={[
            { label: 'Project', value: selectedProjectObj?.name },
            { label: 'Tower',   value: selectedTowerObj?.name },
          ]} />
          <SectionHead title="Select Floor" sub="Which floor are you capturing?" />
          {myFloors.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '16px' }}>
              <Typography sx={{ color: P.muted }}>No floors with uploaded plans for this tower.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3,1fr)', sm: 'repeat(4,1fr)', md: 'repeat(5,1fr)' }, gap: 1 }}>
              {myFloors.map(f => (
                <FloorCard key={f.id} label={f.label} number={f.number}
                  onClick={() => { setFloor(f.id); setStep('capture'); setIsCaptureMode(false); }} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* ── CAPTURE ─────────────────────────────────────────────────────── */}
      {step === 'capture' && (
        <Box>
          <ContextBar items={[
            { label: 'Project', value: selectedProjectObj?.name },
            { label: 'Tower',   value: selectedTowerObj?.name },
            { label: 'Floor',   value: selectedFloorObj?.label },
          ]} />

          {!isCaptureMode ? (
            <Box sx={{ py: 8, textAlign: 'center', border: `1.5px solid ${P.border}`, borderRadius: '18px', backgroundColor: P.white, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Box sx={{ width: 64, height: 64, borderRadius: '16px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2, boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}>
                <CameraAltRounded sx={{ fontSize: 32, color: P.white }} />
              </Box>
              <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: P.strong, mb: 1 }}>Ready to Capture</Typography>
              <Typography sx={{ fontSize: '0.875rem', color: P.muted, mb: 3, maxWidth: 300 }}>
                {floorPins.length > 0 ? `${floorPins.length} pin${floorPins.length !== 1 ? 's' : ''} already placed on this floor.` : 'No captures on this floor yet.'}
              </Typography>
              <Box
                onClick={() => setIsCaptureMode(true)}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 3, py: 1.25, borderRadius: '12px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, color: '#fff', fontSize: '0.9375rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.3)', transition: T, '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 6px 20px rgba(37,99,235,0.4)' } }}
              >
                Go to Capture Mode
              </Box>
              <Box
                component={Link}
                to={`/floor-plans/${selectedProject}/${selectedTower}/${selectedFloor}?pinsOnly=1&returnTo=${encodeURIComponent('/capture-workflow')}`}
                sx={{ mt: 2.5, display: 'inline-flex', alignItems: 'center', gap: 0.5, color: P.subtle, fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', transition: T, '&:hover': { color: P.blue } }}
              >
                <HistoryRounded sx={{ fontSize: 14 }} /> View previous captures
              </Box>
            </Box>
          ) : (
            <Box sx={{ position: 'fixed', inset: 0, zIndex: 1400, backgroundColor: '#0f172a', display: 'flex', flexDirection: 'column' }}>
              {/* Header inside Capture Mode */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 2, py: 1.5, background: 'rgba(15,23,42,0.95)', zIndex: 20 }}>
                <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500, minWidth: 0, flex: 1, lineHeight: 1.35 }}>
                  {floorPins.length > 0
                    ? isMobile
                      ? `${floorPins.length} pin${floorPins.length !== 1 ? 's' : ''} · tap to select · ${cameraSource === 'insta360' ? 'hold plan to capture' : 'double-tap to capture'}`
                      : `${floorPins.length} pin${floorPins.length !== 1 ? 's' : ''} placed · tap a pin to capture again or view history`
                    : isMobile && cameraSource === 'insta360'
                      ? '' // instruction shown via the bottom pill instead — avoid repeating it here
                      : 'No pins yet — tap the plan to place your first capture point'}
                </Typography>
                <Box onClick={() => setIsCaptureMode(false)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.75, borderRadius: '8px', border: `1.5px solid rgba(255,255,255,0.2)`, color: 'rgba(255,255,255,0.9)', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0, transition: T, '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)' } }}>
                  <CloseRounded sx={{ fontSize: 14 }} /> Exit
                </Box>
              </Box>
              
              <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

                <Box sx={{ position: 'absolute', inset: 0 }}>
                  <FloorPlanWithPin
                    floorPlan={(floorPlan as unknown) as Record<string, unknown> | null}
                    pin={pinPos}
                    pins={floorPins}
                    onPinPlace={(x, y) => { setPendingPin({ x, y }); setSelectedPinId(null); setActiveCapturePinId(null); }}
                    onPinClick={handlePinClick}
                    onPinActivate={handlePinActivate}
                    isCaptureModeUI={true}
                    onLongPressCapture={
                      isMobile && cameraSource === 'insta360'
                        ? (x, y) => {
                            setSelectedPinId(null);
                            setActiveCapturePinId(null); // always a new pin, never a re-capture
                            setPendingPin({ x, y });
                            openMobileCapture();
                          }
                        : undefined
                    }
                  />
                </Box>
                {/* Overlaid Controls Container */}
                <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, p: { xs: 2, sm: 3 }, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 20, '& > *': { pointerEvents: 'auto', width: '100%', maxWidth: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.25)' } }}>

          {/* Pin action panel */}
          {selectedPinObj && (() => {
            const selStatus = pinStatus[selectedPinObj.id];
            const badgeColor = selStatus === 'failed' ? '#dc2626' : selectedPinObj.captureIds.length > 0 ? '#16a34a' : '#d97706';
            return (
            <Box sx={{ mb: 2.5, p: 2, borderRadius: '14px', border: `1.5px solid ${selStatus === 'failed' ? '#fca5a5' : P.border}`, backgroundColor: P.white, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                {/* Pin badge */}
                <Box sx={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: selStatus === 'failed' ? '#dc2626' : selectedPinObj.captureIds.length > 0 ? '#16a34a' : 'transparent', border: `2px ${selStatus === 'failed' ? 'solid #b91c1c' : selectedPinObj.captureIds.length > 0 ? 'solid #15803d' : 'dashed #d97706'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: selStatus === 'failed' || selectedPinObj.captureIds.length > 0 ? '#fff' : '#d97706' }}>{selectedPinObj.sequenceNumber}</Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong }}>Pin {selectedPinObj.sequenceNumber}</Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: selStatus === 'failed' ? '#dc2626' : P.muted, fontWeight: selStatus ? 600 : 400 }} noWrap>
                    {selStatus === 'uploading'
                      ? 'Uploading capture…'
                      : selStatus === 'processing'
                        ? 'Uploaded — stitching 360° in background'
                        : selStatus === 'queued'
                          ? 'Saved on device — will upload once online'
                          : selStatus === 'failed'
                            ? 'Upload failed — retry or delete this pin'
                            : selectedPinObj.captureIds.length > 0
                              ? `${selectedPinObj.captureIds.length} capture${selectedPinObj.captureIds.length !== 1 ? 's' : ''} attached`
                              : 'No capture yet'}
                  </Typography>
                </Box>
              </Box>
              {/* Actions — always their own row, so they never compete for
                  horizontal space with the badge/label and wrap unpredictably. */}
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                {selStatus === 'failed' && (
                  <Box
                    onClick={() => { retryPinUpload(selectedPinObj.id); }}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, px: 1.375, py: 0.75, borderRadius: '8px', background: 'linear-gradient(135deg,#2563eb,#1a56db)', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}
                  >
                    <CloudUploadRounded sx={{ fontSize: 15 }} /> Retry Upload
                  </Box>
                )}
                {(selStatus === 'uploading' || selStatus === 'processing') && (
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.375, py: 0.75, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, fontSize: '0.8125rem', fontWeight: 600 }}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${P.blue}`, borderTopColor: 'transparent', animation: 'pinspin 0.8s linear infinite', '@keyframes pinspin': { to: { transform: 'rotate(360deg)' } } }} />
                    {selStatus === 'processing' ? 'Stitching…' : 'Uploading…'}
                  </Box>
                )}
                {selStatus === 'queued' && (
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.375, py: 0.75, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, fontSize: '0.8125rem', fontWeight: 600 }}>
                    <CloudUploadRounded sx={{ fontSize: 15 }} /> Queued
                  </Box>
                )}
                {!selStatus && (isMobile ? (
                  /* Mobile/Tablet: Take Picture button */
                  <Box
                    onClick={() => handleTakePicture(selectedPinObj)}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, px: 1.375, py: 0.75, borderRadius: '8px', background: 'linear-gradient(135deg,#2563eb,#1a56db)', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}
                  >
                    <CameraAltRounded sx={{ fontSize: 15 }} /> Take Picture
                  </Box>
                ) : (
                  /* Desktop: Capture Again → activates upload zone */
                  <Box
                    onClick={() => { setActiveCapturePinId(selectedPinObj.id); setPendingPin(null); setSelectedPinId(null); }}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, px: 1.375, py: 0.75, borderRadius: '8px', background: 'linear-gradient(135deg,#2563eb,#1a56db)', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}
                  >
                    <AddAPhotoRounded sx={{ fontSize: 15 }} /> Capture Again
                  </Box>
                ))}
                {(() => {
                  const latestCaptureId = selectedPinObj.captureIds[selectedPinObj.captureIds.length - 1];
                  const captureExists = latestCaptureId && allCaptures.some(c => c.id === latestCaptureId);
                  return captureExists ? (
                    <Box
                      onClick={() => navigate(`/captures/${latestCaptureId}`)}
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, px: 1.375, py: 0.75, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } }}
                    >
                      <HistoryRounded sx={{ fontSize: 15 }} /> View History
                    </Box>
                  ) : null;
                })()}
                <Box
                  onClick={() => {
                    // Drop any upload tracking for the pin along with the pin itself
                    // — including its on-device queued file, if any, so a deleted
                    // pin can never come back via a queued upload finishing later.
                    failedFilesRef.current.delete(selectedPinObj.id);
                    void discardFileUpload(selectedPinObj.id);
                    setPinStatus(s => {
                      const { [selectedPinObj.id]: _gone, ...rest } = s;
                      return rest;
                    });
                    deleteCapturePin(selectedPinObj.id);
                    setSelectedPinId(null);
                  }}
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.125, py: 0.75, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, fontSize: '0.8125rem', cursor: 'pointer', '&:hover': { borderColor: '#ef4444', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)' } }}
                >
                  <DeleteOutlineRounded sx={{ fontSize: 15 }} />
                </Box>
                <Box onClick={() => setSelectedPinId(null)} sx={{ display: 'inline-flex', alignItems: 'center', px: 0.75, py: 0.75, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, cursor: 'pointer', '&:hover': { color: P.strong } }}>
                  <CloseRounded sx={{ fontSize: 15 }} />
                </Box>
              </Box>
            </Box>
            );
          })()}

          {/* Mobile: "Take Picture" CTA when a pin is placed and no pin is selected —
              a compact button, not a big card, so it doesn't cover the floor plan. */}
          {isMobile && pinPos && !selectedPinObj && (
            <Box sx={{ display: 'flex', justifyContent: 'center', boxShadow: 'none !important' }}>
              <Box
                onClick={() => openMobileCapture()}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1.25, borderRadius: '999px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, color: '#fff', fontSize: '0.9375rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(37,99,235,0.35)', transition: T, '&:active': { transform: 'scale(0.97)' } }}
              >
                <CameraAltRounded sx={{ fontSize: 18 }} /> Take Picture
              </Box>
            </Box>
          )}

          {/* Mobile: prompt to place pin first — a small pill, not a card,
              so it never blocks the floor plan the engineer is looking at. */}
          {isMobile && !pinPos && !selectedPinObj && !activeCapturePinId && (
            <Box sx={{ display: 'flex', justifyContent: 'center', boxShadow: 'none !important' }}>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderRadius: '999px', backgroundColor: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(8px)' }}>
                <AddLocationAltRounded sx={{ fontSize: 16, color: '#f59e0b', flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.95)', fontWeight: 500 }}>
                  {cameraSource === 'insta360' ? 'Long-press the plan to place & capture' : 'Tap the plan to place a pin'}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Mobile: re-capture active (no pin panel shown, camera will open) */}
          {isMobile && activeCapturePinId && !cameraOpen && (
            <Box sx={{ mb: 2.5 }}>
              <Box
                onClick={() => openMobileCapture()}
                sx={{ borderRadius: '16px', p: 3, textAlign: 'center', border: `2px solid ${P.blue}55`, backgroundColor: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(12px)', cursor: 'pointer', transition: T, '&:active': { backgroundColor: P.blueSoft } }}
              >
                <Box sx={{ width: 52, height: 52, borderRadius: '14px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5, boxShadow: '0 6px 18px rgba(37,99,235,0.3)' }}>
                  <CameraAltRounded sx={{ fontSize: 26, color: P.white }} />
                </Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>
                  {`Recapture Pin ${allPins.find(p => p.id === activeCapturePinId)?.sequenceNumber ?? ''}`}
                </Typography>
                <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Tap to open camera</Typography>
              </Box>
            </Box>
          )}

          {/* Desktop upload zone — hidden on mobile/tablet */}
          {!isMobile && (() => {
            const ready = !!(pinPos || activeCapturePinId);
            const recapPin = activeCapturePinId ? allPins.find(p => p.id === activeCapturePinId) : null;
            return (
              <Box
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); if (ready && !isUploading) void handleCaptureFiles(e.dataTransfer.files); }}
                sx={{
                  borderRadius: '16px', p: { xs: 2, sm: 2.5 }, textAlign: 'center',
                  border: `2px dashed ${dragging ? P.blue : ready ? P.blue + '55' : P.border}`,
                  backgroundColor: dragging ? P.blueSoft : 'rgba(255,255,255,0.96)',
                  backdropFilter: 'blur(12px)',
                  transition: T, cursor: ready ? 'pointer' : 'default',
                }}
              >
                {ready ? (
                  <>
                    <Box sx={{ width: 44, height: 44, borderRadius: '12px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.25, boxShadow: '0 6px 18px rgba(37,99,235,0.3)' }}>
                      <CloudUploadRounded sx={{ fontSize: 22, color: P.white }} />
                    </Box>
                    <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>
                      {recapPin ? `Attach new capture to Pin ${recapPin.sequenceNumber}` : 'Upload Capture Image'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mb: 1 }}>Drag & drop or click to browse</Typography>
                    <Typography sx={{ fontSize: '0.6875rem', color: P.subtle, mb: 2 }}>Supported: .jpg .jpeg .png .dng .insp</Typography>
                    <Box component="label" htmlFor="capture-file-input" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, px: 2, py: 0.875, borderRadius: '8px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, cursor: isUploading ? 'default' : 'pointer', fontSize: '0.8125rem', fontWeight: 700, color: P.white, boxShadow: '0 4px 14px rgba(37,99,235,0.3)', opacity: isUploading ? 0.7 : 1, '&:hover': { opacity: isUploading ? 0.7 : 0.9 } }}>
                      <PhotoCameraRounded sx={{ fontSize: 16 }} /> {isUploading ? 'Uploading…' : 'Browse & Upload'}
                    </Box>
                    <Box component="input" id="capture-file-input" type="file" multiple accept=".jpg,.jpeg,.png,.dng,.insp" disabled={isUploading} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { void handleCaptureFiles(e.target.files); (e.target as HTMLInputElement).value = ''; }} sx={{ display: 'none' }} />
                    {uploadError && <Typography sx={{ mt: 1.75, fontSize: '0.8125rem', color: P.red }}>{uploadError}</Typography>}
                  </>
                ) : (
                  <>
                    <Box sx={{ width: 52, height: 52, borderRadius: '14px', backgroundColor: P.bg, border: `1.5px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5 }}>
                      <AddLocationAltRounded sx={{ fontSize: 26, color: P.subtle }} />
                    </Box>
                    <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>Place a capture point first</Typography>
                    <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Tap anywhere on the floor plan above to mark your location</Typography>
                  </>
                )}
              </Box>
            );
          })()}
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Mobile camera dialog (full-screen getUserMedia) */}
      <CameraCaptureDialog
        open={cameraOpen}
        pinLabel={
          activeCapturePinId
            ? `Pin ${allPins.find(p => p.id === activeCapturePinId)?.sequenceNumber ?? ''} — Re-capture`
            : pinPos ? 'New Capture Point' : 'Capture'
        }
        onCapture={handleCameraCapture}
        onClose={() => {
          setCameraOpen(false);
          // If camera was for a new pin but no image taken, clear the pending pin
          // so the user isn't stuck with a pin they can't complete.
        }}
        insta360SsidPattern={cameraSource === 'insta360' ? INSTA360_SSID_PATTERN : undefined}
        insta360Password={cameraSource === 'insta360' ? INSTA360_WIFI_PASSWORD : undefined}
      />

      {/* Hidden file input for mobile fallback when getUserMedia is blocked */}
      <Box
        ref={mobileInputRef}
        component="input"
        type="file"
        accept="image/*"
        // @ts-ignore — capture is a valid HTML attribute but not in React's typedefs
        capture="environment"
        onChange={handleMobileFileInput}
        sx={{ display: 'none' }}
      />

      {/* Toast */}
      <Snackbar open={!!toast} autoHideDuration={3500} onClose={() => setToast('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" icon={<CheckCircleRounded sx={{ fontSize: 20 }} />} onClose={() => setToast('')} sx={{ borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', fontWeight: 600 }}>
          {toast}
        </Alert>
      </Snackbar>

      {/* Background upload failure — the pin stays on the plan with a failed badge */}
      <Snackbar open={!!errorToast} autoHideDuration={6000} onClose={() => setErrorToast('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="error" onClose={() => setErrorToast('')} sx={{ borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', fontWeight: 600 }}>
          {errorToast} — tap the pin to retry.
        </Alert>
      </Snackbar>
    </Box>
  );
}
