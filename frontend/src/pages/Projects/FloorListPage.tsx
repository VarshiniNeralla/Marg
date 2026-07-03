import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Button, Tooltip, IconButton, TextField, Pagination, useMediaQuery, useTheme } from '@mui/material';
import { ArrowBackRounded, LayersRounded, DeleteRounded, AddRounded, EditRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isAdmin } from '@store/authStore';
import { getProjectById, getFloorsByTower, enrichFloorStats } from '@store/workflowSelectors';

export default function FloorListPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { projectId, towerId } = useParams<{ projectId: string; towerId: string }>();
  const projects = useWorkflowStore(s => s.projects);
  const towers = useWorkflowStore(s => s.towers);
  const floors = useWorkflowStore(s => s.floors);
  const flats = useWorkflowStore(s => s.flats);
  const rooms = useWorkflowStore(s => s.rooms);
  const captures = useWorkflowStore(s => s.captures);
  const tours = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const deleteFloor = useWorkflowStore(s => s.deleteFloor);
  const createFloor = useWorkflowStore(s => s.createFloor);
  const updateFloor = useWorkflowStore(s => s.updateFloor);
  const { user } = useAuthStore();
  const hasAdminRole = isAdmin(user);

  const project = getProjectById(projects, projectId ?? '');
  const tower = towers.find(t => t.id === towerId);
  const towerFloors = getFloorsByTower(floors, towerId ?? '');
  const dataSlice = { flats, rooms, captures, tours, floorPlans };

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget]     = useState<string | null>(null);
  const [editLabel, setEditLabel]       = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newFloorLabel, setNewFloorLabel] = useState('');
  const [floorPage, setFloorPage] = useState(1);
  const floorToDelete = towerFloors.find(f => f.id === deleteTarget);
  const floorToEdit   = towerFloors.find(f => f.id === editTarget);

  const sortedFloors = [...towerFloors].sort((a, b) => a.number - b.number);
  const FLOORS_PER_PAGE = isMobile ? 6 : 9; // 2×3 on mobile, 3×3 on larger screens
  const floorTotalPages = Math.max(1, Math.ceil(sortedFloors.length / FLOORS_PER_PAGE));
  const safeFloorPage = Math.min(floorPage, floorTotalPages);
  const pagedFloors = sortedFloors.slice((safeFloorPage - 1) * FLOORS_PER_PAGE, safeFloorPage * FLOORS_PER_PAGE);

  if (!project || !tower) return <Box sx={{ p: 4, color: colors.textMuted }}>Tower not found.</Box>;

  function handleDeleteFloor() {
    if (deleteTarget) deleteFloor(deleteTarget);
    setDeleteTarget(null);
  }

  function openEdit(floorId: string, currentLabel: string) {
    setEditTarget(floorId);
    setEditLabel(currentLabel);
  }

  function handleEditFloor() {
    if (!editTarget || !editLabel.trim()) return;
    updateFloor(editTarget, { label: editLabel.trim() });
    setEditTarget(null);
    setEditLabel('');
  }

  function handleAddFloor() {
    if (!towerId) return;
    const num = newFloorLabel.trim() ? parseInt(newFloorLabel.trim(), 10) : NaN;
    const nextNum = isNaN(num) ? (towerFloors.length > 0 ? Math.max(...towerFloors.map(f => f.number)) + 1 : 1) : num;
    createFloor(towerId, nextNum);
    setNewFloorLabel('');
    setAddOpen(false);
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {/* Back to towers */}
      <Box component={Link} to={`/projects/${project.id}/towers`} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> {project.name} · {tower.name}
        </Box>

      {/* Heading */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, mb: 4, flexWrap: 'wrap' }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: colors.textStrong, letterSpacing: '-0.05em', lineHeight: 1.05,
        }}>
          Floors
        </Typography>
        {hasAdminRole && (
          <Box
            onClick={() => setAddOpen(true)}
            sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 0.75 }, px: { xs: 1.25, sm: 2 }, py: { xs: 0.625, sm: 0.875 }, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: { xs: '0.75rem', sm: '0.875rem' }, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', userSelect: 'none', whiteSpace: 'nowrap' }}
          >
            <AddRounded sx={{ fontSize: { xs: 14, sm: 16 } }} /> Add Floor
          </Box>
        )}
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{tower.name}</Typography>
        <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{towerFloors.length} floors · {flats.filter(f => f.towerId === tower.id).length} flats · {tower.rooms} total rooms</Typography>
      </Box>

      <Box sx={{
        display: 'grid',
        width: '100%',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
        gap: { xs: '10px', sm: '12px', md: '16px' },
      }}>
        {pagedFloors.map(floor => {
          const stats = enrichFloorStats(floor, dataSlice);
          const planUploaded = Boolean(stats.plan);
          return (
            <Box
              key={floor.id}
              sx={{
                position: 'relative', borderRadius: '16px', backgroundColor: colors.card,
                overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', transition: `all ${motion.durationNormal}`,
                '&:hover': { boxShadow: '0 8px 32px rgba(15,23,42,0.10)', transform: 'translateY(-2px)' },
              }}
            >
              {hasAdminRole && (
                <Box sx={{ position: 'absolute', top: { xs: 6, sm: 10 }, right: { xs: 6, sm: 10 }, display: 'flex', gap: { xs: 0.375, sm: 0.5 }, zIndex: 1 }}>
                  <Tooltip title="Edit floor">
                    <IconButton
                      size="small"
                      onClick={() => openEdit(floor.id, floor.label)}
                      sx={{ width: { xs: 22, sm: 26 }, height: { xs: 22, sm: 26 }, backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', '&:hover': { backgroundColor: 'rgba(255,255,255,0.28)' } }}
                    >
                      <EditRounded sx={{ fontSize: { xs: 11, sm: 13 } }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete floor">
                    <IconButton
                      size="small"
                      onClick={() => setDeleteTarget(floor.id)}
                      sx={{ width: { xs: 22, sm: 26 }, height: { xs: 22, sm: 26 }, backgroundColor: 'rgba(239,68,68,0.2)', color: '#fff', '&:hover': { backgroundColor: 'rgba(239,68,68,0.4)' } }}
                    >
                      <DeleteRounded sx={{ fontSize: { xs: 11, sm: 13 } }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
              <Box
                component={Link}
                to={`/projects/${project.id}/towers/${tower.id}/floors/${floor.id}`}
                sx={{ display: 'flex', flexDirection: 'column', textDecoration: 'none' }}
              >
                <Box sx={{ height: { xs: 72, sm: 96 }, background: project.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: planUploaded ? 1 : 0.5 }}>
                  <Box sx={{ width: { xs: 40, sm: 52 }, height: { xs: 40, sm: 52 }, borderRadius: { xs: '10px', sm: '14px' }, backgroundColor: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <LayersRounded sx={{ color: '#fff', fontSize: { xs: 20, sm: 26 } }} />
                  </Box>
                </Box>
                <Box sx={{ p: { xs: 1.25, sm: 2 }, textAlign: 'center' }}>
                  <Typography noWrap sx={{ fontSize: { xs: '0.8125rem', sm: '0.9375rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em', mb: { xs: 0.625, sm: 1 } }}>{floor.label}</Typography>
                  <Box sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.375, borderRadius: '99px',
                    backgroundColor: planUploaded ? 'rgba(22,163,74,0.1)' : colors.bgDeep, maxWidth: '100%',
                  }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: planUploaded ? '#16a34a' : colors.textSubdued, flexShrink: 0 }} />
                    <Typography noWrap sx={{ fontSize: { xs: '0.625rem', sm: '0.6875rem' }, fontWeight: 600, color: planUploaded ? '#16a34a' : colors.textMuted }}>
                      {planUploaded ? 'Plan uploaded' : 'No plan yet'}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>

      {floorTotalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2.5 }}>
          <Pagination
            count={floorTotalPages}
            page={safeFloorPage}
            onChange={(_, page) => setFloorPage(page)}
            shape="rounded"
            size="small"
          />
        </Box>
      )}

      {/* Add Floor dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} slotProps={{ paper: { sx: { borderRadius: '16px', width: { xs: 'calc(100% - 32px)', sm: 'auto' }, minWidth: { xs: 0, sm: 360 }, m: { xs: 2, sm: 4 } } } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Add Floor</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Box component="input"
            value={newFloorLabel}
            onChange={e => setNewFloorLabel(e.target.value)}
            placeholder="Floor number (e.g. 61) — leave blank to auto-number"
            onKeyDown={e => { if (e.key === 'Enter') handleAddFloor(); }}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${colors.borderLight}`,
              fontSize: '0.9375rem', color: colors.textStrong, background: colors.bg, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleAddFloor} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', background: colors.primaryGradient, boxShadow: 'none' }}>Add Floor</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Floor dialog */}
      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} slotProps={{ paper: { sx: { borderRadius: '16px', width: { xs: 'calc(100% - 32px)', sm: 'auto' }, minWidth: { xs: 0, sm: 360 }, m: { xs: 2, sm: 4 } } } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Edit Floor</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1.5 }}>
            Editing <strong style={{ color: colors.textStrong }}>{floorToEdit?.label}</strong>
          </Typography>
          <TextField
            label="Floor Label"
            value={editLabel}
            onChange={e => setEditLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleEditFloor(); }}
            fullWidth
            autoFocus
            placeholder="e.g. Floor 3 or Ground Floor"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setEditTarget(null)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleEditFloor} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', background: colors.primaryGradient, boxShadow: 'none' }}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Floor confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} slotProps={{ paper: { sx: { borderRadius: '16px', width: { xs: 'calc(100% - 32px)', sm: 'auto' }, minWidth: { xs: 0, sm: 360 }, m: { xs: 2, sm: 4 } } } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Delete Floor</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.9rem', color: colors.textMuted }}>
            Delete <strong style={{ color: colors.textStrong }}>{floorToDelete?.label}</strong>? All rooms and captures on this floor will be removed.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setDeleteTarget(null)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleDeleteFloor} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', backgroundColor: '#ef4444', boxShadow: 'none', '&:hover': { backgroundColor: '#dc2626' } }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
