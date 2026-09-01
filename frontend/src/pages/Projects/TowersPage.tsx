import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Tooltip, IconButton, Pagination } from '@mui/material';
import { ArrowBackRounded, AddRounded, DomainRounded, DeleteRounded, EditRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isAdmin } from '@store/authStore';
import { getProjectById, getTowersByProject, getCapturesByTowerScope } from '@store/workflowSelectors';

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
  const rooms       = useWorkflowStore(s => s.rooms);
  const captures    = useWorkflowStore(s => s.captures);
  const capturePins = useWorkflowStore(s => s.capturePins);
  const { user }    = useAuthStore();
  const hasAdminRole = isAdmin(user);

  const project      = getProjectById(projects, projectId ?? '');
  const projectTowers = [...getTowersByProject(towers, projectId ?? '')].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );

  // ── Add dialog state ──────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', floors: '14' });

  // ── Edit dialog state ─────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [editForm, setEditForm]     = useState({ name: '', floors: '', description: '' });
  const towerToEdit = projectTowers.find(t => t.id === editTarget);

  // ── Delete dialog state ───────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const towerToDelete = projectTowers.find(t => t.id === deleteTarget);

  // ── Pagination ────────────────────────────────────────────────────────────
  const [towerPage, setTowerPage] = useState(1);
  const TOWERS_PER_PAGE = 9; // 3 columns × 3 rows
  const towerTotalPages = Math.max(1, Math.ceil(projectTowers.length / TOWERS_PER_PAGE));
  const safeTowerPage = Math.min(towerPage, towerTotalPages);
  const pagedTowers = projectTowers.slice((safeTowerPage - 1) * TOWERS_PER_PAGE, safeTowerPage * TOWERS_PER_PAGE);

  if (!project) return <Box sx={{ p: 4, color: colors.textMuted }}>Project not found.</Box>;

  function handleAdd() {
    if (!addForm.name.trim()) return;
    const floorCount = Math.max(0, Number(addForm.floors) || 0);
    // Pass 0 so createTower doesn't pre-set the count — createFloor increments it per floor
    const towerId = createTower(project!.id, addForm.name.trim(), 0);
    for (let i = 1; i <= floorCount; i++) {
      createFloor(towerId, i);
    }
    setAddForm({ name: '', floors: '14' });
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
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {/* Back to project */}
      <Box component={Link} to={`/projects/${project.id}`} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> {project.name}
        </Box>

      {/* Heading */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, mb: 4, flexWrap: 'wrap' }}>
        <Box>
          <Typography sx={{
            fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
            fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
            color: colors.textStrong, letterSpacing: '-0.05em', lineHeight: 1.05,
          }}>
            Towers
          </Typography>
        </Box>
        {hasAdminRole && (
          <Box onClick={() => setAddOpen(true)} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 0.75 }, px: { xs: 1.25, sm: 2 }, py: { xs: 0.625, sm: 0.875 }, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: { xs: '0.75rem', sm: '0.875rem' }, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', userSelect: 'none', whiteSpace: 'nowrap' }}>
            <AddRounded sx={{ fontSize: { xs: 14, sm: 16 } }} /> Add Tower
          </Box>
        )}
      </Box>

      <Box sx={{
        display: 'grid',
        width: '100%',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
        gap: { xs: '10px', sm: '12px', md: '16px' },
      }}>
        {pagedTowers.map(tower => {
          const towerFloors = floors.filter(f => f.towerId === tower.id);
          const towerCaptures = getCapturesByTowerScope({ rooms, captures, capturePins }, tower.id);
          return (
            <Box
              key={tower.id}
              sx={{
                position: 'relative', borderRadius: '16px', backgroundColor: colors.card,
                overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', transition: `all ${motion.durationNormal}`,
                '&:hover': { boxShadow: '0 8px 32px rgba(15,23,42,0.10)', transform: 'translateY(-2px)' },
              }}
            >
              {hasAdminRole && (
                <Box sx={{ position: 'absolute', top: { xs: 6, sm: 10 }, right: { xs: 6, sm: 10 }, display: 'flex', gap: { xs: 0.375, sm: 0.5 }, zIndex: 1 }}>
                  <Tooltip title="Edit tower">
                    <IconButton
                      size="small"
                      onClick={() => openEdit(tower)}
                      sx={{ width: { xs: 22, sm: 26 }, height: { xs: 22, sm: 26 }, backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', '&:hover': { backgroundColor: 'rgba(255,255,255,0.28)' } }}
                    >
                      <EditRounded sx={{ fontSize: { xs: 11, sm: 13 } }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete tower">
                    <IconButton
                      size="small"
                      onClick={() => setDeleteTarget(tower.id)}
                      sx={{ width: { xs: 22, sm: 26 }, height: { xs: 22, sm: 26 }, backgroundColor: 'rgba(239,68,68,0.2)', color: '#fff', '&:hover': { backgroundColor: 'rgba(239,68,68,0.4)' } }}
                    >
                      <DeleteRounded sx={{ fontSize: { xs: 11, sm: 13 } }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
              <Box
                component={Link}
                to={`/projects/${project.id}/towers/${tower.id}`}
                sx={{ display: 'flex', flexDirection: 'column', textDecoration: 'none' }}
              >
                <Box sx={{ height: { xs: 72, sm: 96 }, background: project.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Box sx={{ width: { xs: 40, sm: 52 }, height: { xs: 40, sm: 52 }, borderRadius: { xs: '10px', sm: '14px' }, backgroundColor: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <DomainRounded sx={{ color: '#fff', fontSize: { xs: 20, sm: 26 } }} />
                  </Box>
                </Box>
                <Box sx={{ p: { xs: 1.25, sm: 2 }, textAlign: 'center' }}>
                  <Typography noWrap sx={{ fontSize: { xs: '0.8125rem', sm: '0.9375rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em', mb: { xs: 0.375, sm: 0.75 } }}>{tower.name}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: { xs: '0.6875rem', sm: '0.75rem' }, color: colors.textMuted }}>{towerFloors.length} floor{towerFloors.length === 1 ? '' : 's'}</Typography>
                    <Box sx={{ display: { xs: 'none', sm: 'block' }, width: 3, height: 3, borderRadius: '50%', backgroundColor: colors.borderLight }} />
                    <Typography sx={{ fontSize: { xs: '0.6875rem', sm: '0.75rem' }, color: colors.textMuted }}>{towerCaptures.length} capture{towerCaptures.length === 1 ? '' : 's'}</Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>

      {towerTotalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2.5 }}>
          <Pagination
            count={towerTotalPages}
            page={safeTowerPage}
            onChange={(_, page) => setTowerPage(page)}
            shape="rounded"
            size="small"
          />
        </Box>
      )}

      {/* ── Add Tower dialog ────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} slotProps={{ paper: { sx: { borderRadius: '16px', width: { xs: 'calc(100% - 32px)', sm: 'auto' }, minWidth: { xs: 0, sm: 380 }, m: { xs: 2, sm: 4 } } } }}>
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
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleAdd} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', background: colors.primaryGradient, boxShadow: 'none' }}>Add Tower</Button>
        </DialogActions>
      </Dialog>

      {/* ── Edit Tower dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)} slotProps={{ paper: { sx: { borderRadius: '16px', width: { xs: 'calc(100% - 32px)', sm: 'auto' }, minWidth: { xs: 0, sm: 380 }, m: { xs: 2, sm: 4 } } } }}>
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
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} slotProps={{ paper: { sx: { borderRadius: '16px', width: { xs: 'calc(100% - 32px)', sm: 'auto' }, minWidth: { xs: 0, sm: 360 }, m: { xs: 2, sm: 4 } } } }}>
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
