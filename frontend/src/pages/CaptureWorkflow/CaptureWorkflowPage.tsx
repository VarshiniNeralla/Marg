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
import { getFloorPlanByFloor, getFloorsByTower } from '@store/workflowSelectors';
import { uploadCaptureFiles } from '@/services/uploadService';
import { useDeviceType, usesCameraCapture } from '@/hooks/useDeviceType';
import CameraCaptureDialog from '@/features/capturePins/CameraCaptureDialog';

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
interface RenderPin {
  id: string;
  sequenceNumber: number;
  x: number;
  y: number;
  hasCapture: boolean;
}

/* ── Floor plan viewer with pin, fullscreen, pinch-to-zoom ──────────────── */
function FloorPlanWithPin({
  floorPlan, pin, pins, onPinPlace, onPinClick, onPinActivate,
}: {
  floorPlan: Record<string, unknown> | null;
  pin: { x: number; y: number } | null;
  pins: RenderPin[];
  onPinPlace: (x: number, y: number) => void;
  onPinClick: (pinId: string) => void;
  onPinActivate: (pinId: string) => void;
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

  const clampOffset = useCallback((ox: number, oy: number, s: number) => {
    const el = containerRef.current;
    if (!el) return { x: ox, y: oy };
    const { width: cw, height: ch } = el.getBoundingClientRect();
    const wrap = imgWrapRef.current;
    if (!wrap) return { x: ox, y: oy };
    const { width: iw, height: ih } = wrap.getBoundingClientRect();
    const scaledW = iw * s / scale; // approximate — good enough for clamping
    const scaledH = ih * s / scale;
    const maxX = Math.max(0, (scaledW - cw) / 2 + 60);
    const maxY = Math.max(0, (scaledH - ch) / 2 + 60);
    return {
      x: Math.max(-maxX, Math.min(maxX, ox)),
      y: Math.max(-maxY, Math.min(maxY, oy)),
    };
  }, [scale]);

  const zoom = useCallback((dir: 1 | -1) => {
    setScale(s => Math.min(4, Math.max(0.5, +(s + dir * 0.25).toFixed(2))));
  }, []);

  const resetView = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

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
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setOffset({ x: dragStart.current.ox + e.clientX - dragStart.current.x, y: dragStart.current.oy + e.clientY - dragStart.current.y });
  }
  function onMouseUp() { setIsDragging(false); }

  // ── Desktop click → place pin ───────────────────────────────────────────
  function onCanvasClick(e: React.MouseEvent) {
    if (isDragging) return;
    if ((e.target as Element).closest?.('[data-pin-id]')) return;
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
      e.preventDefault();
      const [t1, t2] = [e.touches[0], e.touches[1]] as unknown as [React.Touch, React.Touch];
      pinchStartRef.current = { dist: getTouchDist(t1, t2), scale, midX: getTouchMid(t1, t2).x, midY: getTouchMid(t1, t2).y };
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      touchDragStart.current = { ox: offset.x, oy: offset.y, mx: t.clientX, my: t.clientY };
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if ((e.target as Element).closest?.('[data-pin-id]')) return;
    touchMovedRef.current = true;

    if (e.touches.length === 2 && pinchStartRef.current) {
      e.preventDefault();
      const [t1, t2] = [e.touches[0], e.touches[1]] as unknown as [React.Touch, React.Touch];
      const newDist = getTouchDist(t1, t2);
      const rawScale = (newDist / pinchStartRef.current.dist) * pinchStartRef.current.scale;
      const newScale = Math.min(4, Math.max(0.5, +rawScale.toFixed(3)));
      setScale(newScale);
      // Pan offset so the pinch midpoint stays fixed.
      const { midX, midY } = pinchStartRef.current;
      const mid = getTouchMid(t1, t2);
      setOffset(prev => ({
        x: prev.x + (mid.x - midX) * 0.4,
        y: prev.y + (mid.y - midY) * 0.4,
      }));
    } else if (e.touches.length === 1 && !pinchStartRef.current) {
      const t = e.touches[0];
      const dx = t.clientX - touchDragStart.current.mx;
      const dy = t.clientY - touchDragStart.current.my;
      setOffset({ x: touchDragStart.current.ox + dx, y: touchDragStart.current.oy + dy });
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if ((e.target as Element).closest?.('[data-pin-id]')) return;

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
          setScale(2);
          // Center on the tap point
          const wrap = imgWrapRef.current;
          if (wrap) {
            const rect = wrap.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            setOffset({ x: -(t.clientX - cx) * 0.8, y: -(t.clientY - cy) * 0.8 });
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
    pinchStartRef.current = null;
    touchMovedRef.current = false;
  }

  // ── Touch tap on pin → place pin if nothing selected ────────────────────
  function onTouchPinPlace(e: React.TouchEvent) {
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
        { icon: fullscreen ? <FullscreenExitRounded sx={{ fontSize: 15 }} /> : <FullscreenRounded sx={{ fontSize: 15 }} />, fn: () => setFullscreen(f => !f) },
      ].map((b, i) => (
        <Box key={i} onClick={(e) => { e.stopPropagation(); b.fn(); }} sx={{ width: 28, height: 28, borderRadius: '7px', backgroundColor: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', transition: T, '&:hover': { backgroundColor: 'rgba(37,99,235,0.7)' } }}>
          {b.icon}
        </Box>
      ))}
    </Box>
  );

  const viewer = (
    <Box sx={{
      borderRadius: fullscreen ? 0 : '18px', overflow: 'hidden',
      border: fullscreen ? 'none' : `1.5px solid ${P.border}`,
      backgroundColor: '#0f172a', position: 'relative',
      width: '100%', height: '100%',
      boxShadow: fullscreen ? 'none' : '0 8px 32px rgba(15,23,42,0.16)',
    }}>
      {/* Top bar */}
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, px: 2, py: 1.25, background: 'linear-gradient(180deg,rgba(10,12,20,0.92) 0%,transparent 100%)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {fullscreen && (
            <Box onClick={() => setFullscreen(false)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, mr: 1.5, px: 1.25, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', cursor: 'pointer', color: 'rgba(255,255,255,0.85)', fontSize: '0.8125rem', fontWeight: 600, transition: T, '&:hover': { backgroundColor: 'rgba(255,255,255,0.15)' } }}>
              <ArrowBackRounded sx={{ fontSize: 14 }} /> Back
            </Box>
          )}
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: pin ? '#22c55e' : '#f59e0b', boxShadow: pin ? '0 0 6px #22c55e' : '0 0 6px #f59e0b', flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.95)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {pin ? 'Point placed' : 'Tap to drop pin'}
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
                const color = p.hasCapture ? '#16a34a' : '#d97706';
                return (
                  <Box
                    key={p.id}
                    data-pin-id={p.id}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      onPinClick(p.id);
                    }}
                    sx={{ position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%,-100%)', cursor: 'pointer', zIndex: 5, touchAction: 'none' }}
                  >
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.5))', transition: T, '&:hover': { transform: 'scale(1.08)' } }}>
                      <Box sx={{ width: { xs: 20, sm: 30 }, height: { xs: 20, sm: 30 }, borderRadius: '50% 50% 50% 0', backgroundColor: color, border: { xs: '2px solid #fff', sm: '3px solid #fff' }, transform: 'rotate(-45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography sx={{ fontSize: { xs: '0.625rem', sm: '0.8125rem' }, fontWeight: 800, color: '#fff', transform: 'rotate(45deg)', lineHeight: 1 }}>{p.sequenceNumber}</Typography>
                      </Box>
                      <Box sx={{ width: 2, height: { xs: 4, sm: 6 }, backgroundColor: color, mt: '-1px' }} />
                    </Box>
                  </Box>
                );
              })}

              {/* Pending pin */}
              {pin && (
                <Box sx={{ position: 'absolute', left: `${pin.x}%`, top: `${pin.y}%`, transform: 'translate(-50%,-100%)', pointerEvents: 'none', zIndex: 6 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.5))' }}>
                    <Box sx={{ width: { xs: 22, sm: 34 }, height: { xs: 22, sm: 34 }, borderRadius: '50% 50% 50% 0', backgroundColor: '#22c55e', border: { xs: '2px solid #fff', sm: '3px solid #fff' }, transform: 'rotate(-45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pinpulse 1.2s ease-in-out infinite', '@keyframes pinpulse': { '0%,100%': { boxShadow: '0 0 0 0 rgba(34,197,94,0.5)' }, '50%': { boxShadow: '0 0 0 5px rgba(34,197,94,0)' } } }}>
                      <MyLocationRounded sx={{ fontSize: { xs: 10, sm: 14 }, color: '#fff', transform: 'rotate(45deg)' }} />
                    </Box>
                    <Box sx={{ width: 2, height: { xs: 5, sm: 8 }, backgroundColor: '#22c55e', mt: '-1px' }} />
                    <Box sx={{ width: { xs: 4, sm: 5 }, height: { xs: 4, sm: 5 }, borderRadius: '50%', backgroundColor: '#22c55e', opacity: 0.4 }} />
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

      {!pin && (
        <Box sx={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', px: 2, py: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)', borderRadius: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, width: 'max-content', maxWidth: '90%' }}>
          <AddLocationAltRounded sx={{ fontSize: 18, color: '#f59e0b' }} />
          <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.95)', fontWeight: 500, textAlign: 'center' }}>Tap anywhere to drop pin</Typography>
        </Box>
      )}

      {fullscreen && (
        <Box sx={{ position: 'absolute', bottom: 16, right: 16, px: 1.25, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
          <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500, letterSpacing: '0.02em' }}>Press Esc or Back to exit</Typography>
        </Box>
      )}
    </Box>
  );

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
  const attachCaptureToPin = useWorkflowStore(s => s.attachCaptureToPin);
  const deleteCapturePin   = useWorkflowStore(s => s.deleteCapturePin);
  const navigate = useNavigate();

  const deviceType  = useDeviceType();
  const isMobile    = usesCameraCapture(deviceType);

  const [step, setStep]               = useState<Step>('project');
  const [selectedProject, setProject] = useState<string>('');
  const [selectedTower, setTower]     = useState<string>('');
  const [selectedFloor, setFloor]     = useState<string>('');
  const [pinPos, setPinPos]           = useState<{ x: number; y: number } | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [activeCapturePinId, setActiveCapturePinId] = useState<string | null>(null);

  // Desktop upload state
  const [dragging, setDragging]       = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // Synchronous re-entry guard — React batches setIsUploading(true), so a rapid
  // second call (double-tap "Use Photo", double file-input fire) could read a
  // stale isUploading===false and create a duplicate capture. The ref flips
  // immediately, before any await, so the second call is rejected at once.
  const uploadingRef = useRef(false);

  // Mobile camera state
  const [cameraOpen, setCameraOpen]   = useState(false);
  // Hidden file input for mobile fallback (capture="environment")
  const mobileInputRef = useRef<HTMLInputElement>(null);

  const [toast, setToast] = useState('');

  const assignedIds = new Set(user?.assignedProjectIds ?? []);
  const myProjects  = assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived);

  const myTowers = [...towers.filter(t => t.projectId === selectedProject)]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const myFloors = [...getFloorsByTower(floors, selectedTower)]
    .sort((a, b) => a.number - b.number);

  const floorPlan = getFloorPlanByFloor(floorPlans, selectedTower, selectedFloor);

  const floorPins: RenderPin[] = floorPlan
    ? [...allPins.filter(p => p.floorPlanId === floorPlan.id)]
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
        .map(p => ({ id: p.id, sequenceNumber: p.sequenceNumber, x: p.x, y: p.y, hasCapture: p.captureIds.length > 0 }))
    : [];

  function handlePinClick(pinId: string) {
    setSelectedPinId(prev => (prev === pinId ? null : pinId));
    setPinPos(null);
  }

  // Double-tap on an existing selected pin → immediate capture
  function handlePinActivate(pinId: string) {
    setActiveCapturePinId(pinId);
    setSelectedPinId(null);
    setPinPos(null);
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
      .filter(p => p.floorPlanId === floorPlan.id && p.captureIds.length === 0)
      .forEach(p => deleteCapturePin(p.id));
  }

  // When the capture step loads for a floor, prune any pins placed in a previous
  // session that were never captured (orphans from abandoned sessions).
  useEffect(() => {
    if (step !== 'capture' || !floorPlan) return;
    allPins
      .filter(p => p.floorPlanId === floorPlan.id && p.captureIds.length === 0)
      .forEach(p => deleteCapturePin(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, floorPlan?.id]);

  function jumpToStep(target: Step) {
    const targetIdx = STEPS.findIndex(s => s.key === target);
    if (targetIdx >= stepIdx) return;
    // Clean up any pins placed on this floor that were never captured.
    if (step === 'capture') pruneEmptyPinsOnCurrentFloor();
    setStep(target);
    if (targetIdx <= 0) { setProject(''); setTower(''); setFloor(''); setPinPos(null); setActiveCapturePinId(null); }
    else if (targetIdx <= 1) { setTower(''); setFloor(''); setPinPos(null); setActiveCapturePinId(null); }
    else if (targetIdx <= 2) { setFloor(''); setPinPos(null); setActiveCapturePinId(null); }
  }

  function goBack() {
    const prev = STEPS[stepIdx - 1];
    if (prev) jumpToStep(prev.key);
  }

  /* ── Core upload pipeline ───────────────────────────────────────────── */
  async function handleCaptureFiles(fileList: FileList | File[] | null) {
    const files = fileList ? Array.from(fileList as FileList) : [];
    if (!files.length || (!activeCapturePinId && !pinPos) || !selectedFloor || isUploading || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploadError('');
    setIsUploading(true);
    try {
      const result = await uploadCaptureFiles(files);
      const fileCount = result.count || files.length;

      if (activeCapturePinId) {
        const existingPin = allPins.find(p => p.id === activeCapturePinId);
        attachCaptureToPin(activeCapturePinId, fileCount, result.files);
        setToast(`New capture attached to Pin ${existingPin?.sequenceNumber ?? ''} · sent for review`);
        setActiveCapturePinId(null);
        setPinPos(null);
      } else if (floorPlan && pinPos) {
        const pinId = createCapturePin({
          floorPlanId: floorPlan.id,
          floorId: selectedFloor,
          towerId: selectedTower,
          projectId: selectedProject,
          x: pinPos.x,
          y: pinPos.y,
        });
        attachCaptureToPin(pinId, fileCount, result.files);
        const seq = allPins.filter(p => p.floorPlanId === floorPlan.id).length + 1;
        setToast(`Image attached to Pin ${seq} · sent for review`);
        setPinPos(null);
      } else if (pinPos) {
        const flat = flats.find(f => f.floorId === selectedFloor);
        const flatId = flat?.id ?? `${selectedFloor}-flat-a`;
        const seq = rooms.filter(r => r.floorId === selectedFloor).length + 1;
        const roomId = createRoom(flatId, `Capture Point ${seq}`, 'custom');
        uploadCapture(roomId, fileCount, result.files);
        setToast('Capture uploaded · sent for review');
        setPinPos(null);
      }
    } catch {
      setUploadError('Upload failed. Please check your connection and try again.');
    } finally {
      setIsUploading(false);
      uploadingRef.current = false;
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
    setPinPos(pinPos); // keep pending pin if set
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
                <TowerCard key={t.id} name={t.name} floors={t.floors} index={i}
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
              <Typography sx={{ color: P.muted }}>No floors found for this tower.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3,1fr)', sm: 'repeat(4,1fr)', md: 'repeat(5,1fr)' }, gap: 1 }}>
              {myFloors.map(f => (
                <FloorCard key={f.id} label={f.label} number={f.number}
                  onClick={() => { setFloor(f.id); setStep('capture'); }} />
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

          {/* Instruction row */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>
              {floorPins.length > 0
                ? isMobile
                  ? `${floorPins.length} pin${floorPins.length !== 1 ? 's' : ''} · tap pin to select · double-tap to capture`
                  : `${floorPins.length} pin${floorPins.length !== 1 ? 's' : ''} placed · tap a pin to capture again or view history`
                : 'No pins yet — tap the plan to place your first capture point'}
            </Typography>
            <Box component={Link} to="/my-captures" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.625, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } }}>
              View History <ArrowForwardRounded sx={{ fontSize: 13 }} />
            </Box>
          </Box>

          <Box sx={{ mb: selectedPinObj ? 1.5 : 2.5 }}>
            <FloorPlanWithPin
              floorPlan={(floorPlan as unknown) as Record<string, unknown> | null}
              pin={pinPos}
              pins={floorPins}
              onPinPlace={(x, y) => { setPinPos({ x, y }); setSelectedPinId(null); setActiveCapturePinId(null); }}
              onPinClick={handlePinClick}
              onPinActivate={handlePinActivate}
            />
          </Box>

          {/* Pin action panel */}
          {selectedPinObj && (
            <Box sx={{ mb: 2.5, p: 2, borderRadius: '14px', border: `1.5px solid ${P.border}`, backgroundColor: P.white, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              {/* Pin badge */}
              <Box sx={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: selectedPinObj.captureIds.length > 0 ? '#16a34a' : 'transparent', border: `2px ${selectedPinObj.captureIds.length > 0 ? 'solid #15803d' : 'dashed #d97706'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: selectedPinObj.captureIds.length > 0 ? '#fff' : '#d97706' }}>{selectedPinObj.sequenceNumber}</Typography>
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong }}>Pin {selectedPinObj.sequenceNumber}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
                  {selectedPinObj.captureIds.length > 0
                    ? `${selectedPinObj.captureIds.length} capture${selectedPinObj.captureIds.length !== 1 ? 's' : ''} attached`
                    : 'No capture yet'}
                </Typography>
              </Box>
              {/* Actions */}
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', flexShrink: 0 }}>
                {isMobile ? (
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
                    onClick={() => { setActiveCapturePinId(selectedPinObj.id); setPinPos(null); setSelectedPinId(null); }}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, px: 1.375, py: 0.75, borderRadius: '8px', background: 'linear-gradient(135deg,#2563eb,#1a56db)', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 3px 10px rgba(37,99,235,0.28)' }}
                  >
                    <AddAPhotoRounded sx={{ fontSize: 15 }} /> Capture Again
                  </Box>
                )}
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
                  onClick={() => { deleteCapturePin(selectedPinObj.id); setSelectedPinId(null); }}
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.125, py: 0.75, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, fontSize: '0.8125rem', cursor: 'pointer', '&:hover': { borderColor: '#ef4444', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)' } }}
                >
                  <DeleteOutlineRounded sx={{ fontSize: 15 }} />
                </Box>
                <Box onClick={() => setSelectedPinId(null)} sx={{ display: 'inline-flex', alignItems: 'center', px: 0.75, py: 0.75, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, cursor: 'pointer', '&:hover': { color: P.strong } }}>
                  <CloseRounded sx={{ fontSize: 15 }} />
                </Box>
              </Box>
            </Box>
          )}

          {/* Mobile: "Take Picture" CTA when a pin is placed and no pin is selected */}
          {isMobile && pinPos && !selectedPinObj && (
            <Box sx={{ mb: 2.5 }}>
              <Box
                onClick={() => openMobileCapture()}
                sx={{ borderRadius: '16px', p: 3, textAlign: 'center', border: `2px solid ${P.blue}55`, backgroundColor: 'rgba(37,99,235,0.03)', cursor: 'pointer', transition: T, '&:active': { backgroundColor: P.blueSoft } }}
              >
                <Box sx={{ width: 52, height: 52, borderRadius: '14px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5, boxShadow: '0 6px 18px rgba(37,99,235,0.3)' }}>
                  <CameraAltRounded sx={{ fontSize: 26, color: P.white }} />
                </Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>Take Picture</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Opens your rear camera</Typography>
              </Box>
            </Box>
          )}

          {/* Mobile: prompt to place pin first */}
          {isMobile && !pinPos && !selectedPinObj && !activeCapturePinId && (
            <Box sx={{ mb: 2.5, borderRadius: '16px', p: 3, textAlign: 'center', border: `2px dashed ${P.border}`, backgroundColor: P.bg }}>
              <Box sx={{ width: 52, height: 52, borderRadius: '14px', backgroundColor: P.bg, border: `1.5px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5 }}>
                <AddLocationAltRounded sx={{ fontSize: 26, color: P.subtle }} />
              </Box>
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>Tap the floor plan</Typography>
              <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Drop a pin where you're standing, then take a picture</Typography>
            </Box>
          )}

          {/* Mobile: re-capture active (no pin panel shown, camera will open) */}
          {isMobile && activeCapturePinId && !cameraOpen && (
            <Box sx={{ mb: 2.5 }}>
              <Box
                onClick={() => openMobileCapture()}
                sx={{ borderRadius: '16px', p: 3, textAlign: 'center', border: `2px solid ${P.blue}55`, backgroundColor: 'rgba(37,99,235,0.03)', cursor: 'pointer', transition: T, '&:active': { backgroundColor: P.blueSoft } }}
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
                  borderRadius: '16px', p: { xs: 2.5, sm: 3.5 }, textAlign: 'center',
                  border: `2px dashed ${dragging ? P.blue : ready ? P.blue + '55' : P.border}`,
                  backgroundColor: dragging ? P.blueSoft : ready ? 'rgba(37,99,235,0.02)' : P.bg,
                  transition: T, cursor: ready ? 'pointer' : 'default',
                }}
              >
                {ready ? (
                  <>
                    <Box sx={{ width: 52, height: 52, borderRadius: '14px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5, boxShadow: '0 6px 18px rgba(37,99,235,0.3)' }}>
                      <CloudUploadRounded sx={{ fontSize: 26, color: P.white }} />
                    </Box>
                    <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>
                      {recapPin ? `Attach new capture to Pin ${recapPin.sequenceNumber}` : 'Upload Capture Image'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.875rem', color: P.muted, mb: 1.75 }}>Drag & drop or click to browse</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: P.subtle, mb: 2.5 }}>Supported: .jpg .jpeg .png .dng .insp</Typography>
                    <Box component="label" htmlFor="capture-file-input" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.75, py: 1.125, borderRadius: '10px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, cursor: isUploading ? 'default' : 'pointer', fontSize: '0.875rem', fontWeight: 700, color: P.white, boxShadow: '0 4px 14px rgba(37,99,235,0.3)', opacity: isUploading ? 0.7 : 1, '&:hover': { opacity: isUploading ? 0.7 : 0.9 } }}>
                      <PhotoCameraRounded sx={{ fontSize: 17 }} /> {isUploading ? 'Uploading…' : 'Browse & Upload'}
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
    </Box>
  );
}
