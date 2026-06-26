import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Grid, LinearProgress, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Tooltip, IconButton } from '@mui/material';
import { ArrowBackRounded, AddRounded, DomainRounded, ArrowForwardRounded, DeleteRounded, EditRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isAdmin } from '@store/authStore';
import { getProjectById, getTowersByProject } from '@store/workflowSelectors';

export default function TowersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projects    = useWorkflowStore(s => s.projects);
  const towers      = useWorkflowStore(s => s.towers);
  const createTower = useWorkflowStore(s => s.createTower);
  const updateTower = useWorkflowStore(s => s.updateTower);
  const deleteTower = useWorkflowStore(s => s.deleteTower);
  const createFloor = useWorkflowStore(s => s.createFloor);
  const deleteFloor = useWorkflowStore(s => s.deleteFloor);
  const floors      = useWorkflowStore(s => s.floors);
  const { user }    = useAuthStore();
  const hasAdminRole = isAdmin(user);

  const project      = getProjectById(projects, projectId ?? '');
  const projectTowers = [...getTowersByProject(towers, projectId ?? '')].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );

  // ── Add dialog state ──────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', floors: '14', description: '' });

  // ── Edit dialog state ─────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [editForm, setEditForm]     = useState({ name: '', floors: '', description: '' });
  const towerToEdit = projectTowers.find(t => t.id === editTarget);

  // ── Delete dialog state ───────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const towerToDelete = projectTowers.find(t => t.id === deleteTarget);

  if (!project) return <Box sx={{ p: 4, color: colors.textMuted }}>Project not found.</Box>;

  function handleAdd() {
    if (!addForm.name.trim()) return;
    const floorCount = Math.max(0, Number(addForm.floors) || 0);
    // Pass 0 so createTower doesn't pre-set the count — createFloor increments it per floor
    const towerId = createTower(project!.id, addForm.name.trim(), 0);
    for (let i = 1; i <= floorCount; i++) {
      createFloor(towerId, i);
    }
    setAddForm({ name: '', floors: '14', description: '' });
    setAddOpen(false);
  }

  function openEdit(tower: typeof projectTowers[0]) {
    const actualFloorCount = floors.filter(f => f.towerId === tower.id).length;
    setEditTarget(tower.id);
    setEditForm({ name: tower.name, floors: String(actualFloorCount), description: tower.description ?? '' });
  }

  function handleEdit() {
    if (!editTarget || !editForm.name.trim()) return;
    const newCount = Math.max(0, Number(editForm.floors) || 0);
    const tower    = projectTowers.find(t => t.id === editTarget);
    const existing = floors.filter(f => f.towerId === editTarget).sort((a, b) => a.number - b.number);
    const oldCount = existing.length;

    if (newCount > oldCount) {
      // add missing floors
      for (let i = oldCount + 1; i <= newCount; i++) {
        createFloor(editTarget, i);
      }
    } else if (newCount < oldCount) {
      // remove floors from the top down
      const toRemove = existing.slice(newCount);
      toRemove.forEach(f => deleteFloor(f.id));
    }

    updateTower(editTarget, {
      name: editForm.name.trim(),
      description: editForm.description.trim(),
    });
    setEditTarget(null);
  }

  function handleDelete() {
    if (deleteTarget) deleteTower(deleteTarget);
    setDeleteTarget(null);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 5 }}>
        <Box component={Link} to={`/projects/${project.id}`} sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 0.25 }}>{project.name}</Typography>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>Towers</Typography>
        </Box>
        {hasAdminRole && (
          <Box onClick={() => setAddOpen(true)} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', userSelect: 'none' }}>
            <AddRounded sx={{ fontSize: 16 }} /> Add Tower
          </Box>
        )}
      </Box>

      <Grid container spacing={2.5}>
        {projectTowers.map(tower => (
          <Grid key={tower.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Box sx={{ borderRadius: '18px', backgroundColor: colors.card, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', transition: `all ${motion.durationNormal}`, '&:hover': { boxShadow: '0 8px 32px rgba(15,23,42,0.10)', transform: 'translateY(-2px)' } }}>
              <Box sx={{ height: 80, background: project.gradient, display: 'flex', alignItems: 'center', px: 2.5, justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <DomainRounded sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 22 }} />
                  <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.125rem', fontWeight: 700, color: '#fff', letterSpacing: '-0.03em' }}>{tower.name}</Typography>
                </Box>
                {hasAdminRole && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Tooltip title="Edit tower">
                      <IconButton
                        size="small"
                        onClick={() => openEdit(tower)}
                        sx={{ width: 24, height: 24, backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', '&:hover': { backgroundColor: 'rgba(255,255,255,0.28)' } }}
                      >
                        <EditRounded sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete tower">
                      <IconButton
                        size="small"
                        onClick={() => setDeleteTarget(tower.id)}
                        sx={{ width: 24, height: 24, backgroundColor: 'rgba(239,68,68,0.18)', color: '#ef4444', '&:hover': { backgroundColor: 'rgba(239,68,68,0.32)' } }}
                      >
                        <DeleteRounded sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
              </Box>
              <Box sx={{ p: 2.5 }}>
                {tower.description && (
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1.5, lineHeight: 1.5 }}>{tower.description}</Typography>
                )}
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mb: 2 }}>
                  {[{ val: tower.floors, label: 'Floors' }, { val: tower.rooms, label: 'Rooms' }, { val: tower.captures, label: 'Captures' }].map(({ val, label }) => (
                    <Box key={label} sx={{ textAlign: 'center', p: 1, borderRadius: '8px', backgroundColor: colors.bg }}>
                      <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>{val}</Typography>
                      <Typography sx={{ fontSize: '0.625rem', color: colors.textMuted }}>{label}</Typography>
                    </Box>
                  ))}
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>Progress</Typography>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: project.accent }}>{tower.progress}%</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={tower.progress} sx={{ height: 4, borderRadius: '99px', backgroundColor: `${project.accent}18`, '& .MuiLinearProgress-bar': { borderRadius: '99px', background: project.accent } }} />
                </Box>
                <Box component={Link} to={`/projects/${project.id}/towers/${tower.id}`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textDecoration: 'none' }}>
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>View floors</Typography>
                  <ArrowForwardRounded sx={{ fontSize: 15, color: project.accent }} />
                </Box>
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* ── Add Tower dialog ────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 380 } } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Add Tower</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField label="Tower Name" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} fullWidth placeholder="e.g. Tower D" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <TextField
            label="Number of Floors"
            type="number"
            value={addForm.floors}
            onChange={e => setAddForm(f => ({ ...f, floors: e.target.value }))}
            fullWidth
            helperText="Floors will be created automatically"
            slotProps={{ htmlInput: { min: 1 } }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />
          <TextField label="Description" value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} fullWidth multiline rows={2} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleAdd} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', background: colors.primaryGradient, boxShadow: 'none' }}>Add Tower</Button>
        </DialogActions>
      </Dialog>

      {/* ── Edit Tower dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 380 } } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Edit Tower</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField label="Tower Name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} fullWidth sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <TextField
            label="Number of Floors"
            type="number"
            value={editForm.floors}
            onChange={e => setEditForm(f => ({ ...f, floors: e.target.value }))}
            fullWidth
            slotProps={{ htmlInput: { min: 1 } }}
            helperText="Increase to add floors, decrease to remove from the top"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />
          <TextField label="Description" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} fullWidth multiline rows={2} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setEditTarget(null)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleEdit} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', background: colors.primaryGradient, boxShadow: 'none' }}>Save Changes</Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Tower dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 360 } } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Delete Tower</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.9rem', color: colors.textMuted }}>
            Are you sure you want to delete <strong style={{ color: colors.textStrong }}>{towerToDelete?.name}</strong>?
            All floors and data within this tower will be removed.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setDeleteTarget(null)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleDelete} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', backgroundColor: '#ef4444', boxShadow: 'none', '&:hover': { backgroundColor: '#dc2626' } }}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
