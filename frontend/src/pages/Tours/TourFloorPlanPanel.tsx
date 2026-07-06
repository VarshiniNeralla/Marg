import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import {
  CloseRounded, OpenInFullRounded, CenterFocusStrongRounded,
  ChevronRightRounded, KeyboardArrowUpRounded, RestartAltRounded,
} from '@mui/icons-material';
import type { WfCapturePin } from '@store/workflowStore';

const DEFAULT_PANEL_WIDTH = 280;
const DEFAULT_VIEWER_HEIGHT = 160;
const DEFAULT_PANEL_LEFT = 16;
const MIN_PANEL_WIDTH = 200;
const MIN_VIEWER_HEIGHT = 120;
const PANEL_EDGE = 16;

function panelMaxWidth(left: number) {
  if (typeof window === 'undefined') return 640;
  return Math.max(MIN_PANEL_WIDTH, window.innerWidth - left - PANEL_EDGE);
}

function panelMaxHeight() {
  if (typeof window === 'undefined') return 480;
  return Math.max(MIN_VIEWER_HEIGHT, window.innerHeight - 160);
}

function ResizeHandle({
  side,
  onPointerDown,
}: {
  side: 'top' | 'right';
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const isTop = side === 'top';
  return (
    <Box
      onPointerDown={onPointerDown}
      sx={{
        position: 'absolute',
        zIndex: 3,
        cursor: isTop ? 'ns-resize' : 'ew-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none',
        color: 'rgba(255,255,255,0.35)',
        transition: 'color 120ms, background-color 120ms',
        '&:hover': {
          color: 'rgba(255,255,255,0.85)',
          backgroundColor: 'rgba(255,255,255,0.06)',
        },
        ...(isTop
          ? { top: 0, left: 0, right: 0, height: 12 }
          : { top: 0, bottom: 0, right: 0, width: 12 }),
      }}
    >
      {isTop
        ? <KeyboardArrowUpRounded sx={{ fontSize: 14 }} />
        : <ChevronRightRounded sx={{ fontSize: 14 }} />}
    </Box>
  );
}

interface TourFloorPlanPanelProps {
  imageUrl: string;
  floorLabel: string;
  pins: WfCapturePin[];
  activePinId?: string | null;
  onPinClick: (pinId: string) => void;
  onClose: () => void;
}

export default function TourFloorPlanPanel({
  imageUrl,
  floorLabel,
  pins,
  activePinId,
  onPinClick,
  onClose,
}: TourFloorPlanPanelProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const movedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [viewerHeight, setViewerHeight] = useState(DEFAULT_VIEWER_HEIGHT);
  const resizeRef = useRef<{
    edge: 'top' | 'right';
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const isCustomLayout = maximized
    || panelWidth !== DEFAULT_PANEL_WIDTH
    || viewerHeight !== DEFAULT_VIEWER_HEIGHT;

  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setPageSize({ w: img.naturalWidth || 1000, h: img.naturalHeight || 700 });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r) setContainerSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [maximized, panelWidth, viewerHeight]);

  const clampOffset = useCallback((ox: number, oy: number, s: number): { x: number; y: number } => {
    const el = viewerRef.current;
    if (!el || !pageSize.w || !pageSize.h) return { x: ox, y: oy };
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const margin = 16;
    const imgW = pageSize.w * s;
    const imgH = pageSize.h * s;
    return {
      x: Math.min(vw - margin, Math.max(margin - imgW, ox)),
      y: Math.min(vh - margin, Math.max(margin - imgH, oy)),
    };
  }, [pageSize]);

  const centerImage = useCallback(() => {
    const el = viewerRef.current;
    if (!el || !pageSize.w || !pageSize.h) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (!vw || !vh) return;
    const s = Math.min(vw / pageSize.w, vh / pageSize.h) * 0.92;
    const x = (vw - pageSize.w * s) / 2;
    const y = (vh - pageSize.h * s) / 2;
    scaleRef.current = s;
    offsetRef.current = { x, y };
    setScale(s);
    setOffset({ x, y });
  }, [pageSize]);

  const resetToNormal = useCallback(() => {
    setMaximized(false);
    setPanelWidth(DEFAULT_PANEL_WIDTH);
    setViewerHeight(DEFAULT_VIEWER_HEIGHT);
    window.setTimeout(() => centerImage(), 80);
  }, [centerImage]);

  useEffect(() => {
    if (pageSize.w > 0) {
      centerImage();
      const t = setTimeout(centerImage, 100);
      return () => clearTimeout(t);
    }
  }, [pageSize, centerImage]);

  useEffect(() => {
    if (!pageSize.w || containerSize.w <= 0 || containerSize.h <= 0) return;
    const t = setTimeout(centerImage, 60);
    return () => clearTimeout(t);
  }, [maximized, panelWidth, viewerHeight, containerSize.w, containerSize.h, pageSize.w, centerImage]);

  useEffect(() => {
    if (!isCustomLayout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resetToNormal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCustomLayout, resetToNormal]);

  useEffect(() => {
    const onResize = () => {
      setPanelWidth(w => Math.min(w, panelMaxWidth(DEFAULT_PANEL_LEFT)));
      setViewerHeight(h => Math.min(h, panelMaxHeight()));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      if (r.edge === 'right') {
        const dx = e.clientX - r.startX;
        setPanelWidth(Math.min(panelMaxWidth(DEFAULT_PANEL_LEFT), Math.max(MIN_PANEL_WIDTH, r.startW + dx)));
      } else {
        const dy = r.startY - e.clientY;
        setViewerHeight(Math.min(panelMaxHeight(), Math.max(MIN_VIEWER_HEIGHT, r.startH + dy)));
      }
    };
    const onUp = () => {
      if (resizeRef.current) {
        resizeRef.current = null;
        window.setTimeout(() => centerImage(), 40);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [centerImage]);

  const startResize = (edge: 'top' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      edge,
      startX: e.clientX,
      startY: e.clientY,
      startW: panelWidth,
      startH: viewerHeight,
    };
  };

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.12 : -0.12;
      const next = Math.min(12, Math.max(0.08, scaleRef.current + delta));
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ratio = next / scaleRef.current;
      const nx = mx - ratio * (mx - offsetRef.current.x);
      const ny = my - ratio * (my - offsetRef.current.y);
      const clamped = clampOffset(nx, ny, next);
      scaleRef.current = next;
      offsetRef.current = clamped;
      setScale(next);
      setOffset(clamped);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clampOffset]);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if ((e.target as Element).closest('[data-pin-id]')) return;
      movedRef.current = false;
      draggingRef.current = true;
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        ox: offsetRef.current.x,
        oy: offsetRef.current.y,
      };
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const nx = dragStartRef.current.ox + e.clientX - dragStartRef.current.x;
      const ny = dragStartRef.current.oy + e.clientY - dragStartRef.current.y;
      if (Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y) > 4) {
        movedRef.current = true;
      }
      const clamped = clampOffset(nx, ny, scaleRef.current);
      offsetRef.current = clamped;
      setOffset(clamped);
    };

    const endDrag = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
    };
  }, [clampOffset]);

  const vbX = containerSize.w > 0 ? -offset.x / scale : 0;
  const vbY = containerSize.h > 0 ? -offset.y / scale : 0;
  const vbW = containerSize.w > 0 ? containerSize.w / scale : 100;
  const vbH = containerSize.h > 0 ? containerSize.h / scale : 100;

  const PIN_SCREEN_RADIUS = 12;
  const pinPageRadius = PIN_SCREEN_RADIUS / scale;
  const pinStroke = 1.5 / scale;
  const pinFontSize = 10 / scale;
  const pinHitRadius = 16 / scale;

  const handleMaximize = () => {
    setMaximized(true);
    window.setTimeout(() => centerImage(), 80);
  };

  return (
    <Box
      sx={{
        position: maximized ? 'fixed' : 'absolute',
        ...(maximized
          ? { inset: { xs: '56px 10px 72px 10px', sm: '56px 20px 20px 20px' }, zIndex: 35 }
          : { bottom: { xs: 72, sm: 16 }, left: DEFAULT_PANEL_LEFT, zIndex: 25, width: panelWidth }),
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '14px',
        overflow: 'hidden',
        backgroundColor: 'rgba(15,23,42,0.92)',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      }}
    >
      {!maximized && (
        <>
          <ResizeHandle side="top" onPointerDown={startResize('top')} />
          <ResizeHandle side="right" onPointerDown={startResize('right')} />
        </>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.25, py: 0.875, borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>Floor plan</Typography>
          <Typography noWrap sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.55)' }}>{floorLabel}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
          <Tooltip title="Fit to screen">
            <IconButton size="small" onClick={centerImage} sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)' } }}>
              <CenterFocusStrongRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          {!maximized && (
            <Tooltip title="Maximize panel">
              <IconButton size="small" onClick={handleMaximize} sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)' } }}>
                <OpenInFullRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
          {isCustomLayout && (
            <Tooltip title="Back to normal">
              <IconButton size="small" onClick={resetToNormal} sx={{ color: '#93c5fd', '&:hover': { color: '#fff', backgroundColor: 'rgba(37,99,235,0.25)' } }}>
                <RestartAltRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)' } }}>
              <CloseRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ p: 1, bgcolor: '#f8fafc', flex: maximized ? 1 : undefined, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box
          ref={viewerRef}
          sx={{
            position: 'relative',
            width: '100%',
            flex: maximized ? 1 : undefined,
            height: maximized ? '100%' : viewerHeight,
            minHeight: maximized ? 200 : MIN_VIEWER_HEIGHT,
            borderRadius: '8px',
            overflow: 'hidden',
            bgcolor: '#e2e8f0',
            cursor: isDragging ? 'grabbing' : 'grab',
            touchAction: 'none',
            userSelect: 'none',
          }}
        >
          {pageSize.w > 0 && (
            <svg
              viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
            >
              <rect x={0} y={0} width={pageSize.w} height={pageSize.h} fill="#fff" rx={8 / scale} />
              <image
                href={imageUrl}
                x={0}
                y={0}
                width={pageSize.w}
                height={pageSize.h}
                preserveAspectRatio="none"
              />
              {pins.map(pin => {
                const cx = (pin.x / 100) * pageSize.w;
                const cy = (pin.y / 100) * pageSize.h;
                const hasCapture = pin.captureIds.length > 0;
                const isActive = pin.id === activePinId;
                const stroke = hasCapture ? (isActive ? '#2563eb' : '#16a34a') : '#d97706';
                const fill = hasCapture ? (isActive ? '#2563eb' : '#16a34a') : '#fff';

                return (
                  <g key={pin.id} style={{ cursor: hasCapture ? 'pointer' : 'default' }}>
                    {isActive && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={pinPageRadius * 1.45}
                        fill="rgba(37,99,235,0.2)"
                        stroke="#2563eb"
                        strokeWidth={pinStroke}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={pinPageRadius}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={pinStroke}
                      strokeDasharray={hasCapture ? undefined : `${3 / scale} ${2.5 / scale}`}
                      opacity={hasCapture ? 1 : 0.55}
                      style={{ pointerEvents: 'none' }}
                    />
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={pinFontSize}
                      fontWeight={700}
                      fill={hasCapture ? '#fff' : '#d97706'}
                      fontFamily="Inter, system-ui, sans-serif"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {pin.sequenceNumber}
                    </text>
                    {hasCapture && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={pinHitRadius}
                        fill="transparent"
                        data-pin-id={pin.id}
                        onPointerDown={() => { movedRef.current = false; }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (movedRef.current) return;
                          onPinClick(pin.id);
                        }}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </Box>
        <Typography sx={{ mt: 0.5, fontSize: '0.625rem', color: 'rgba(15,23,42,0.45)', textAlign: 'center', flexShrink: 0 }}>
          {maximized
            ? 'Back to normal restores default size · Esc to reset'
            : 'Top/right arrows resize · Drag to pan · Ctrl + scroll to zoom'}
        </Typography>
      </Box>
    </Box>
  );
}
