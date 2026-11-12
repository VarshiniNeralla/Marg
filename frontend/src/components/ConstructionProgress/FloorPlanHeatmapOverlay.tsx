import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, Button } from '@mui/material';
import { MapRounded, ImageNotSupportedRounded, RefreshRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { resolveMediaUrl } from '@/config/env';
import { useWorkflowStore } from '@store/workflowStore';
import { getCapturePinsForFloor } from '@store/workflowSelectors';
import type {
  HeatmapPinMarker,
  RoomHeatmapEntry,
  RoomHeatmapState,
} from '@/services/constructionProgressService';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

/** If the floor plan has not loaded after this long, stop the spinner and offer Retry. */
const IMAGE_TIMEOUT_MS = 20_000;
const IMAGE_ERROR_TEXT = 'The floor plan image could not be loaded.';
const IMAGE_TIMEOUT_TEXT = 'The floor plan took too long to load.';

function pointInPolygon(x: number, y: number, polygon: RoomHeatmapEntry['polygon']): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if ((yi > y) !== (yj > y) && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Rooms used only for pin-click fallback when a snapshot lacks pin attribution. */
function roomsAlignedToPins(
  rooms: RoomHeatmapEntry[],
  pins: Array<{ x: number; y: number }>,
  heatmapPins?: HeatmapPinMarker[],
): RoomHeatmapEntry[] {
  const colored = rooms.filter(r => r.state !== 'no_images' && r.polygon?.length);
  if (heatmapPins && heatmapPins.length > 0) {
    return colored.filter(room => {
      if (/^Pin\s+\d+$/i.test(room.roomName)) {
        const seq = Number(room.roomName.replace(/^Pin\s+/i, ''));
        const hp = heatmapPins.find(p => p.sequenceNumber === seq);
        if (hp && !/^Pin\s+\d+$/i.test(hp.roomName) && hp.roomName !== 'Unknown') {
          return false;
        }
        return true;
      }
      const attributed = heatmapPins.filter(p =>
        p.flatName === room.flatName
        && p.roomName.localeCompare(room.roomName, undefined, { sensitivity: 'base' }) === 0,
      );
      return attributed.some(p => pointInPolygon(p.x, p.y, room.polygon));
    });
  }
  if (pins.length === 0) return colored;
  return colored.filter(room => pins.some(p => pointInPolygon(p.x, p.y, room.polygon)));
}

/** Upload/capture order 1..N — same rule as Capture Workflow (not layout stop #). */
function uploadSequenceByPinId(
  pins: Array<{ id: string; sequenceNumber: number; captureIds: string[] }>,
  captures: Array<{ id: string; capturedAt?: string; uploadedAt?: string }>,
): Map<string, number> {
  const captureTime = (captureIds: string[]) => {
    let earliest = Number.POSITIVE_INFINITY;
    for (const cid of captureIds) {
      const c = captures.find(x => x.id === cid);
      if (!c) continue;
      const ms = Date.parse(c.capturedAt || c.uploadedAt || '');
      if (Number.isFinite(ms) && ms < earliest) earliest = ms;
    }
    return earliest;
  };
  const numbered = [...pins]
    .filter(p => p.captureIds.length > 0)
    .sort((a, b) => {
      const ta = captureTime(a.captureIds);
      const tb = captureTime(b.captureIds);
      if (ta !== tb) return ta - tb;
      return a.sequenceNumber - b.sequenceNumber;
    });
  return new Map(numbered.map((p, i) => [p.id, i + 1]));
}

export default function FloorPlanHeatmapOverlay({
  floorPlanImageUrl,
  floorPlanId,
  rooms,
  heatmapPins,
}: {
  floorPlanImageUrl: string;
  floorPlanId: string;
  rooms: RoomHeatmapEntry[];
  /** Frozen at analysis — preferred over live workflow pins when present. */
  heatmapPins?: HeatmapPinMarker[];
}) {
  const [selectedPin, setSelectedPin] = useState<{ id: string; label: string } | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Stored URLs are either a relative /media/... path (auth-gated, needs the API base and token)
  // or an absolute Cloudinary URL; resolveMediaUrl handles both.
  const imageSrc = useMemo(() => resolveMediaUrl(floorPlanImageUrl) ?? '', [floorPlanImageUrl]);

  useEffect(() => {
    setImgLoaded(false);
    setImgError(null);
  }, [imageSrc]);

  // Safeguard: never spin forever, even if neither onLoad nor onError fires.
  useEffect(() => {
    if (!imageSrc || imgLoaded || imgError) return undefined;
    const id = window.setTimeout(() => setImgError(IMAGE_TIMEOUT_TEXT), IMAGE_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [imageSrc, imgLoaded, imgError, reloadKey]);

  function retryImage() {
    setImgLoaded(false);
    setImgError(null);
    setReloadKey(k => k + 1);
  }
  const allPins = useWorkflowStore(s => s.capturePins);
  const allCaptures = useWorkflowStore(s => s.captures);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const floorId = floorPlans.find(fp => fp.id === floorPlanId)?.floorId ?? null;
  const livePins = floorId ? getCapturePinsForFloor(allPins, floorId, floorPlanId) : [];
  const uploadSeq = useMemo(
    () => uploadSequenceByPinId(livePins, allCaptures),
    [livePins, allCaptures],
  );

  // Snapshot pins keep markers at analysis positions; numbers follow engineer
  // upload order (live when available, else snapshot sequence after re-analyze).
  const pins: Array<{
    id: string;
    sequenceNumber: number;
    x: number;
    y: number;
    roomName?: string;
    flatName?: string;
    state?: RoomHeatmapState;
    capturesCount?: number;
  }> =
    heatmapPins && heatmapPins.length > 0
      ? (() => {
          const mapped = heatmapPins.map(p => ({
            id: p.pinId,
            sequenceNumber: uploadSeq.get(p.pinId) ?? p.sequenceNumber,
            x: p.x,
            y: p.y,
            roomName: p.roomName,
            flatName: p.flatName,
            state: p.state,
            capturesCount: p.capturesCount,
          }));
          // If live upload order covers every snapshot pin, re-index 1..N tightly.
          if (mapped.every(p => uploadSeq.has(p.id))) {
            return [...mapped]
              .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
              .map((p, i) => ({ ...p, sequenceNumber: i + 1 }));
          }
          return mapped;
        })()
      : (() => {
          const withCaptures = livePins.filter(p => p.captureIds.length > 0);
          return withCaptures.map(p => ({
            id: p.id,
            sequenceNumber: uploadSeq.get(p.id) ?? p.sequenceNumber,
            x: p.x,
            y: p.y,
          }));
        })();

  const visibleRooms = roomsAlignedToPins(rooms, pins, heatmapPins);

  function openPinRoom(pin: (typeof pins)[number]) {
    // Prefer the pin's attributed room from the analysis snapshot - never
    // resolve via overlapping polygons (that was the wrong-room click bug).
    let label = pin.roomName && pin.flatName ? `${pin.flatName} - ${pin.roomName}` : null;
    if (!label) {
      const match = visibleRooms.find(r => pointInPolygon(pin.x, pin.y, r.polygon));
      if (match) label = `${match.flatName} - ${match.roomName}`;
    }
    setSelectedPin(prev => (prev?.id === pin.id ? null : { id: pin.id, label: label ?? 'Room not identified' }));
  }

  return (
    <Box sx={{ p: 3, borderRadius: '14px', backgroundColor: P.white, border: `1.5px solid ${P.border}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MapRounded sx={{ fontSize: 18, color: P.muted }} />
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }}>
            Floor Plan Heatmap
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>Tap a pin to see its room</Typography>
      </Box>

      {!imageSrc ? (
        <Box sx={{ textAlign: 'center', py: 4, color: P.muted }}>
          <ImageNotSupportedRounded sx={{ fontSize: 28, mb: 1 }} />
          <Typography sx={{ fontSize: '0.8125rem' }}>No floor plan or room map available yet.</Typography>
        </Box>
      ) : (
        <Box sx={{ position: 'relative', width: '100%', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${colors.borderLight}` }}>
          {imgError && (
            <Box role="alert" sx={{ textAlign: 'center', py: 5, px: 2, color: P.muted }}>
              <ImageNotSupportedRounded sx={{ fontSize: 28, mb: 1 }} />
              <Typography sx={{ fontSize: '0.8125rem', mb: 1.5 }}>{imgError}</Typography>
              <Button
                onClick={retryImage}
                startIcon={<RefreshRounded sx={{ fontSize: 18 }} />}
                sx={{
                  minHeight: 44, px: 2.5, borderRadius: '10px', textTransform: 'none', fontWeight: 700,
                  border: `1.5px solid ${P.border}`, color: P.strong,
                  '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
                }}
              >
                Retry
              </Button>
            </Box>
          )}
          {!imgLoaded && !imgError && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={22} sx={{ color: colors.primary }} />
            </Box>
          )}
          <Box
            sx={{ position: 'relative', display: imgLoaded && !imgError ? 'block' : 'none' }}
            onClick={() => setSelectedPin(null)}
          >
            <Box
              key={reloadKey}
              component="img"
              src={imageSrc}
              alt="Floor plan"
              onLoad={() => { setImgLoaded(true); setImgError(null); }}
              onError={() => setImgError(IMAGE_ERROR_TEXT)}
              sx={{ width: '100%', display: 'block' }}
            />
            {/* Pin markers — clickable; open the attributed room panel. */}
            {pins.map(pin => (
              <Box
                key={pin.id}
                onClick={(e) => {
                  e.stopPropagation();
                  openPinRoom(pin);
                }}
                sx={{
                  position: 'absolute', left: `${pin.x}%`, top: `${pin.y}%`,
                  transform: 'translate(-50%, -100%)', zIndex: selectedPin?.id === pin.id ? 5 : 2,
                  cursor: 'pointer',
                  '&:hover > div:first-of-type': { transform: 'rotate(-45deg) scale(1.08)' },
                }}
              >
                <Box
                  sx={{
                    width: 22, height: 22, borderRadius: '50% 50% 50% 0',
                    transform: 'rotate(-45deg)', backgroundColor: colors.primary,
                    border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'transform 0.12s ease',
                  }}
                >
                  <Typography sx={{ fontSize: '0.625rem', fontWeight: 800, color: '#fff', transform: 'rotate(45deg)' }}>
                    {pin.sequenceNumber}
                  </Typography>
                </Box>
                {selectedPin?.id === pin.id && (
                  <Box
                    role="status"
                    sx={{
                      position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', mb: 0.75,
                      px: 1.25, py: 0.625, borderRadius: '8px', whiteSpace: 'nowrap', pointerEvents: 'none',
                      backgroundColor: 'rgba(17,24,39,0.92)', color: '#fff', fontSize: '0.8125rem', fontWeight: 600,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}
                  >
                    {selectedPin.label}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

    </Box>
  );
}
