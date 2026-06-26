import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Grid, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, MenuItem } from '@mui/material';
import { ArrowBackRounded, CameraAltRounded, ViewInArRounded, AddRounded, UploadFileRounded, MapRounded, CheckCircleRounded, HomeWorkRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isAdmin, isManager } from '@store/authStore';
import { getProjectById, getRoomsByFloor, getTourForCapture } from '@store/workflowSelectors';
import type { WfRoom } from '@store/workflowStore';

const roomTypeIcon: Record<string, string> = {
  living: '🛋️', bedroom: '🛏️', kitchen: '🍳', bathroom: '🚿', balcony: '🌿', utility: '🔧',
};

const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'balcony', 'utility'] as const;

export default function RoomListPage() {
  const { projectId, towerId, floorId } = useParams<{ projectId: string; towerId: string; floorId: string }>();
  const projects = useWorkflowStore(s => s.projects);
  const towers = useWorkflowStore(s => s.towers);
  const floors = useWorkflowStore(s => s.floors);
  const flats = useWorkflowStore(s => s.flats);
  const rooms = useWorkflowStore(s => s.rooms);
  const captures = useWorkflowStore(s => s.captures);
  const tours = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const createRoom = useWorkflowStore(s => s.createRoom);

  const project = getProjectById(projects, projectId ?? '');
  const tower = towers.find(t => t.id === towerId);
  const floor = floors.find(f => f.id === floorId);
  const floorRooms = getRoomsByFloor(rooms, floorId ?? '');
  const floorFlats = flats.filter(f => f.floorId === floorId);
  const floorPlan = floorPlans.find(fp => fp.floorId === floorId);

  const { user } = useAuthStore();
  const hasAdminRole = isAdmin(user) || isManager(user);

  const [open, setOpen] = useState(false);
  const [roomForm, setRoomForm] = useState({ name: '', type: 'bedroom' as WfRoom['type'] });

  if (!project || !tower || !floor) return <Box sx={{ p: 4, color: colors.textMuted }}>Floor not found.</Box>;

  const capturedCount = floorRooms.filter(r => captures.some(c => c.roomId === r.id)).length;
  const uploadUrl = `/floor-plans/${projectId}/${towerId}/${floorId}/upload`;

  function handleAddRoom() {
    const targetFlat = floorFlats[0];
    if (!roomForm.name.trim() || !targetFlat) return;
    createRoom(targetFlat.id, roomForm.name, roomForm.type);
    setRoomForm({ name: '', type: 'bedroom' });
    setOpen(false);
  }

  function roomStatus(room: WfRoom) {
    const cap = captures.find(c => c.roomId === room.id);
    if (!cap) return 'pending';
    if (cap.status === 'review') return 'review';
    if (cap.status === 'rejected') return 'rejected';
    return 'captured';
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <Box component={Link} to={`/projects/${project.id}/towers/${tower.id}`} sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 0.25 }}>
            {project.name} · {tower.name}
          </Typography>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>
            {floor.label}
          </Typography>
        </Box>
      </Box>

      {/* Floor Plan Section — primary action */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <MapRounded sx={{ fontSize: 18, color: colors.primary }} />
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>Floor Plan</Typography>
        </Box>

        {floorPlan ? (
          /* Floor plan exists — show status card */
          <Box sx={{ p: 3, borderRadius: '16px', border: `1.5px solid rgba(22,163,74,0.25)`, backgroundColor: 'rgba(22,163,74,0.04)', display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
              <Box sx={{ width: 48, height: 48, borderRadius: '12px', backgroundColor: 'rgba(22,163,74,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CheckCircleRounded sx={{ fontSize: 24, color: '#16a34a' }} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>
                  {floorPlan.fileName ?? 'Floor plan uploaded'}
                </Typography>
                <Typography sx={{ fontSize: '0.75rem', color: '#16a34a', mt: 0.25 }}>
                  Uploaded · {floorPlan.fileSizeMb ? `${floorPlan.fileSizeMb} MB` : floorPlan.fileType?.toUpperCase()}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
              <Box
                component={Link}
                to={`/floor-plans?project=${projectId}&tower=${towerId}`}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', border: `1px solid rgba(22,163,74,0.35)`, color: '#16a34a', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(22,163,74,0.08)' }, transition: `all ${motion.durationFast}` }}
              >
                <MapRounded sx={{ fontSize: 15 }} /> View
              </Box>
              <Box
                component={Link}
                to={uploadUrl}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', border: `1px solid ${colors.border}`, color: colors.textMuted, fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', '&:hover': { borderColor: colors.primary, color: colors.primary }, transition: `all ${motion.durationFast}` }}
              >
                <UploadFileRounded sx={{ fontSize: 15 }} /> Replace
              </Box>
            </Box>
          </Box>
        ) : (
          /* No floor plan — prominent upload CTA */
          <Box
            component={Link}
            to={uploadUrl}
            sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, p: 5, borderRadius: '16px', border: `2px dashed ${colors.border}`, backgroundColor: colors.card, textDecoration: 'none', transition: `all ${motion.durationNormal}`, '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft } }}
          >
            <Box sx={{ width: 56, height: 56, borderRadius: '16px', backgroundColor: colors.primarySoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UploadFileRounded sx={{ fontSize: 28, color: colors.primary }} />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.5 }}>
                Upload Floor Plan
              </Typography>
              <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>
                PDF, PNG, or JPG — up to 50 MB
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
              <UploadFileRounded sx={{ fontSize: 16 }} /> Add Floor Plan
            </Box>
          </Box>
        )}
      </Box>

      {/* Rooms section — hidden for admin, only shown to engineers */}
      {!hasAdminRole && <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CameraAltRounded sx={{ fontSize: 18, color: colors.textMuted }} />
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>Capture Rooms</Typography>
            <Box sx={{ display: 'flex', gap: 1, ml: 1 }}>
              <Chip label={`${floorRooms.length} rooms`} size="small" sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600, color: colors.textMuted, backgroundColor: colors.bgDeep, borderRadius: '5px' }} />
              {capturedCount > 0 && (
                <Chip label={`${capturedCount} captured`} size="small" sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600, color: '#16a34a', backgroundColor: 'rgba(22,163,74,0.08)', borderRadius: '5px' }} />
              )}
            </Box>
          </Box>
          {floorFlats.length > 0 && (
            <Box onClick={() => setOpen(true)} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.75, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
              <AddRounded sx={{ fontSize: 15 }} /> Add Room
            </Box>
          )}
        </Box>

        {floorRooms.length === 0 ? (
          <Box sx={{ py: 5, textAlign: 'center', color: colors.textMuted }}>
            <CameraAltRounded sx={{ fontSize: 36, mb: 1, opacity: 0.25 }} />
            <Typography sx={{ fontSize: '0.875rem' }}>No rooms yet. Add rooms to start capturing.</Typography>
          </Box>
        ) : (
          <>
            {floorFlats.map(flat => {
              const flatRooms = floorRooms.filter(room => room.flatId === flat.id);
              if (flatRooms.length === 0) return null;
              return (
                <Box key={flat.id} sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <HomeWorkRounded sx={{ fontSize: 16, color: colors.textMuted }} />
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{flat.number}</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>· {flat.type} · {flatRooms.length} rooms</Typography>
                  </Box>
                  <Grid container spacing={2}>
                    {flatRooms.map(room => {
                      const status = roomStatus(room);
                      const capture = captures.find(c => c.roomId === room.id);
                      const tour = capture ? getTourForCapture(tours, capture.id) : undefined;
                      const captureCount = captures.filter(c => c.roomId === room.id).length;
                      return (
                        <Grid key={room.id} size={{ xs: 12, sm: 6, md: 4 }}>
                          <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', transition: `all ${motion.durationNormal}`, '&:hover': { boxShadow: '0 8px 32px rgba(15,23,42,0.10)', transform: 'translateY(-2px)' } }}>
                            <Box sx={{ height: 80, background: status === 'captured' ? project.gradient : colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                              <Typography sx={{ fontSize: '1.75rem' }}>{roomTypeIcon[room.type] ?? '🏠'}</Typography>
                              <Chip label={status === 'captured' ? 'Captured' : status === 'review' ? 'In Review' : 'Pending'} size="small"
                                sx={{ position: 'absolute', top: 8, right: 8, height: 18, fontSize: '0.5625rem', fontWeight: 700, borderRadius: '4px',
                                  color: status === 'captured' ? '#16a34a' : status === 'review' ? '#d97706' : '#64748b',
                                  backgroundColor: status === 'captured' ? 'rgba(22,163,74,0.12)' : status === 'review' ? 'rgba(217,119,6,0.12)' : 'rgba(100,116,139,0.12)',
                                }} />
                            </Box>
                            <Box sx={{ p: 2 }}>
                              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>{room.name}</Typography>
                              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 1.5, textTransform: 'capitalize' }}>{room.type}</Typography>
                              <Box sx={{ display: 'flex', gap: 1 }}>
                                {capture ? (
                                  <>
                                    <Box component={Link} to={`/captures/${capture.id}`} sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: '8px', backgroundColor: colors.primarySoft, color: colors.primary, fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', '&:hover': { backgroundColor: colors.primaryRing } }}>
                                      <CameraAltRounded sx={{ fontSize: 13 }} /> Capture ({captureCount})
                                    </Box>
                                    {tour && (
                                      <Box component={Link} to={`/tours/${tour.id}`} sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: '8px', backgroundColor: 'rgba(124,58,237,0.08)', color: '#7c3aed', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(124,58,237,0.15)' } }}>
                                        <ViewInArRounded sx={{ fontSize: 13 }} /> Tour
                                      </Box>
                                    )}
                                  </>
                                ) : (
                                  <Box component={Link} to={`/captures/upload?roomId=${room.id}`} sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, py: 0.75, borderRadius: '8px', border: `1px dashed ${colors.border}`, color: colors.textMuted, fontSize: '0.75rem', fontWeight: 500, textDecoration: 'none', '&:hover': { borderColor: colors.primary, color: colors.primary } }}>
                                    <CameraAltRounded sx={{ fontSize: 13 }} /> Upload Capture
                                  </Box>
                                )}
                              </Box>
                            </Box>
                          </Box>
                        </Grid>
                      );
                    })}
                  </Grid>
                </Box>
              );
            })}
          </>
        )}
      </Box>}

      {!hasAdminRole && <Dialog open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 360 } } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Add Room</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField label="Room Name" value={roomForm.name} onChange={e => setRoomForm(f => ({ ...f, name: e.target.value }))} fullWidth placeholder="e.g. Master Bedroom" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <TextField select label="Room Type" value={roomForm.type} onChange={e => setRoomForm(f => ({ ...f, type: e.target.value as WfRoom['type'] }))} fullWidth sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}>
            {ROOM_TYPES.map(t => <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>)}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setOpen(false)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleAddRoom} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', background: colors.primaryGradient, boxShadow: 'none' }}>Add Room</Button>
        </DialogActions>
      </Dialog>}
    </Box>
  );
}
