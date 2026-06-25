import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip, useMediaQuery, useTheme, Drawer } from '@mui/material';
import {
  ArrowBackRounded, ZoomInRounded, ZoomOutRounded, FullscreenRounded,
  FullscreenExitRounded, CenterFocusStrongRounded, UploadFileRounded,
  LayersRounded, RoomRounded, CameraAltRounded, ViewInArRounded, ArrowForwardRounded,
  CloudOffRounded, KeyboardArrowDownRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isFieldEngineer } from '@store/authStore';
import { getFloorPlanByFloor, getFloorsByTower } from '@store/workflowSelectors';
import type { MockRoomMarker } from '@/data/mockData';

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

/* ── CtrlBtn — small icon button inside the viewer ─────────────────────── */
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

  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const user       = useAuthStore(s => s.user);
  const isEngineer = isFieldEngineer(user);

  const project    = useWorkflowStore(s => s.projects.find(p => p.id === projectId));
  const tower      = useWorkflowStore(s => s.towers.find(t => t.id === towerId));
  const floors     = useWorkflowStore(s => s.floors);
  const floorPlans = useWorkflowStore(s => s.floorPlans);

  const towerFloors = [...getFloorsByTower(floors, towerId ?? '')].sort((a, b) => a.number - b.number);
  const floor       = towerFloors.find(f => f.id === floorId);
  const floorPlan   = getFloorPlanByFloor(floorPlans, towerId ?? '', floorId ?? '');

  /* ── state ──────────────────────────────────────────────────────────── */
  const [scale, setScale]               = useState(1);
  const [offset, setOffset]             = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen]     = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<MockRoomMarker | null>(null);
  const [isDragging, setIsDragging]     = useState(false);
  const [fadeIn, setFadeIn]             = useState(false);
  const [floorSheetOpen, setFloorSheetOpen] = useState(false);

  /* trigger fade-in animation every time the floor changes */
  useEffect(() => {
    setFadeIn(false);
    // double-rAF ensures the browser has painted the hidden state before fading in
    let t1: number, t2: number;
    t1 = requestAnimationFrame(() => {
      t2 = requestAnimationFrame(() => setFadeIn(true));
    });
    return () => { cancelAnimationFrame(t1); cancelAnimationFrame(t2); };
  }, [floorId]);

  /* mutable refs so event handlers always read fresh values without re-binding */
  const scaleRef     = useRef(1);
  const offsetRef    = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const draggingRef  = useRef(false);
  const viewerRef    = useRef<HTMLDivElement>(null);
  const imgRef       = useRef<HTMLImageElement>(null);

  /* keep refs in sync */
  useEffect(() => { scaleRef.current  = scale;  }, [scale]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  /* ── centerImage ────────────────────────────────────────────────────── */
  const centerImage = useCallback(() => {
    const el  = viewerRef.current;
    const img = imgRef.current;
    if (!el || !img) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const iw = img.naturalWidth  || img.offsetWidth;
    const ih = img.naturalHeight || img.offsetHeight;
    if (!vw || !vh || !iw || !ih) return;
    const s = Math.min(vw / iw, vh / ih) * 0.90;
    const x = (vw - iw * s) / 2;
    const y = (vh - ih * s) / 2;
    setScale(s); setOffset({ x, y });
    scaleRef.current = s; offsetRef.current = { x, y };
  }, []);

  /* re-center on fullscreen change */
  useEffect(() => {
    const t = setTimeout(centerImage, 80);
    return () => clearTimeout(t);
  }, [fullscreen, centerImage]);

  /* ── pointer drag (pure DOM to avoid stale closure issues) ─────────── */
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      draggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const nx = dragStartRef.current.ox + e.clientX - dragStartRef.current.x;
      const ny = dragStartRef.current.oy + e.clientY - dragStartRef.current.y;
      setOffset({ x: nx, y: ny });
      offsetRef.current = { x: nx, y: ny };
    };
    const onUp = () => { draggingRef.current = false; setIsDragging(false); };

    // track visual dragging state for cursor
    const onDownVis  = () => setIsDragging(true);
    const onUpVis    = () => setIsDragging(false);

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup',   onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerdown', onDownVis);
    el.addEventListener('pointerup',   onUpVis);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup',   onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerdown', onDownVis);
      el.removeEventListener('pointerup',   onUpVis);
    };
  // re-bind whenever fullscreen changes so we get the fresh DOM node
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
      const next  = Math.min(8, Math.max(0.1, scaleRef.current + delta));
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
  }, [fullscreen]); // re-bind on fullscreen toggle

  /* ── Escape exits fullscreen ────────────────────────────────────────── */
  useEffect(() => {
    if (!fullscreen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fullscreen]);

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

  const planRecord   = floorPlan as (typeof floorPlan & Record<string, unknown>) | null;
  const mediaAssets  = (planRecord?.mediaAssets as { original_url?: string }[] | undefined) ?? [];
  const imageUrl: string | null =
    (planRecord?.fileUrl as string | undefined)
    ?? (planRecord?.file_url as string | undefined)
    ?? mediaAssets[0]?.original_url
    ?? null;

  const statusCounts = floorPlan ? {
    not_started: floorPlan.rooms.filter(r => r.status === 'not_started').length,
    in_progress: floorPlan.rooms.filter(r => r.status === 'in_progress').length,
    reviewed:    floorPlan.rooms.filter(r => r.status === 'reviewed').length,
    published:   floorPlan.rooms.filter(r => r.status === 'published').length,
  } : null;

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
      {/* Transformed image layer — only rendered when there's an image */}
      <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <Box sx={{
          position: 'absolute', top: 0, left: 0,
          transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          transition: isDragging ? 'none' : 'transform 80ms ease-out',
          willChange: 'transform',
        }}>
          {imageUrl && (
            <Box sx={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 8px 32px rgba(15,23,42,0.20)' }}>
              <Box
                component="img"
                ref={imgRef}
                src={imageUrl}
                alt={`${floor.label} floor plan`}
                draggable={false}
                onLoad={() => { centerImage(); setTimeout(centerImage, 120); }}
                sx={{ display: 'block', width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none', backgroundColor: '#fff' }}
              />
              {/* SVG room overlays */}
              {floorPlan && floorPlan.rooms.length > 0 && (
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {floorPlan.rooms.map(room => {
                    const sc = STATUS_COLOR[room.status] ?? STATUS_COLOR.not_started;
                    const rx = (room.x / 100) * 900;
                    const ry = (room.y / 100) * 700;
                    const rw = (room.width / 100) * 900;
                    const rh = (room.height / 100) * 700;
                    const sel = selectedRoom?.id === room.id;
                    return (
                      <g key={room.id} onClick={e => { e.stopPropagation(); setSelectedRoom(sel ? null : room); }} style={{ cursor: 'pointer', pointerEvents: 'all' }}>
                        <rect x={rx} y={ry} width={rw} height={rh} fill={sel ? sc.stroke : sc.fill} fillOpacity={sel ? 0.35 : 1} stroke={sc.stroke} strokeWidth={sel ? 2.5 : 1.5} rx="4" />
                        <text x={rx + rw / 2} y={ry + rh / 2 - 5} textAnchor="middle" style={{ fontSize: '11px', fontWeight: 700, fill: sel ? '#fff' : sc.stroke, pointerEvents: 'none' }}>{room.number}</text>
                        <text x={rx + rw / 2} y={ry + rh / 2 + 8} textAnchor="middle" style={{ fontSize: '9px', fill: sel ? 'rgba(255,255,255,0.8)' : '#64748b', pointerEvents: 'none' }}>{room.type}</text>
                      </g>
                    );
                  })}
                </svg>
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* Empty states — centered absolutely, outside the pan/zoom transform */}
      {!imageUrl && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          {floorPlan ? (
            /* has plan record but no image URL */
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
            /* engineer — no plan */
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
            /* admin/manager — no plan: show upload CTA */
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

      {/* Controls column — left (nudge down in fullscreen to clear the Back button) */}
      <Box sx={{ position: 'absolute', top: fullscreen ? 56 : 12, left: 12, display: 'flex', flexDirection: 'column', gap: 0.625, zIndex: 10 }}>
        <CtrlBtn title="Zoom in"        small={isMobile} onClick={() => { const n = Math.min(8, scaleRef.current + 0.25); const cx = (viewerRef.current?.clientWidth ?? 0) / 2; const cy = (viewerRef.current?.clientHeight ?? 0) / 2; const r = n / scaleRef.current; scaleRef.current = n; setScale(n); setOffset(o => { const nx = cx - r*(cx-o.x); const ny = cy - r*(cy-o.y); offsetRef.current={x:nx,y:ny}; return {x:nx,y:ny}; }); }}><ZoomInRounded sx={{ fontSize: isMobile ? 15 : 17 }} /></CtrlBtn>
        <CtrlBtn title="Zoom out"       small={isMobile} onClick={() => { const n = Math.max(0.1, scaleRef.current - 0.25); const cx = (viewerRef.current?.clientWidth ?? 0) / 2; const cy = (viewerRef.current?.clientHeight ?? 0) / 2; const r = n / scaleRef.current; scaleRef.current = n; setScale(n); setOffset(o => { const nx = cx - r*(cx-o.x); const ny = cy - r*(cy-o.y); offsetRef.current={x:nx,y:ny}; return {x:nx,y:ny}; }); }}><ZoomOutRounded sx={{ fontSize: isMobile ? 15 : 17 }} /></CtrlBtn>
        <CtrlBtn title="Fit to screen"  small={isMobile} onClick={centerImage}><CenterFocusStrongRounded sx={{ fontSize: isMobile ? 15 : 17 }} /></CtrlBtn>
        <CtrlBtn title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} small={isMobile} onClick={() => setFullscreen(f => !f)}>
          {fullscreen ? <FullscreenExitRounded sx={{ fontSize: isMobile ? 15 : 17 }} /> : <FullscreenRounded sx={{ fontSize: isMobile ? 15 : 17 }} />}
        </CtrlBtn>
      </Box>

      {/* Fullscreen: ← Back — top-left, always visible */}
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

      {/* Bottom bar: zoom % + hint */}
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
    </Box>
  );

  /* ── fullscreen overlay ─────────────────────────────────────────────── */
  if (fullscreen) {
    return (
      <Box sx={{ position: 'fixed', inset: 0, zIndex: 1400, backgroundColor: '#0d1117', display: 'flex', flexDirection: 'column' }}>
        {viewerBox}
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
          <Box component={Link} to={`/floor-plans?project=${projectId}&tower=${towerId}`}
            sx={{ mt: 0.5, width: 32, height: 32, borderRadius: '9px', border: `1.5px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.muted, textDecoration: 'none', flexShrink: 0, transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } }}>
            <ArrowBackRounded sx={{ fontSize: 16 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.75rem', color: P.muted, mb: 0.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name} · {tower.name}</Typography>
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.125rem', sm: '1.625rem' }, fontWeight: 800, color: P.strong, letterSpacing: '-0.045em', lineHeight: 1.1 }}>
              {floor.label} — Floor Plan
            </Typography>
          </Box>
        </Box>
        {/* Upload button — admins/managers only */}
        {!isEngineer && (
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

      {/* Legend strip */}
      {statusCounts && floorPlan && floorPlan.rooms.length > 0 && (
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
        {/* Viewer takes remaining space */}
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>{viewerBox}</Box>

        {/* Floor switcher */}
        {towerFloors.length > 1 && (
          <>
            {/* Mobile: compact dropdown trigger → bottom sheet */}
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

            {/* Desktop: vertical pill list on the right */}
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
    </Box>
  );
}
