import React, { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { FullscreenRounded, ImageNotSupportedRounded, ViewInArRounded } from '@mui/icons-material';
import '@photo-sphere-viewer/core/index.css';
import { colors } from '@theme/tokens';
import { formatDateTime } from '@/utils/dateFormat';
import type { EvidenceItem } from '@/utils/evidenceImages';
import { evidenceTitle } from '@/utils/evidenceImages';
import {
  classifyProjection, zoomFromHfov, type PanoramaSource, type Projection,
} from '@/utils/panoramaSource';

type PsvViewer = import('@photo-sphere-viewer/core').Viewer;

const MIN_FOV = 30;
const MAX_FOV = 90;
/** Start a viewer a little before the card scrolls into sight, and drop it once it is well out of sight. */
const MOUNT_MARGIN = '300px';

type ViewStatus = 'idle' | 'loading' | 'ready' | 'error';

/** True while the element is on (or just about to be on) screen. Lets a page keep a live WebGL viewer on only a few cards. */
export function useNearViewport(hostRef: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(
      entries => { for (const e of entries) setNear(e.isIntersecting); },
      { rootMargin: MOUNT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hostRef]);
  return near;
}

/** A draggable 360 view that fills its (position: relative) parent. Shared by Evidence images and Capture History. */
export function PanoramaView({ source, mounted, showHint = true }: { source: PanoramaSource; mounted: boolean; showHint?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PsvViewer | null>(null);
  // A stitched panorama is known to be 360. A raw upload is probed first (it may be a plain photo).
  const [projection, setProjection] = useState<Projection | null>(source.stitched ? 'equirectangular' : null);
  const [status, setStatus] = useState<ViewStatus>('idle');
  const url = source.url;

  // Probe a raw upload once it is wanted. Skipped for stitched files, which saves downloading them twice.
  useEffect(() => {
    if (!mounted || !url || projection !== null) return;
    let cancelled = false;
    setStatus('loading');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (!cancelled) setProjection(classifyProjection(img)); };
    img.onerror = () => { if (!cancelled) setStatus('error'); };
    img.src = url;
    return () => { cancelled = true; };
  }, [mounted, url, projection]);

  // The sphere viewer: one live viewer while the card is on screen, none otherwise.
  useEffect(() => {
    const is360 = projection === 'equirectangular' || projection === 'dualfisheye';
    if (!mounted || !url || !is360 || !containerRef.current) {
      if (!mounted) setStatus('idle');
      return;
    }
    let destroyed = false;
    setStatus('loading');
    const isDual = projection === 'dualfisheye';
    const o = source.orientation;

    void (async () => {
      try {
        const { Viewer, DualFisheyeAdapter } = await import('@photo-sphere-viewer/core');
        if (destroyed || !containerRef.current) return;
        const viewer = new Viewer({
          container: containerRef.current,
          panorama: url,
          ...(isDual ? { adapter: DualFisheyeAdapter } : {}),
          navbar: false,
          loadingTxt: '',
          loadingImg: '',
          minFov: MIN_FOV,
          maxFov: MAX_FOV,
          defaultZoomLvl: zoomFromHfov(o.initialHorizontalFovDegrees, MIN_FOV, MAX_FOV),
          defaultYaw: isDual ? Math.PI : `${o.initialViewHeadingDegrees}deg`,
          defaultPitch: `${o.initialViewPitchDegrees}deg`,
          // Drag with one finger or the mouse, zoom with the wheel or a pinch.
          touchmoveTwoFingers: false,
          mousewheelCtrlKey: false,
          moveInertia: true,
          ...(isDual ? {} : {
            // Cloudinary can strip the JPEG's own orientation tags, so pass the pose explicitly (as the tour viewer does).
            panoData: (image: { width: number; height: number }) => ({
              fullWidth: image.width, fullHeight: image.height, croppedWidth: image.width, croppedHeight: image.height,
              croppedX: 0, croppedY: 0,
              poseHeading: o.poseHeadingDegrees, posePitch: o.posePitchDegrees, poseRoll: o.poseRollDegrees,
              initialHeading: o.initialViewHeadingDegrees, initialPitch: o.initialViewPitchDegrees,
              initialFov: o.initialHorizontalFovDegrees,
            }),
          }),
        });
        viewerRef.current = viewer;
        viewer.addEventListener('ready', () => { if (!destroyed) setStatus('ready'); });

        // One automatic retry that bypasses the HTTP cache: an image cached earlier by a plain <img> (no CORS headers)
        // is reused for this cross-origin fetch and fails as "blocked by CORS". A fresh network fetch fixes that.
        let retried = false;
        const onFail = () => {
          if (destroyed) return;
          if (retried || isDual) { setStatus('error'); return; }
          retried = true;
          void (async () => {
            try {
              const res = await fetch(url, { cache: 'reload', mode: 'cors' });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const blobUrl = URL.createObjectURL(await res.blob());
              if (destroyed) { URL.revokeObjectURL(blobUrl); return; }
              await viewer.setPanorama(blobUrl);
              if (!destroyed) setStatus('ready');
            } catch {
              if (!destroyed) setStatus('error');
            }
          })();
        };
        viewer.addEventListener('panorama-error' as never, onFail);
        viewer.addEventListener('error' as never, onFail);
      } catch {
        if (!destroyed) setStatus('error');
      }
    })();

    return () => {
      destroyed = true;
      if (viewerRef.current) {
        try { viewerRef.current.destroy(); } catch { /* already gone */ }
        viewerRef.current = null;
      }
    };
  }, [mounted, url, projection, source.orientation]);

  const fullscreen = () => { try { viewerRef.current?.toggleFullscreen(); } catch { /* not ready */ } };

  if (!url) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'center', justifyContent: 'center' }}>
        <ImageNotSupportedRounded sx={{ fontSize: 30, color: 'rgba(255,255,255,0.4)' }} />
        <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>No image available</Typography>
      </Box>
    );
  }

  if (projection === 'flat') {
    // Not a 360: show it as a normal photo rather than pretending.
    return (
      <>
        <Box component="img" src={url} alt="Evidence photo" onError={() => setStatus('error')}
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
        <Box sx={{ position: 'absolute', left: 10, bottom: 10, px: 1, py: 0.25, borderRadius: '6px', backgroundColor: 'rgba(15,23,42,0.78)', color: '#fff', fontSize: '0.6875rem', fontWeight: 600 }}>
          Standard photo, not a 360
        </Box>
        {status === 'error' && <Overlay icon="error" text="Could not load this image" />}
      </>
    );
  }

  return (
    <>
      <Box ref={containerRef} data-testid="evidence-panorama" sx={{ position: 'absolute', inset: 0 }} />
      {status !== 'ready' && (
        <Overlay
          icon={status === 'error' ? 'error' : 'loading'}
          text={status === 'error' ? 'Could not load this panorama' : mounted ? 'Loading panorama…' : '360 panorama'}
        />
      )}
      {status === 'ready' && (
        <>
          <IconButton
            onClick={fullscreen} size="small" aria-label="Full screen"
            sx={{ position: 'absolute', top: 8, right: 8, color: '#fff', backgroundColor: 'rgba(15,23,42,0.6)', '&:hover': { backgroundColor: 'rgba(15,23,42,0.85)' }, zIndex: 3 }}
          >
            <FullscreenRounded sx={{ fontSize: 20 }} />
          </IconButton>
          {showHint && (
            <Box sx={{ position: 'absolute', left: 10, bottom: 10, px: 1, py: 0.25, borderRadius: '6px', backgroundColor: 'rgba(15,23,42,0.7)', color: '#fff', fontSize: '0.6875rem', fontWeight: 600, pointerEvents: 'none', zIndex: 3 }}>
              Drag to look around · scroll or pinch to zoom
            </Box>
          )}
        </>
      )}
    </>
  );
}

function Overlay({ icon, text }: { icon: 'loading' | 'error'; text: string }) {
  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, px: 2, textAlign: 'center', pointerEvents: 'none', zIndex: 2 }}>
      {icon === 'error'
        ? <ImageNotSupportedRounded sx={{ fontSize: 32, color: 'rgba(255,255,255,0.45)' }} />
        : <ViewInArRounded sx={{ fontSize: 34, color: 'rgba(255,255,255,0.35)' }} />}
      <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>{text}</Typography>
    </Box>
  );
}

const ROLE_LABEL = { direct: 'Direct evidence', inferred: 'Inferred evidence' } as const;

/**
 * One evidence capture as a draggable 360 panorama with its facts. The sphere viewer only exists while the card is
 * near the screen, so a page with many evidence images never holds more than a few WebGL contexts at once.
 */
export default function EvidencePanoramaCard({
  item, source,
}: {
  item: EvidenceItem;
  /** null while the capture is still being fetched */
  source: PanoramaSource | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(hostRef);

  const date = formatDateTime(item.capturedAt);
  const role = ROLE_LABEL[item.role] ?? 'Evidence';
  return (
    <Box
      data-testid="evidence-card"
      sx={{ borderRadius: '14px', overflow: 'hidden', border: `1px solid ${colors.borderLight}`, backgroundColor: '#fff' }}
    >
      <Box ref={hostRef} sx={{ position: 'relative', height: { xs: 260, sm: 340, md: 380 }, backgroundColor: '#0f1929' }}>
        {source
          ? <PanoramaView source={source} mounted={near} />
          : <Overlay icon="loading" text="Loading…" />}
      </Box>
      <Box sx={{ p: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.25 }}>
          <Box
            component="span"
            sx={{
              px: 0.75, py: 0.125, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700,
              color: item.role === 'direct' ? colors.success : colors.info,
              backgroundColor: item.role === 'direct' ? colors.successBg : colors.infoBg,
            }}
          >
            {role}
          </Box>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong }}>{evidenceTitle(item)}</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
          {date}
          {item.views.length > 0 ? ` · Seen in: ${item.views.join(', ')}` : ''}
        </Typography>
      </Box>
    </Box>
  );
}
