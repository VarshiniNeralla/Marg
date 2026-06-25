import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Grid, Chip, LinearProgress, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Tooltip, IconButton } from '@mui/material';
import { ArrowBackRounded, AddRounded, DomainRounded, ArrowForwardRounded, DeleteRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isAdmin } from '@store/authStore';
import { getProjectById, getTowersByProject } from '@store/workflowSelectors';

export default function TowersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projects = useWorkflowStore(s => s.projects);
  const towers = useWorkflowStore(s => s.towers);
  const createTower = useWorkflowStore(s => s.createTower);
  const deleteTower = useWorkflowStore(s => s.deleteTower);
  const { user } = useAuthStore();
  const hasAdminRole = isAdmin(user);
  const project = getProjectById(projects, projectId ?? '');
  const projectTowers = [...getTowersByProject(towers, projectId ?? '')].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', floors: '14', description: '' });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const towerToDelete = projectTowers.find(t => t.id === deleteTarget);

  if (!project) return <Box sx={{ p: 4, color: colors.textMuted }}>Project not found.</Box>;

  function handleAdd() {
    if (!form.name.trim()) return;
    createTower(project!.id, form.name, Number(form.floors));
    setForm({ name: '', floors: '14', description: '' });
    setOpen(false);
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
          <Box onClick={() => setOpen(true)} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', userSelect: 'none' }}>
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {hasAdminRole && (
                    <Tooltip title="Delete tower">
                      <IconButton
                        size="small"
                        onClick={() => setDeleteTarget(tower.id)}
                        sx={{ width: 24, height: 24, backgroundColor: 'rgba(239,68,68,0.18)', color: '#ef4444', '&:hover': { backgroundColor: 'rgba(239,68,68,0.32)' } }}
                      >
                        <DeleteRounded sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
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

      <Dialog open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 380 } } }}>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Add Tower</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField label="Tower Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} fullWidth placeholder="e.g. Tower D" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <TextField label="Number of Floors" type="number" value={form.floors} onChange={e => setForm(f => ({ ...f, floors: e.target.value }))} fullWidth sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <TextField label="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} fullWidth multiline rows={2} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={() => setOpen(false)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Cancel</Button>
          <Button onClick={handleAdd} variant="contained" sx={{ borderRadius: '8px', textTransform: 'none', background: colors.primaryGradient, boxShadow: 'none' }}>Add Tower</Button>
        </DialogActions>
      </Dialog>

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
