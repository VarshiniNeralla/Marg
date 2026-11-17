import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { LinkRounded, LinkOffRounded, ViewInArRounded } from '@mui/icons-material';
import '@photo-sphere-viewer/core/index.css';

/** The slice of GPano orientation this view needs (same shape the tour viewer stores per capture). */
export interface PanoOrientation {
  poseHeadingDegrees: number;
  posePitchDegrees: number;
  poseRollDegrees: number;
  initialViewHeadingDegrees: number;
  initialViewPitchDegrees: number;
  initialHorizontalFovDegrees: number;
}

export interface ComparePanel {
  /** Stitched 360° (equirectangular) image address, or null when that capture has no panorama yet. */
  url: string | null;
  orientation: PanoOrientation;
  /** "Before", "After", "Selected date", "Latest" */
  tag: string;
  /** Human date and time of the capture. */
  dateLabel: string;
  tagColor?: string;
}

interface Props {
  left: ComparePanel;
  right: ComparePanel;
  /** Start with both views moving together (turn one, the other follows). */
  syncDefault?: boolean;
}

const MIN_FOV = 30;
const MAX_FOV = 90;

function zoomFromHfov(hfov: number): number {
  const c = Math.min(MAX_FOV, Math.max(MIN_FOV, hfov));
  return Math.round(((MAX_FOV - c) / (MAX_FOV - MIN_FOV)) * 100);
}

type PsvViewer = import('@photo-sphere-viewer/core').Viewer;

/**
 * Two 360° panoramas side by side (stacked on a narrow screen), each labelled with its capture date. Turning or zooming
 * one moves the other too while "Sync views" is on, so the same spot can be looked at in both dates at once.
 */
export default function ComparePanoramas({ left, right, syncDefault = true }: Props) {
  const [sync, setSync] = useState(syncDefault);
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const leftEl = useRef<HTMLDivElement>(null);
  const rightEl = useRef<HTMLDivElement>(null);
  const viewers = useRef<{ l: PsvViewer | null; r: PsvViewer | null }>({ l: null, r: null });
  const lockUntil = useRef(0);
  const [status, setStatus] = useState<{ l: 'loading' | 'ready' | 'error' | 'none'; r: 'loading' | 'ready' | 'error' | 'none' }>({
    l: left.url ? 'loading' : 'none', r: right.url ? 'loading' : 'none',
  });

  useEffect(() => {
    let destroyed = false;
    const created: PsvViewer[] = [];
    setStatus({ l: left.url ? 'loading' : 'none', r: right.url ? 'loading' : 'none' });

    async function mount() {
      const { Viewer } = await import('@photo-sphere-viewer/core');
      if (destroyed) return;

      const build = (el: HTMLDivElement | null, panel: ComparePanel, side: 'l' | 'r') => {
        if (!el || !panel.url) return null;
        const o = panel.orientation;
        const viewer = new Viewer({
          container: el,
          panorama: panel.url,
          navbar: false,
          loadingTxt: '',
          loadingImg: '',
          minFov: MIN_FOV,
          maxFov: MAX_FOV,
          defaultZoomLvl: zoomFromHfov(o.initialHorizontalFovDegrees),
          defaultYaw: `${o.initialViewHeadingDegrees}deg`,
          defaultPitch: `${o.initialViewPitchDegrees}deg`,
          touchmoveTwoFingers: false,
          mousewheelCtrlKey: false,
          moveInertia: true,
          panoData: (image: { width: number; height: number }) => ({
            fullWidth: image.width, fullHeight: image.height, croppedWidth: image.width, croppedHeight: image.height,
            croppedX: 0, croppedY: 0, poseHeading: o.poseHeadingDegrees, posePitch: o.posePitchDegrees, poseRoll: o.poseRollDegrees,
            initialHeading: o.initialViewHeadingDegrees, initialPitch: o.initialViewPitchDegrees, initialFov: o.initialHorizontalFovDegrees,
          }),
        });
        viewer.addEventListener('ready', () => { if (!destroyed) setStatus(s => ({ ...s, [side]: 'ready' })); });
        viewer.addEventListener('panorama-error' as never, () => { if (!destroyed) setStatus(s => ({ ...s, [side]: 'error' })); });
        created.push(viewer);
        return viewer;
      };

      const l = build(leftEl.current, left, 'l');
      const r = build(rightEl.current, right, 'r');
      viewers.current = { l, r };

      // Turning or zooming one view moves the other. The short lock stops the follower's own events from bouncing back.
      const follow = (from: PsvViewer | null, to: PsvViewer | null) => {
        if (!from || !to) return;
        from.addEventListener('position-updated', ({ position }) => {
          if (!syncRef.current || performance.now() < lockUntil.current) return;
          lockUntil.current = performance.now() + 80;
          try { to.rotate({ yaw: position.yaw, pitch: position.pitch }); } catch { /* not ready yet */ }
        });
        from.addEventListener('zoom-updated', ({ zoomLevel }) => {
          if (!syncRef.current || performance.now() < lockUntil.current) return;
          lockUntil.current = performance.now() + 80;
          try { to.zoom(zoomLevel); } catch { /* not ready yet */ }
        });
      };
      follow(l, r);
      follow(r, l);
    }
    void mount();

    return () => {
      destroyed = true;
      viewers.current = { l: null, r: null };
      created.forEach(v => { try { v.destroy(); } catch { /* already gone */ } });
    };
  }, [left.url, right.url, left.orientation, right.orientation]);

  const panel = (p: ComparePanel, el: React.RefObject<HTMLDivElement | null>, st: 'loading' | 'ready' | 'error' | 'none', testId: string) => (
    <Box data-testid={testId} sx={{ position: 'relative', height: { xs: 280, sm: 360, md: 440 }, borderRadius: '14px', overflow: 'hidden', backgroundColor: '#0f1929' }}>
      <Box ref={el} sx={{ position: 'absolute', inset: 0, '& .psv-container': { borderRadius: '14px' } }} />
      {st !== 'ready' && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, px: 2, textAlign: 'center', pointerEvents: 'none' }}>
          <ViewInArRounded sx={{ fontSize: 34, color: 'rgba(255,255,255,0.35)' }} />
          <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
            {st === 'loading' ? 'Loading panorama…'
              : st === 'error' ? 'Could not load this panorama'
                : 'Panorama not ready for this date yet'}
          </Typography>
        </Box>
      )}
      <Box sx={{ position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: '999px', backgroundColor: 'rgba(15,23,42,0.78)', backdropFilter: 'blur(6px)', pointerEvents: 'none', maxWidth: 'calc(100% - 20px)' }}>
        <Box component="span" sx={{ px: 0.75, py: 0.125, borderRadius: '999px', backgroundColor: p.tagColor ?? '#2563eb', color: '#fff', fontSize: '0.6875rem', fontWeight: 800, flexShrink: 0 }}>{p.tag}</Box>
        <Typography noWrap sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>{p.dateLabel}</Typography>
      </Box>
    </Box>
  );

  return (
    <Box data-testid="compare-panoramas">
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.25 }}>
        {panel(left, leftEl, status.l, 'compare-left')}
        {panel(right, rightEl, status.r, 'compare-right')}
      </Box>
      <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.75rem', color: '#6b7280' }}>
          {sync ? 'Both views move together. Turn one and the other follows.' : 'Each view moves on its own.'}
        </Typography>
        <Box
          role="button"
          data-testid="sync-toggle"
          onClick={() => setSync(v => !v)}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.625, borderRadius: '999px', cursor: 'pointer', userSelect: 'none', fontSize: '0.75rem', fontWeight: 700,
            color: sync ? '#2563eb' : '#6b7280', border: `1.5px solid ${sync ? '#2563eb' : '#e5e7eb'}`, backgroundColor: sync ? 'rgba(37,99,235,0.08)' : '#fff' }}
        >
          {sync ? <LinkRounded sx={{ fontSize: 15 }} /> : <LinkOffRounded sx={{ fontSize: 15 }} />} Sync views
        </Box>
      </Box>
    </Box>
  );
}
