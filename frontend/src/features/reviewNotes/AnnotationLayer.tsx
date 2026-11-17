import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Viewer } from '@photo-sphere-viewer/core';
import {
  angularDistanceDeg, arrowHead, dragIsBigEnough, ellipseOutline, MAX_SHAPES, rectOutline, shortLabel, simplifyPen,
  type Annotation, type AnnotationSpace, type Pt, type Shape,
} from '@/utils/annotationGeometry';

export type AnnotateTool = 'move' | 'rect' | 'ellipse' | 'arrow' | 'pen';

export interface LayerNote {
  id: string;
  /** 1-based number shown on the photo and in the list. */
  index: number;
  text: string;
  resolved: boolean;
  annotation: Annotation;
}

export interface DraftState {
  tool: AnnotateTool;
  color: string;
  shapes: Shape[];
  onShapes: (shapes: Shape[]) => void;
}

interface Props {
  space: AnnotationSpace;
  /** The sphere viewer for 360 photos; null for flat photos. */
  viewer: Viewer | null;
  notes: LayerNote[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Present while a manager is drawing a new annotation. */
  draft: DraftState | null;
}

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const HIDE_BEYOND_DEG = 85; // points this far from the centre of the view are behind or at the edge of the camera

type Screen = { x: number; y: number };

/**
 * Draws every saved annotation of the current photo over the viewer, and (for a manager) takes new drawings.
 * Shapes are kept in the photo's own coordinates so they stay on the right spot as the view turns and zooms.
 */
export default function AnnotationLayer({ space, viewer, notes, selectedId, onSelect, draft }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setTick] = useState(0);
  const [live, setLive] = useState<{ tool: AnnotateTool; pts: Pt[] } | null>(null);
  // The stroke being drawn lives in a ref as well, so a fast pointer-up never reads a stale render.
  const liveRef = useRef<{ tool: AnnotateTool; pts: Pt[] } | null>(null);
  const setLiveBoth = (v: { tool: AnnotateTool; pts: Pt[] } | null) => { liveRef.current = v; setLive(v); };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw after every render of the viewer. The viewer's camera is only up to date once it has rendered, so
  // reacting to its "render" event (not to the move itself) keeps shapes locked to the photo with no lag.
  useEffect(() => {
    if (!viewer) return;
    const redraw = () => { flushSync(() => setTick(t => t + 1)); };
    const events = ['render', 'size-updated', 'ready'] as const;
    events.forEach(e => viewer.addEventListener(e as never, redraw));
    redraw();
    return () => {
      events.forEach(e => { try { viewer.removeEventListener(e as never, redraw); } catch { /* viewer gone */ } });
    };
  }, [viewer]);

  const project = useCallback((p: Pt): Screen | null => {
    if (space === 'flat') return { x: p[0] * size.w, y: p[1] * size.h };
    if (!viewer) return null;
    try {
      const pos = viewer.getPosition();
      if (angularDistanceDeg(p, [pos.yaw * DEG, pos.pitch * DEG]) > HIDE_BEYOND_DEG) return null;
      const c = viewer.dataHelper.sphericalCoordsToViewerCoords({ yaw: p[0] * RAD, pitch: p[1] * RAD });
      return Number.isFinite(c.x) && Number.isFinite(c.y) ? { x: c.x, y: c.y } : null;
    } catch { return null; }
  }, [space, viewer, size.w, size.h]);

  const unproject = useCallback((s: Pt): Pt | null => {
    if (space === 'flat') {
      if (!size.w || !size.h) return null;
      return [Math.min(1, Math.max(0, s[0] / size.w)), Math.min(1, Math.max(0, s[1] / size.h))];
    }
    if (!viewer) return null;
    try {
      const c = viewer.dataHelper.viewerCoordsToSphericalCoords({ x: s[0], y: s[1] });
      return Number.isFinite(c.yaw) && Number.isFinite(c.pitch) ? [c.yaw * DEG, c.pitch * DEG] : null;
    } catch { return null; }
  }, [space, viewer, size.w, size.h]);

  const drawing = !!draft && draft.tool !== 'move';

  const screenOf = (e: React.PointerEvent): Pt => {
    const r = hostRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onDown = (e: React.PointerEvent) => {
    if (!draft || draft.tool === 'move') return;
    if (draft.shapes.length >= MAX_SHAPES) return;
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    setLiveBoth({ tool: draft.tool, pts: [screenOf(e)] });
  };

  const onMove = (e: React.PointerEvent) => {
    const prev = liveRef.current;
    if (!prev) return;
    e.stopPropagation();
    const p = screenOf(e);
    setLiveBoth(prev.tool === 'pen' ? { ...prev, pts: [...prev.pts, p] } : { ...prev, pts: [prev.pts[0], p] });
  };

  const onUp = (e: React.PointerEvent) => {
    const current = liveRef.current;
    if (!current || !draft) { setLiveBoth(null); return; }
    e.stopPropagation();
    const { tool, pts } = current;
    setLiveBoth(null);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!dragIsBigEnough(first, last, tool === 'pen' ? 10 : 6) && !(tool === 'pen' && pts.length > 6)) return;

    let screenPts: Pt[];
    if (tool === 'rect') screenPts = rectOutline(first, last);
    else if (tool === 'ellipse') screenPts = ellipseOutline(first, last);
    else if (tool === 'arrow') screenPts = [first, last];
    else screenPts = simplifyPen(pts);

    const stored: Pt[] = [];
    for (const sp of screenPts) {
      const u = unproject(sp);
      if (u) stored.push(u);
    }
    if (stored.length < 2) return;
    draft.onShapes([...draft.shapes, { kind: tool as Shape["kind"], color: draft.color, points: stored }]);
  };

  // ── drawing helpers ─────────────────────────────────────────────────────────
  const polyPath = (pts: (Screen | null)[], close = false): string => {
    let d = '';
    let pen = false;
    for (const p of pts) {
      if (!p) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
      pen = true;
    }
    return close && d ? `${d}Z` : d;
  };

  const renderShape = (shape: Shape, key: string, opts: { selected?: boolean; dim?: boolean }) => {
    const proj = shape.points.map(project);
    const stroke = shape.color;
    const w = opts.selected ? 4 : 2.75;
    const common = { fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, opacity: opts.dim ? 0.45 : 1 };

    if (shape.kind === 'arrow') {
      const [tail, tip] = [proj[0], proj[proj.length - 1]];
      if (!tail || !tip) return null;
      const [l, r] = arrowHead([tail.x, tail.y], [tip.x, tip.y], opts.selected ? 20 : 16);
      const d = `M${tail.x},${tail.y} L${tip.x},${tip.y} M${l[0]},${l[1]} L${tip.x},${tip.y} L${r[0]},${r[1]}`;
      return (
        <g key={key} {...common}>
          <path d={d} stroke="rgba(0,0,0,0.55)" strokeWidth={w + 2.5} />
          <path d={d} stroke={stroke} strokeWidth={w} />
        </g>
      );
    }
    const closed = shape.kind === 'rect' || shape.kind === 'ellipse';
    const d = polyPath(proj, false);
    if (!d) return null;
    return (
      <g key={key} {...common}>
        {closed && <path d={d} fill={stroke} fillOpacity={opts.selected ? 0.22 : 0.12} stroke="none" />}
        <path d={d} stroke="rgba(0,0,0,0.55)" strokeWidth={w + 2.5} />
        <path d={d} stroke={stroke} strokeWidth={w} />
      </g>
    );
  };

  const renderChip = (n: LayerNote) => {
    const pts: Screen[] = [];
    for (const s of n.annotation.shapes) for (const p of s.points) { const q = project(p); if (q) pts.push(q); }
    if (!pts.length) return null;
    const top = pts.reduce((a, b) => (b.y < a.y ? b : a), pts[0]);
    const label = shortLabel(n.text, 40);
    const width = Math.min(260, 40 + label.length * 6.8);
    const x = Math.min(Math.max(top.x - 12, 6), Math.max(6, size.w - width - 6));
    const y = Math.min(Math.max(top.y - 34, 6), Math.max(6, size.h - 34));
    const selected = n.id === selectedId;
    const color = n.annotation.shapes[0]?.color ?? '#ef4444';
    return (
      <g
        key={`chip-${n.id}`}
        transform={`translate(${x},${y})`}
        style={{ cursor: 'pointer', pointerEvents: 'auto', opacity: n.resolved ? 0.6 : 1 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onSelect(selected ? null : n.id); }}
      >
        <rect width={label ? width : 28} height={28} rx={14} fill="rgba(15,23,42,0.92)" stroke={selected ? '#fff' : color} strokeWidth={selected ? 2 : 1.5} />
        <circle cx={14} cy={14} r={9} fill={n.resolved ? '#16a34a' : color} />
        <text x={14} y={18} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff">{n.resolved ? '✓' : n.index}</text>
        {label && <text x={30} y={18} fontSize={12} fontWeight={600} fill="#fff" textDecoration={n.resolved ? 'line-through' : undefined}>{label}</text>}
      </g>
    );
  };

  const liveShape = (): Shape | null => {
    if (!live || !draft) return null;
    const first = live.pts[0];
    const last = live.pts[live.pts.length - 1];
    if (live.tool === 'rect') return { kind: 'rect', color: draft.color, points: rectOutline(first, last) };
    if (live.tool === 'ellipse') return { kind: 'ellipse', color: draft.color, points: ellipseOutline(first, last) };
    if (live.tool === 'arrow') return { kind: 'arrow', color: draft.color, points: [first, last] };
    return { kind: 'pen', color: draft.color, points: live.pts };
  };

  const liveRender = () => {
    const s = liveShape();
    if (!s) return null;
    // the in-progress shape is already in screen pixels
    if (s.kind === 'arrow') {
      const [tail, tip] = [s.points[0], s.points[1]];
      const [l, r] = arrowHead(tail, tip);
      const d = `M${tail[0]},${tail[1]} L${tip[0]},${tip[1]} M${l[0]},${l[1]} L${tip[0]},${tip[1]} L${r[0]},${r[1]}`;
      return <g fill="none" strokeLinecap="round" strokeLinejoin="round"><path d={d} stroke="rgba(0,0,0,0.55)" strokeWidth={5.5} /><path d={d} stroke={s.color} strokeWidth={3} /></g>;
    }
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    const closed = s.kind === 'rect' || s.kind === 'ellipse';
    return (
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {closed && <path d={d} fill={s.color} fillOpacity={0.12} stroke="none" />}
        <path d={d} stroke="rgba(0,0,0,0.55)" strokeWidth={5.5} />
        <path d={d} stroke={s.color} strokeWidth={3} strokeDasharray={closed ? '6 4' : undefined} />
      </g>
    );
  };

  return (
    <div
      ref={hostRef}
      data-testid="annotation-layer"
      style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', overflow: 'hidden' }}
    >
      <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {notes.map(n => n.annotation.shapes.map((s, i) => renderShape(s, `${n.id}-${i}`, { selected: n.id === selectedId, dim: !!selectedId && n.id !== selectedId || n.resolved && n.id !== selectedId })))}
        {draft?.shapes.map((s, i) => renderShape(s, `draft-${i}`, {}))}
        {liveRender()}
        {notes.map(renderChip)}
        {drawing && (
          <rect
            x={0} y={0} width={size.w} height={size.h} fill="transparent"
            style={{ pointerEvents: 'auto', cursor: 'crosshair', touchAction: 'none' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setLiveBoth(null)}
          />
        )}
      </svg>
    </div>
  );
}
