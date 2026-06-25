import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Chip, LinearProgress, Dialog, DialogTitle, DialogContent, DialogActions, Button, Tooltip, IconButton, Menu, MenuItem } from '@mui/material';
import { ArrowBackRounded, LayersRounded, MeetingRoomRounded, ViewInArRounded, ArrowForwardRounded, DeleteRounded, UploadFileRounded, AddRounded, SortRounded, ArrowUpwardRounded, ArrowDownwardRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore } from '@store/authStore';
import { getProjectById, getFloorsByTower, enrichFloorStats } from '@store/workflowSelectors';

export default function FloorListPage() {
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
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const project = getProjectById(projects, projectId ?? '');
  const tower = towers.find(t => t.id === towerId);
  const towerFloors = getFloorsByTower(floors, towerId ?? '');
  const dataSlice = { flats, rooms, captures, tours, floorPlans };

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newFloorLabel, setNewFloorLabel] = useState('');
  const [sortField, setSortField] = useState<'number' | 'progress' | 'rooms'>('number');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [sortAnchor, setSortAnchor] = useState<null | HTMLElement>(null);
  const floorToDelete = towerFloors.find(f => f.id === deleteTarget);

  function applySort(a: typeof towerFloors[0], b: typeof towerFloors[0]): number {
    const statsA = enrichFloorStats(a, dataSlice);
    const statsB = enrichFloorStats(b, dataSlice);
    let val = 0;
    if (sortField === 'number') val = a.number - b.number;
    else if (sortField === 'progress') {
      const pA = statsA.roomCount > 0 ? statsA.mapped / statsA.roomCount : 0;
      const pB = statsB.roomCount > 0 ? statsB.mapped / statsB.roomCount : 0;
      val = pA - pB;
    } else if (sortField === 'rooms') val = statsA.roomCount - statsB.roomCount;
    return sortDir === 'asc' ? val : -val;
  }

  const sortedFloors = [...towerFloors].sort(applySort);

  const SORT_OPTIONS: { key: 'number' | 'progress' | 'rooms'; label: string }[] = [
    { key: 'number', label: 'Floor Number' },
    { key: 'rooms', label: 'Room Count' },
    { key: 'progress', label: 'Capture Progress' },
  ];

  if (!project || !tower) return <Box sx={{ p: 4, color: colors.textMuted }}>Tower not found.</Box>;

  function handleDeleteFloor() {
    if (deleteTarget) deleteFloor(deleteTarget);
    setDeleteTarget(null);
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
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 5 }}>
        <Box component={Link} to={`/projects/${project.id}/towers`} sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 0.25 }}>{project.name} · {tower.name}</Typography>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>
            Floors
          </Typography>
        </Box>
        {/* Sort button */}
        <Tooltip title="Sort floors">
          <Box
            onClick={e => setSortAnchor(e.currentTarget)}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.875, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, backgroundColor: colors.card, color: colors.textSecondary, fontSize: '0.8125rem', fontWeight: 500, cursor: 'pointer', '&:hover': { borderColor: colors.border, color: colors.textStrong }, userSelect: 'none' }}
          >
            <SortRounded sx={{ fontSize: 16 }} />
            {SORT_OPTIONS.find(o => o.key === sortField)?.label}
            {sortDir === 'asc' ? <ArrowUpwardRounded sx={{ fontSize: 13 }} /> : <ArrowDownwardRounded sx={{ fontSize: 13 }} />}
          </Box>
        </Tooltip>
        <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)} slotProps={{ paper: { sx: { borderRadius: '12px', boxShadow: '0 8px 24px rgba(15,23,42,0.12)', mt: 0.5 } } }}>
          {SORT_OPTIONS.map(opt => (
            <MenuItem
              key={opt.key}
              selected={sortField === opt.key}
              onClick={() => {
                if (sortField === opt.key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                else { setSortField(opt.key); setSortDir('asc'); }
                setSortAnchor(null);
              }}
              sx={{ fontSize: '0.875rem', gap: 1, minWidth: 180, borderRadius: '8px', mx: 0.5 }}
            >
              {opt.label}
              {sortField === opt.key && (
                sortDir === 'asc' ? <ArrowUpwardRounded sx={{ fontSize: 14, ml: 'auto', color: colors.primary }} /> : <ArrowDownwardRounded sx={{ fontSize: 14, ml: 'auto', color: colors.primary }} />
              )}
            </MenuItem>
          ))}
        </Menu>
        {isAdmin && (
          <Box
            onClick={() => setAddOpen(true)}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', userSelect: 'none' }}
          >
            <AddRounded sx={{ fontSize: 16 }} /> Add Floor
          </Box>
        )}
      </Box>

      <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
        <Box sx={{ px: 3, pt: 2.5, pb: 2, borderBottom: `1px solid ${colors.borderLight}` }}>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{tower.name}</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{towerFloors.length} floors · {flats.filter(f => f.towerId === tower.id).length} flats · {tower.rooms} total rooms</Typography>
        </Box>
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {sortedFloors.map(floor => {
            const stats = enrichFloorStats(floor, dataSlice);
            const pct = stats.roomCount > 0 ? Math.round((stats.mapped / stats.roomCount) * 100) : 0;
            const complete = stats.mapped === stats.roomCount && stats.roomCount > 0;
            return (
              <Box
                key={floor.id}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 2, p: 1.75, borderRadius: '12px',
                  '&:hover': { backgroundColor: colors.bg },
                  '&:hover .fl-arrow': { opacity: 1, transform: 'translateX(3px)' },
                  transition: `background ${motion.durationFast}`,
                }}
              >
                <Box
                  component={Link}
                  to={`/projects/${project.id}/towers/${tower.id}/floors/${floor.id}`}
                  sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0, textDecoration: 'none' }}
                >
                  <Box sx={{ width: 64, height: 48, borderRadius: '8px', background: project.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: stats.mapped > 0 ? 1 : 0.3 }}>
                    <LayersRounded sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 20 }} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{floor.label}</Typography>
                      {complete && (
                        <Box sx={{ px: 0.75, py: 0.125, borderRadius: '4px', backgroundColor: 'rgba(22,163,74,0.08)', fontSize: '0.5625rem', fontWeight: 700, color: '#16a34a' }}>Complete</Box>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textMuted }}>
                        <MeetingRoomRounded sx={{ fontSize: 12 }} />
                        <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>{stats.mapped}/{stats.roomCount} rooms</Typography>
                      </Box>
                      <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{stats.flatCount} flats</Typography>
                      {stats.tourCount > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textMuted }}>
                          <ViewInArRounded sx={{ fontSize: 12 }} />
                          <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>{stats.tourCount} tours</Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ width: 80, flexShrink: 0 }}>
                    <Box sx={{ height: 4, borderRadius: '99px', backgroundColor: colors.bgDeep, mb: 0.5 }}>
                      <Box sx={{ height: '100%', width: `${pct}%`, borderRadius: '99px', backgroundColor: complete ? '#16a34a' : project.accent }} />
                    </Box>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, textAlign: 'right' }}>{pct}%</Typography>
                  </Box>
                  <ArrowForwardRounded className="fl-arrow" sx={{ fontSize: 15, color: colors.textSubdued, opacity: 0, transition: `opacity ${motion.durationFast}, transform ${motion.durationFast}`, flexShrink: 0 }} />
                </Box>
                {isAdmin && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                    <Tooltip title="Upload floor plan">
                      <IconButton
                        size="small"
                        component={Link}
                        to={`/floor-plans/${project.id}/${tower.id}/${floor.id}/upload`}
                        sx={{ width: 28, height: 28, backgroundColor: 'rgba(37,99,235,0.08)', color: colors.primary, '&:hover': { backgroundColor: 'rgba(37,99,235,0.18)' } }}
                      >
                        <UploadFileRounded sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete floor">
                      <IconButton
                        size="small"
                        onClick={() => setDeleteTarget(floor.id)}
                        sx={{ width: 28, height: 28, backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', '&:hover': { backgroundColor: 'rgba(239,68,68,0.2)' } }}
                      >
                        <DeleteRounded sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Add Floor dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 360 } } }}>
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

      {/* Delete Floor confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 360 } } }}>
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
