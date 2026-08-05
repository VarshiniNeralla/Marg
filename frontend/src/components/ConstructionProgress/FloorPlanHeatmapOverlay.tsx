import React, { useState } from 'react';
import { Box, Typography, Modal, IconButton, CircularProgress } from '@mui/material';
import { MapRounded, CloseRounded, ImageNotSupportedRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { getCapturePinsByFloorPlan } from '@store/workflowSelectors';
import type {
  HeatmapPinMarker,
  RoomHeatmapEntry,
  RoomHeatmapState,
} from '@/services/constructionProgressService';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

/** Fold legacy "uploaded" into in_progress — capture always implies work underway. */
function displayState(state: RoomHeatmapState): Exclude<RoomHeatmapState, 'uploaded'> {
  return state === 'uploaded' ? 'in_progress' : state;
}

const STATE_COLOR: Record<Exclude<RoomHeatmapState, 'uploaded'>, string> = {
  no_images: '#cbd5e1',
  in_progress: colors.warning,
  completed: colors.success,
};

const STATE_LABEL: Record<Exclude<RoomHeatmapState, 'uploaded'>, string> = {
  no_images: 'No Photos Uploaded Yet',
  in_progress: 'Work In Progress',
  completed: 'Completed',
};

const LEGEND_STATES: Array<Exclude<RoomHeatmapState, 'uploaded' | 'no_images'>> = [
  'in_progress',
  'completed',
];

function polygonToPoints(polygon: RoomHeatmapEntry['polygon']): string {
  return polygon.map(p => `${p.x},${p.y}`).join(' ');
}

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

/** Only keep colored rooms that belong to at least one photographed pin tip. */
function roomsAlignedToPins(
  rooms: RoomHeatmapEntry[],
  pins: Array<{ x: number; y: number }>,
  heatmapPins?: HeatmapPinMarker[],
): RoomHeatmapEntry[] {
  const colored = rooms.filter(r => displayState(r.state) !== 'no_images' && r.polygon?.length);
  if (heatmapPins && heatmapPins.length > 0) {
    // Name match alone is not enough — overlapping AABBs from neighbour flats
    // must not paint wash unless the attributed pin tip is inside the box.
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

type RoomPanelInfo = {
  roomName: string;
  flatName: string;
  state: RoomHeatmapState;
  capturesCount: number;
  pinLabel?: string;
};

function RoomDetailPanel({ room, onClose }: { room: RoomPanelInfo; onClose: () => void }) {
  const state = displayState(room.state);
  return (
    <Modal open onClose={onClose} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box sx={{ width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: '16px', p: 3, outline: 'none' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 700, color: colors.textStrong }}>
            {room.roomName}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseRounded sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>
        <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 0.75 }}>
          {room.flatName}
        </Typography>
        {room.pinLabel && (
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.primary, mb: 2 }}>
            {room.pinLabel}
          </Typography>
        )}
        <Box
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5,
            borderRadius: '8px', backgroundColor: `${STATE_COLOR[state]}18`, mb: 2,
          }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATE_COLOR[state] }} />
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: STATE_COLOR[state] }}>
            {STATE_LABEL[state]}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.875rem', color: colors.textBody }}>
          {state === 'no_images'
            ? 'No 360° capture has been taken in this room yet — ask the field engineer to photograph it so it can be included in the next analysis.'
            : `${room.capturesCount} capture${room.capturesCount === 1 ? '' : 's'} analyzed for this room.`}
        </Typography>
      </Box>
    </Modal>
  );
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
  const [selectedRoom, setSelectedRoom] = useState<RoomPanelInfo | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const allPins = useWorkflowStore(s => s.capturePins);
  const livePins = floorPlanId ? getCapturePinsByFloorPlan(allPins, floorPlanId) : [];

  // Snapshot pins keep markers glued to the boxes from the same analysis.
  // Live pins are a fallback for older snapshots that predate heatmapPins.
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
      ? heatmapPins.map(p => ({
          id: p.pinId,
          sequenceNumber: p.sequenceNumber,
          x: p.x,
          y: p.y,
          roomName: p.roomName,
          flatName: p.flatName,
          state: p.state,
          capturesCount: p.capturesCount,
        }))
      : livePins.map(p => ({
          id: p.id,
          sequenceNumber: p.sequenceNumber,
          x: p.x,
          y: p.y,
        }));

  const visibleRooms = roomsAlignedToPins(rooms, pins, heatmapPins);

  const noImageCount = rooms.filter(r => displayState(r.state) === 'no_images').length;
  const coverageGapShare = rooms.length > 0 ? noImageCount / rooms.length : 0;

  function openPinRoom(pin: (typeof pins)[number]) {
    // Prefer the pin's attributed room from the analysis snapshot — never
    // resolve via overlapping polygons (that was the wrong-room click bug).
    if (pin.roomName && pin.flatName) {
      setSelectedRoom({
        roomName: pin.roomName,
        flatName: pin.flatName,
        state: pin.state ?? 'in_progress',
        capturesCount: pin.capturesCount ?? 1,
        pinLabel: `Pin ${pin.sequenceNumber}`,
      });
      return;
    }
    const match = visibleRooms.find(r => pointInPolygon(pin.x, pin.y, r.polygon));
    if (match) {
      setSelectedRoom({
        roomName: match.roomName,
        flatName: match.flatName,
        state: match.state,
        capturesCount: match.capturesCount,
        pinLabel: `Pin ${pin.sequenceNumber}`,
      });
    }
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
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {LEGEND_STATES.map(state => (
            <Box key={state} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 9, height: 9, borderRadius: '3px', backgroundColor: STATE_COLOR[state] }} />
              <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>{STATE_LABEL[state]}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {coverageGapShare >= 0.5 && (
        <Box sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2, px: 1.5, py: 1.125,
          borderRadius: '10px', backgroundColor: `${STATE_COLOR.no_images}22`, border: `1px solid ${STATE_COLOR.no_images}`,
        }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATE_COLOR.no_images, flexShrink: 0, mt: 0.5 }} />
          <Typography sx={{ fontSize: '0.8125rem', color: P.strong, lineHeight: 1.5 }}>
            <strong>{noImageCount} of {rooms.length} rooms</strong> have no photos uploaded yet — this is a
            coverage gap, not an analysis error. Unmarked rooms on the floor plan will get a color once a
            field engineer captures a 360° photo there.
          </Typography>
        </Box>
      )}

      {!floorPlanImageUrl || rooms.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4, color: P.muted }}>
          <ImageNotSupportedRounded sx={{ fontSize: 28, mb: 1 }} />
          <Typography sx={{ fontSize: '0.8125rem' }}>No floor plan or room map available yet.</Typography>
        </Box>
      ) : (
        <Box sx={{ position: 'relative', width: '100%', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${colors.borderLight}` }}>
          {!imgLoaded && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={22} sx={{ color: colors.primary }} />
            </Box>
          )}
          <Box sx={{ position: 'relative', display: imgLoaded ? 'block' : 'none' }}>
            <Box
              component="img"
              src={floorPlanImageUrl}
              alt="Floor plan"
              onLoad={() => setImgLoaded(true)}
              sx={{ width: '100%', display: 'block' }}
            />
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            >
              {/* Room progress wash — visual only. Room identity comes from
                  clicking a pin (heatmapPins attribution), not overlapping boxes. */}
              {visibleRooms.map((room, i) => {
                const state = displayState(room.state);
                return (
                  <polygon
                    key={i}
                    points={polygonToPoints(room.polygon)}
                    fill={STATE_COLOR[state]}
                    fillOpacity={0.12}
                    stroke={STATE_COLOR[state]}
                    strokeOpacity={0.45}
                    strokeWidth={0.2}
                  />
                );
              })}
            </svg>

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
                  transform: 'translate(-50%, -100%)', zIndex: 2,
                  cursor: 'pointer',
                  '&:hover > div': { transform: 'rotate(-45deg) scale(1.08)' },
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
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {selectedRoom && (
        <RoomDetailPanel room={selectedRoom} onClose={() => setSelectedRoom(null)} />
      )}
    </Box>
  );
}
