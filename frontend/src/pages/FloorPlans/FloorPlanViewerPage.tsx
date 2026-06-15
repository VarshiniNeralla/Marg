import React, { useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tooltip } from '@mui/material';
import {
  ArrowBackRounded, ZoomInRounded, ZoomOutRounded, FullscreenRounded,
  FullscreenExitRounded, CenterFocusStrongRounded, UploadFileRounded,
  LayersRounded, RoomRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { getProjectById, mockTowers, getFloorPlanByFloor, getFloors, statusConfig } from '@/data/mockData';
import type { MockRoomMarker } from '@/data/mockData';

const roomStatusColor: Record<string, { fill: string; stroke: string; label: string }> = {
  not_started: { fill: 'rgba(100,116,139,0.15)', stroke: '#64748b', label: 'Not Started' },
  in_progress: { fill: 'rgba(217,119,6,0.15)',   stroke: '#d97706', label: 'In Progress' },
  reviewed:    { fill: 'rgba(37,99,235,0.15)',    stroke: '#2563eb', label: 'Reviewed' },
  published:   { fill: 'rgba(22,163,74,0.15)',    stroke: '#16a34a', label: 'Published' },
};

function RoomActionPanel({ room, onClose }: { room: MockRoomMarker; onClose: () => void }) {
  const sc = roomStatusColor[room.status];
  return (
    <Box sx={{ position: 'absolute', top: 16, right: 16, width: 260, borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 12px 40px rgba(15,23,42,0.14)', zIndex: 10, overflow: 'hidden' }}>
      <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>Room {room.number}</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{room.name}</Typography>
        </Box>
        <Box onClick={onClose} sx={{ cursor: 'pointer', color: colors.textSubdued, display: 'flex', alignItems: 'center', fontSize: 18, '&:hover': { color: colors.textStrong } }}>✕</Box>
      </Box>
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
          <Chip label={sc.label} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, color: sc.stroke, backgroundColor: sc.fill, borderRadius: '6px' }} />
          <Chip label={room.type} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 500, color: colors.textSecondary, backgroundColor: colors.bgDeep, borderRadius: '6px', textTransform: 'capitalize' }} />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {room.captureId && (
            <Box component={Link} to={`/captures/${room.captureId}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '8px', backgroundColor: colors.primarySoft, color: colors.primary, fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', '&:hover': { backgroundColor: colors.primaryRing } }}>
              📷 Open Capture
            </Box>
          )}
          {room.tourId && (
            <Box component={Link} to={`/tours/${room.tourId}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '8px', backgroundColor: 'rgba(124,58,237,0.08)', color: '#7c3aed', fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(124,58,237,0.14)' } }}>
              🔮 Open Tour
            </Box>
          )}
          <Box component={Link} to="/captures" sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '8px', border: `1px dashed ${colors.border}`, color: colors.textMuted, fontSize: '0.8125rem', fontWeight: 500, textDecoration: 'none', '&:hover': { borderColor: colors.primary, color: colors.primary } }}>
            ⬆ Upload Capture
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default function FloorPlanViewerPage() {
  const { projectId, towerId, floorId } = useParams<{ projectId: string; towerId: string; floorId: string }>();
  const project = getProjectById(projectId ?? '');
  const tower = mockTowers.find(t => t.id === towerId);
  const floors = getFloors(towerId ?? '');
  const floor = floors.find(f => f.id === floorId);
  const floorPlan = getFloorPlanByFloor(towerId ?? '', floorId ?? '');

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<MockRoomMarker | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const zoom = useCallback((dir: 1 | -1) => {
    setScale(s => Math.min(4, Math.max(0.4, s + dir * 0.2)));
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({ x: dragStart.current.ox + e.clientX - dragStart.current.x, y: dragStart.current.oy + e.clientY - dragStart.current.y });
  };
  const handleMouseUp = () => setIsDragging(false);

  if (!project || !tower || !floor) return <Box sx={{ p: 4, color: colors.textMuted }}>Floor not found.</Box>;

  const statusCounts = floorPlan ? {
    not_started: floorPlan.rooms.filter(r => r.status === 'not_started').length,
    in_progress: floorPlan.rooms.filter(r => r.status === 'in_progress').length,
    reviewed: floorPlan.rooms.filter(r => r.status === 'reviewed').length,
    published: floorPlan.rooms.filter(r => r.status === 'published').length,
  } : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: fullscreen ? '100vh' : 'auto' }}>
      {/* Header */}
      {!fullscreen && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <Box component={Link} to={`/projects/${projectId}/towers/${towerId}`} sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', '&:hover': { color: colors.textStrong } }}>
            <ArrowBackRounded sx={{ fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 0.25 }}>{project.name} · {tower.name}</Typography>
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>
              {floor.label} — Floor Plan
            </Typography>
          </Box>
          {!floorPlan && (
            <Box component={Link} to={`/floor-plans/${projectId}/${towerId}/${floorId}/upload`} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
              <UploadFileRounded sx={{ fontSize: 16 }} /> Upload Floor Plan
            </Box>
          )}
        </Box>
      )}

      {/* Legend */}
      {!fullscreen && statusCounts && (
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
          {(Object.entries(roomStatusColor) as [string, typeof roomStatusColor[string]][]).map(([key, val]) => (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.5, borderRadius: '8px', backgroundColor: colors.card, boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '2px', backgroundColor: val.fill, border: `1.5px solid ${val.stroke}` }} />
              <Typography sx={{ fontSize: '0.75rem', color: colors.textSecondary, fontWeight: 500 }}>{val.label}</Typography>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: val.stroke }}>{statusCounts[key as keyof typeof statusCounts]}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Viewer area */}
      <Box sx={{ position: 'relative', flex: 1, borderRadius: fullscreen ? 0 : '20px', overflow: 'hidden', backgroundColor: colors.bgDeep, minHeight: 480, cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Grid background */}
        <Box sx={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${colors.borderLight} 1px, transparent 1px), linear-gradient(90deg, ${colors.borderLight} 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />

        {/* Transform wrapper */}
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Box sx={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transition: isDragging ? 'none' : `transform ${motion.durationFast}`, transformOrigin: 'center center', willChange: 'transform' }}>
            {floorPlan ? (
              /* Floor plan with SVG room overlays */
              <Box sx={{ position: 'relative', width: 600, height: 450, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 12px 40px rgba(15,23,42,0.12)' }}>
                {/* Floor plan background — architectural grid */}
                <Box sx={{ position: 'absolute', inset: 0, backgroundColor: '#f8f6f0', border: '2px solid #c8bfa0' }}>
                  {/* Structural walls */}
                  <Box sx={{ position: 'absolute', inset: '4%', border: '3px solid #8b7355' }} />
                  <Box sx={{ position: 'absolute', top: '4%', left: '50%', width: '3px', height: '92%', backgroundColor: '#8b7355' }} />
                  <Box sx={{ position: 'absolute', top: '50%', left: '4%', width: '92%', height: '3px', backgroundColor: '#8b7355' }} />
                </Box>

                {/* SVG room markers */}
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                  {floorPlan.rooms.map(room => {
                    const sc = roomStatusColor[room.status];
                    const rx = (room.x / 100) * 600;
                    const ry = (room.y / 100) * 450;
                    const rw = (room.width / 100) * 600;
                    const rh = (room.height / 100) * 450;
                    const isSelected = selectedRoom?.id === room.id;
                    return (
                      <g key={room.id} onClick={(e) => { e.stopPropagation(); setSelectedRoom(isSelected ? null : room); }} style={{ cursor: 'pointer' }}>
                        <rect x={rx} y={ry} width={rw} height={rh} fill={isSelected ? sc.stroke : sc.fill} fillOpacity={isSelected ? 0.35 : 1} stroke={sc.stroke} strokeWidth={isSelected ? 2.5 : 1.5} rx="4" />
                        <text x={rx + rw / 2} y={ry + rh / 2 - 6} textAnchor="middle" style={{ fontSize: '11px', fontWeight: 700, fill: isSelected ? '#fff' : sc.stroke, pointerEvents: 'none' }}>{room.number}</text>
                        <text x={rx + rw / 2} y={ry + rh / 2 + 8} textAnchor="middle" style={{ fontSize: '9px', fill: isSelected ? 'rgba(255,255,255,0.8)' : '#64748b', pointerEvents: 'none', textTransform: 'capitalize' }}>{room.type}</text>
                      </g>
                    );
                  })}
                </svg>

                {/* File info overlay */}
                <Box sx={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}>
                  <LayersRounded sx={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }} />
                  <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>{floorPlan.fileName}</Typography>
                </Box>
              </Box>
            ) : (
              /* No floor plan uploaded */
              <Box sx={{ width: 560, height: 420, borderRadius: '16px', border: `2px dashed ${colors.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: colors.card }}>
                <Box sx={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RoomRounded sx={{ fontSize: 28, color: colors.textSubdued }} />
                </Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: colors.textSecondary }}>No floor plan uploaded</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, textAlign: 'center', maxWidth: 280 }}>Upload a PDF, PNG, or JPG floor plan to enable room mapping and status overlays.</Typography>
                <Box component={Link} to={`/floor-plans/${projectId}/${towerId}/${floorId}/upload`} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', mt: 0.5 }}>
                  <UploadFileRounded sx={{ fontSize: 16 }} /> Upload Floor Plan
                </Box>
              </Box>
            )}
          </Box>
        </Box>

        {/* Controls */}
        <Box sx={{ position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Tooltip title="Zoom in" placement="right">
            <IconButton onClick={() => zoom(1)} size="small" sx={{ backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.08)', '&:hover': { backgroundColor: colors.bgDeep } }}>
              <ZoomInRounded sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Zoom out" placement="right">
            <IconButton onClick={() => zoom(-1)} size="small" sx={{ backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.08)', '&:hover': { backgroundColor: colors.bgDeep } }}>
              <ZoomOutRounded sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reset view" placement="right">
            <IconButton onClick={resetView} size="small" sx={{ backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.08)', '&:hover': { backgroundColor: colors.bgDeep } }}>
              <CenterFocusStrongRounded sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} placement="right">
            <IconButton onClick={() => setFullscreen(!fullscreen)} size="small" sx={{ backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.08)', '&:hover': { backgroundColor: colors.bgDeep } }}>
              {fullscreen ? <FullscreenExitRounded sx={{ fontSize: 18 }} /> : <FullscreenRounded sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
        </Box>

        {/* Zoom badge */}
        <Box sx={{ position: 'absolute', bottom: 12, right: 12, px: 1.25, py: 0.5, borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}>
          <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>{Math.round(scale * 100)}%</Typography>
        </Box>

        {/* Room action panel */}
        {selectedRoom && <RoomActionPanel room={selectedRoom} onClose={() => setSelectedRoom(null)} />}
      </Box>

      {/* Floor selector */}
      {!fullscreen && (
        <Box sx={{ mt: 3 }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 2 }}>Other Floors</Typography>
          <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1 }}>
            {getFloors(towerId ?? '').slice(0, 8).map(f => (
              <Box key={f.id} component={Link} to={`/floor-plans/${projectId}/${towerId}/${f.id}`}
                sx={{ flexShrink: 0, px: 2, py: 1, borderRadius: '8px', border: `1.5px solid ${f.id === floorId ? colors.primary : colors.borderLight}`, backgroundColor: f.id === floorId ? colors.primarySoft : colors.card, color: f.id === floorId ? colors.primary : colors.textSecondary, fontSize: '0.8125rem', fontWeight: f.id === floorId ? 700 : 400, textDecoration: 'none', transition: `all ${motion.durationFast}`, '&:hover': { borderColor: colors.primary, color: colors.primary } }}>
                {f.label}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
