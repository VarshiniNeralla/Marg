import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Grid, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, MenuItem } from '@mui/material';
import { ArrowBackRounded, CameraAltRounded, ViewInArRounded, AddRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { getProjectById, mockTowers, getFloors, getRooms } from '@/data/mockData';

const roomTypeIcon: Record<string, string> = {
  living: '🛋️', bedroom: '🛏️', kitchen: '🍳', bathroom: '🚿', balcony: '🌿', utility: '🔧',
};

const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'balcony', 'utility'];

export default function RoomListPage() {
  const { projectId, towerId, floorId } = useParams<{ projectId: string; towerId: string; floorId: string }>();
  const project = getProjectById(projectId ?? '');
  const tower = mockTowers.find(t => t.id === towerId);
  const floors = getFloors(towerId ?? '');
  const floor = floors.find(f => f.id === floorId);
  const [extraRooms, setExtraRooms] = useState(0);
  const [open, setOpen] = useState(false);
  const [roomForm, setRoomForm] = useState({ name: '', type: 'bedroom' });

  if (!project || !tower || !floor) return <Box sx={{ p: 4, color: colors.textMuted }}>Floor not found.</Box>;

  const rooms = getRooms(floorId ?? '', towerId ?? '', projectId ?? '');
  const allRooms = [...rooms, ...Array.from({ length: extraRooms }, (_, i) => ({
    id: `${floorId}-extra-${i}`,
    floorId: floorId ?? '',
    towerId: towerId ?? '',
    projectId: projectId ?? '',
    name: `Room (new ${i + 1})`,
    type: 'bedroom' as const,
    captureCount: 0,
    status: 'pending' as const,
    lastCaptured: null,
  }))];

  function handleAddRoom() {
    if (!roomForm.name.trim()) return;
    setExtraRooms(n => n + 1);
    setRoomForm({ name: '', type: 'bedroom' });
    setOpen(false);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 5 }}>
        <Box component={Link} to={`/projects/${project.id}/towers/${tower.id}`} sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 0.25 }}>{project.name} · {tower.name}</Typography>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>
            {floor.label}
          </Typography>
        </Box>
        <Box onClick={() => setOpen(true)} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
          <AddRounded sx={{ fontSize: 16 }} /> Add Room
        </Box>
      </Box>

      {/* Floor summary */}
      <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
        <Box sx={{ px: 2, py: 1, borderRadius: '8px', backgroundColor: colors.card, boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em' }}>{floor.rooms + extraRooms}</Typography>
          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>Total rooms</Typography>
        </Box>
        <Box sx={{ px: 2, py: 1, borderRadius: '8px', backgroundColor: colors.card, boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#16a34a', letterSpacing: '-0.03em' }}>{floor.mapped}</Typography>
          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>Captured</Typography>
        </Box>
        <Box sx={{ px: 2, py: 1, borderRadius: '8px', backgroundColor: colors.card, boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#d97706', letterSpacing: '-0.03em' }}>{floor.rooms - floor.mapped}</Typography>
          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>Pending</Typography>
        </Box>
      </Box>

      <Grid container spacing={2}>
        {allRooms.map(room => (
          <Grid key={room.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', transition: `all ${motion.durationNormal}`, '&:hover': { boxShadow: '0 8px 32px rgba(15,23,42,0.10)', transform: 'translateY(-2px)' } }}>
              {/* Thumbnail */}
              <Box sx={{ height: 100, background: room.status === 'captured' ? project.gradient : colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                <Typography sx={{ fontSize: '2rem' }}>{roomTypeIcon[room.type] ?? '🏠'}</Typography>
                <Chip
                  label={room.status === 'captured' ? 'Captured' : 'Pending'}
                  size="small"
                  sx={{ position: 'absolute', top: 8, right: 8, height: 18, fontSize: '0.5625rem', fontWeight: 700, borderRadius: '4px',
                    color: room.status === 'captured' ? '#16a34a' : '#64748b',
                    backgroundColor: room.status === 'captured' ? 'rgba(22,163,74,0.12)' : 'rgba(100,116,139,0.12)',
                  }}
                />
              </Box>
              <Box sx={{ p: 2 }}>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>{room.name}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 1.5, textTransform: 'capitalize' }}>{room.type}</Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {room.status === 'captured' ? (
                    <>
                      <Box component={Link} to="/captures" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: '8px', backgroundColor: colors.primarySoft, color: colors.primary, fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', '&:hover': { backgroundColor: colors.primaryRing } }}>
                        <CameraAltRounded sx={{ fontSize: 13 }} /> Captures ({room.captureCount})
                      </Box>
                      <Box component={Link} to="/tours" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: '8px', backgroundColor: 'rgba(124,58,237,0.08)', color: '#7c3aed', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(124,58,237,0.15)' } }}>
                        <ViewInArRounded sx={{ fontSize: 13 }} /> Tour
                      </Box>
                    </>
                  ) : (
                    <Box component={Link} to="/captures" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: '8px', border: `1px dashed ${colors.border}`, color: colors.textMuted, fontSize: '0.75rem', fontWeight: 500, textDecoration: 'none', '&:hover': { borderColor: colors.primary, color: colors.primary } }}>
                      <CameraAltRounded sx={{ fontSize: 13 }} /> Upload Capture
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Dialog open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 360 } } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Add Room</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField label="Room Name" value={roomForm.name} onChange={e => setRoomForm(f => ({ ...f, name: e.target.value }))} fullWidth placeholder="e.g. Master Bedroom" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <TextField select label="Room Type" value={roomForm.type} onChange={e => setRoomForm(f => ({ ...f, type: e.target.value }))} fullWidth sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}>
            {ROOM_TYPES.map(t => <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>)}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setOpen(false)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleAddRoom} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', background: colors.primaryGradient, boxShadow: 'none' }}>Add Room</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
