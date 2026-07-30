import React, { useState } from 'react';
import { Box, Typography, Modal, IconButton, CircularProgress } from '@mui/material';
import { MapRounded, CloseRounded, ImageNotSupportedRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { getCapturePinsByFloorPlan } from '@store/workflowSelectors';
import type { RoomHeatmapEntry, RoomHeatmapState } from '@/services/constructionProgressService';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

const STATE_COLOR: Record<RoomHeatmapState, string> = {
  no_images: '#cbd5e1',
  uploaded: colors.info,
  in_progress: colors.warning,
  completed: colors.success,
};

const STATE_LABEL: Record<RoomHeatmapState, string> = {
  no_images: 'No Photos Uploaded Yet',
  uploaded: 'Images Uploaded',
  in_progress: 'Work In Progress',
  completed: 'Completed',
};

function polygonToPoints(polygon: RoomHeatmapEntry['polygon']): string {
  return polygon.map(p => `${p.x},${p.y}`).join(' ');
}

function RoomDetailPanel({ room, onClose }: { room: RoomHeatmapEntry; onClose: () => void }) {
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
        <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 2 }}>
          {room.flatName}
        </Typography>
        <Box
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5,
            borderRadius: '8px', backgroundColor: `${STATE_COLOR[room.state]}18`, mb: 2,
          }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATE_COLOR[room.state] }} />
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: STATE_COLOR[room.state] }}>
            {STATE_LABEL[room.state]}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.875rem', color: colors.textBody }}>
          {room.state === 'no_images'
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
}: {
  floorPlanImageUrl: string;
  floorPlanId: string;
  rooms: RoomHeatmapEntry[];
}) {
  const [selectedRoom, setSelectedRoom] = useState<RoomHeatmapEntry | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const allPins = useWorkflowStore(s => s.capturePins);
  const pins = floorPlanId ? getCapturePinsByFloorPlan(allPins, floorPlanId) : [];

  const noImageCount = rooms.filter(r => r.state === 'no_images').length;
  const coverageGapShare = rooms.length > 0 ? noImageCount / rooms.length : 0;

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
          {/* 'no_images' is never drawn on the plan (see the polygon filter below),
              so it has no swatch here either — a legend entry for a color that
              never appears would just be confusing. */}
          {(Object.keys(STATE_COLOR) as RoomHeatmapState[]).filter(state => state !== 'no_images').map(state => (
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
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            >
              {/* Only rooms with real capture evidence get a colored box — a grey
                  box for every uncaptured room made the overlay unreadable (every
                  room on the floor outlined at once) and added no information the
                  plain floor plan underneath doesn't already show. A room with no
                  photos yet is simply left unmarked. */}
              {rooms.filter(room => room.state !== 'no_images').map((room, i) => (
                <polygon
                  key={i}
                  points={polygonToPoints(room.polygon)}
                  fill={STATE_COLOR[room.state]}
                  fillOpacity={0.35}
                  stroke={STATE_COLOR[room.state]}
                  strokeWidth={0.3}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedRoom(room)}
                />
              ))}
            </svg>

            {/* Pin markers — plain absolutely-positioned HTML, not part of the
                SVG above: that SVG uses preserveAspectRatio="none" (non-uniform
                stretch) to line polygons up with the floor plan image, which
                would visually distort a circle/number marker. Pins use the
                same %-based left/top + translate(-50%,-100%) convention as
                CaptureWorkflowPage.tsx's floor-plan pin markers. */}
            {pins.map(pin => (
              <Box
                key={pin.id}
                sx={{
                  position: 'absolute', left: `${pin.x}%`, top: `${pin.y}%`,
                  transform: 'translate(-50%, -100%)', zIndex: 2,
                }}
              >
                <Box
                  sx={{
                    width: 22, height: 22, borderRadius: '50% 50% 50% 0',
                    transform: 'rotate(-45deg)', backgroundColor: colors.primary,
                    border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
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
