import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, InputBase, Menu, MenuItem } from '@mui/material';
import {
  ViewInArRounded, PlayArrowRounded, CameraAltRounded,
  KeyboardArrowDownRounded, CheckRounded, SearchRounded, ArrowBackRounded, DeleteRounded,
  BusinessRounded, LayersRounded
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig } from '@/data/mockData';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore , getRoleLandingPath } from '@store/authStore';

const STATUS_DOT: Record<string, string> = {
  published:  colors.success,
  in_review:  colors.warning,
  processing: colors.info ?? '#0891b2',
  draft:      colors.textSubdued,
};

const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;
const P = {
  border:   '#e4e7ec',
  muted:    '#6b7280',
  subtle:   '#9ca3af',
  strong:   '#111827',
  blue:     '#2563eb',
  blueSoft: 'rgba(37,99,235,0.08)',
  white:    '#ffffff',
  bg:       '#f7f8fa',
};

export default function ToursPage() {
  const user = useAuthStore(s => s.user);
  const role = user?.role || 'default';
  
  const [projectId, setProjectId] = useState<string>(() => sessionStorage.getItem(`tours_projectId_${role}`) || '');
  const [towerId, setTowerId]     = useState<string>(() => sessionStorage.getItem(`tours_towerId_${role}`) || '');
  const [floorId, setFloorId]     = useState<string>(() => sessionStorage.getItem(`tours_floorId_${role}`) || '');
  
  const [query, setQuery]             = useState('');
  const [menuAnchor, setMenuAnchor]   = useState<null | HTMLElement>(null);
  const [towerMenuAnchor, setTowerMenuAnchor] = useState<null | HTMLElement>(null);
  const [floorMenuAnchor, setFloorMenuAnchor] = useState<null | HTMLElement>(null);

  const allTours    = useWorkflowStore(s => s.tours);
  const allProjects = useWorkflowStore(s => s.projects);
  const allTowers   = useWorkflowStore(s => s.towers);
  const allFloors   = useWorkflowStore(s => s.floors);
  const deleteTour  = useWorkflowStore(s => s.deleteTour);
  
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const handleProjectSelect = (id: string) => { 
    setProjectId(id); setTowerId(''); setFloorId(''); setMenuAnchor(null); 
    sessionStorage.setItem(`tours_projectId_${role}`, id);
    sessionStorage.setItem(`tours_towerId_${role}`, '');
    sessionStorage.setItem(`tours_floorId_${role}`, '');
  };
  const handleTowerSelect = (id: string) => { 
    setTowerId(id); setFloorId(''); setTowerMenuAnchor(null); 
    sessionStorage.setItem(`tours_towerId_${role}`, id);
    sessionStorage.setItem(`tours_floorId_${role}`, '');
  };
  const handleFloorSelect = (id: string) => { 
    setFloorId(id); setFloorMenuAnchor(null); 
    sessionStorage.setItem(`tours_floorId_${role}`, id);
  };

  const projects = useMemo(() => allProjects.filter(p => !p.archived), [allProjects]);
  const availableTowers = useMemo(() => !projectId || projectId === 'all' ? [] : allTowers.filter(t => t.projectId === projectId).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true})), [allTowers, projectId]);
  const availableFloors = useMemo(() => !towerId || towerId === 'all' ? [] : allFloors.filter(f => f.towerId === towerId).sort((a,b) => a.label.localeCompare(b.label, undefined, {numeric:true})), [allFloors, towerId]);

  const filtered = useMemo(() => allTours.filter(t => {
    const matchProject = projectId === 'all' || t.projectId === projectId;
    const matchTower   = towerId === 'all' || t.towerId === towerId;
    const floorLabel   = availableFloors.find(f => f.id === floorId)?.label;
    const matchFloor   = floorId === 'all' || t.floorLabel === floorLabel;
    
    return matchProject && matchTower && matchFloor;
  }), [allTours, projectId, towerId, floorId, availableFloors]);

  const selectedProject = projects.find(p => p.id === projectId);
  const selectedTower   = availableTowers.find(t => t.id === towerId);
  const selectedFloor   = availableFloors.find(f => f.id === floorId);

  const selectedCount   = !projectId || projectId === 'all' ? allTours.length : allTours.filter(t => t.projectId === projectId).length;

  const isSelectionComplete = projectId && projectId !== 'all' && towerId && towerId !== 'all' && floorId && floorId !== 'all';

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>
      {/* Back to overview (all roles) */}
      <Box component={Link} to={getRoleLandingPath(user?.role)} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
        </Box>

      {/* Heading */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>
          Virtual Tours
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
          {allTours.length} tour{allTours.length !== 1 ? 's' : ''} · {projects.length} project{projects.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, mb: 3, flexWrap: 'wrap' }}>
        {/* Project pill */}
        <Box
          onClick={e => setMenuAnchor(e.currentTarget)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${menuAnchor ? P.blue : P.border}`,
            backgroundColor: menuAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            flex: { xs: '1 1 0%', sm: 'initial' }, justifyContent: 'space-between', order: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
            <Box sx={{ width: 18, height: 18, borderRadius: '5px', background: selectedProject ? selectedProject.gradient : `linear-gradient(135deg,${P.subtle},${P.muted})`, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedProject ? selectedProject.name : (projectId === 'all' ? 'All projects' : 'Select a project')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
            <Box sx={{ px: 0.75, py: 0.25, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted }}>
              {selectedCount}
            </Box>
            <KeyboardArrowDownRounded sx={{ fontSize: 16, color: P.muted, transform: menuAnchor ? 'rotate(180deg)' : 'none', transition: T }} />
          </Box>
        </Box>

        {/* Tower pill */}
        {projectId && projectId !== 'all' && (
          <Box onClick={(e) => setTowerMenuAnchor(e.currentTarget)} sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${towerMenuAnchor ? P.blue : P.border}`,
            backgroundColor: towerMenuAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            flex: { xs: '1 1 0%', sm: 'initial' },
            justifyContent: 'space-between',
            order: 1
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
              <BusinessRounded sx={{ fontSize: 18, color: P.subtle }} />
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedTower ? selectedTower.name : (towerId === 'all' ? 'All towers' : 'Select a tower')}
              </Typography>
            </Box>
            <KeyboardArrowDownRounded sx={{ fontSize: 16, color: P.muted, transform: towerMenuAnchor ? 'rotate(180deg)' : 'none', transition: T }} />
          </Box>
        )}

        {/* Floor pill */}
        {projectId && projectId !== 'all' && towerId && towerId !== 'all' && (
          <Box onClick={(e) => setFloorMenuAnchor(e.currentTarget)} sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${floorMenuAnchor ? P.blue : P.border}`,
            backgroundColor: floorMenuAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            flex: { xs: '1 1 0%', sm: 'initial' },
            justifyContent: 'space-between',
            order: 1
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
              <LayersRounded sx={{ fontSize: 18, color: P.subtle }} />
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedFloor ? selectedFloor.label : (floorId === 'all' ? 'All floors' : 'Select a floor')}
              </Typography>
            </Box>
            <KeyboardArrowDownRounded sx={{ fontSize: 16, color: P.muted, transform: floorMenuAnchor ? 'rotate(180deg)' : 'none', transition: T }} />
          </Box>
        )}

        <Box sx={{ flex: 1, order: 2, display: { xs: 'none', sm: 'block' } }} />
      </Box>

      {/* Project menu */}
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1, width: { xs: menuAnchor ? menuAnchor.offsetWidth : 'auto', sm: 280 }, minWidth: { sm: 280 }, maxWidth: 'calc(100vw - 32px)', borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {projects.map(opt => {
            const isActive = projectId === opt.id;
            const projectToursCount = allTours.filter(t => t.projectId === opt.id).length;
            return (
              <MenuItem key={opt.id} onClick={() => handleProjectSelect(opt.id)}
                sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
              >
                <Box sx={{ width: 22, height: 22, borderRadius: '7px', background: opt.gradient, flexShrink: 0 }} />
                <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong }}>
                  {opt.name}
                </Typography>
                <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
                  {projectToursCount}
                </Box>
                {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
              </MenuItem>
            );
          })}
      </Menu>

      {/* Tower menu */}
      <Menu
        anchorEl={towerMenuAnchor}
        open={!!towerMenuAnchor}
        onClose={() => setTowerMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1, width: { xs: towerMenuAnchor ? towerMenuAnchor.offsetWidth : 'auto', sm: 260 }, minWidth: { sm: 260 }, maxWidth: 'calc(100vw - 32px)', borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {availableTowers.map(t => {
          const isActive = towerId === t.id;
          return (
            <MenuItem key={t.id} onClick={() => handleTowerSelect(t.id)}
              sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
            >
              <BusinessRounded sx={{ fontSize: 18, color: isActive ? colors.primary : colors.textMuted }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong }}>
                {t.name}
              </Typography>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Floor menu */}
      <Menu
        anchorEl={floorMenuAnchor}
        open={!!floorMenuAnchor}
        onClose={() => setFloorMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1, width: { xs: floorMenuAnchor ? floorMenuAnchor.offsetWidth : 'auto', sm: 260 }, minWidth: { sm: 260 }, maxWidth: 'calc(100vw - 32px)', borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {availableFloors.map(f => {
          const isActive = floorId === f.id;
          return (
            <MenuItem key={f.id} onClick={() => handleFloorSelect(f.id)}
              sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
            >
              <LayersRounded sx={{ fontSize: 18, color: isActive ? colors.primary : colors.textMuted }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong }}>
                {f.label}
              </Typography>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Empty state or Tours List */}
      {!isSelectionComplete ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <LayersRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>Select a project, tower, and floor</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Please select all options above to view the virtual tours.</Typography>
        </Box>
      ) : filtered.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <ViewInArRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>No tours found</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Try a different search or filter.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)' }, gap: 2 }}>
          {filtered.map(tour => {
            const st = (statusConfig.tour as Record<string, { label: string; color: string; bg: string }>)[tour.status] ?? statusConfig.tour.draft;
            const dot = STATUS_DOT[tour.status] ?? P.subtle;
            return (
              <Box
                key={tour.id}
                component={Link}
                to={`/tours/${tour.id}`}
                sx={{
                  display: 'block', textDecoration: 'none',
                  transition: `transform ${motion.durationNormal} ${motion.easeOut}`,
                  '&:hover': { transform: 'translateY(-3px)' },
                  '&:hover .tour-thumb': { boxShadow: '0 12px 32px rgba(15,23,42,0.14)' },
                  '&:hover .tour-play': { opacity: 1, transform: 'scale(1)' },
                  '&:hover .tour-delete': { opacity: 1 },
                }}
              >
                {/* Thumbnail */}
                <Box
                  className="tour-thumb"
                  sx={{
                    position: 'relative', aspectRatio: '4 / 3', borderRadius: '14px', overflow: 'hidden',
                    background: tour.gradient,
                    boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
                    transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}`,
                  }}
                >
                  {/* Play button on hover */}
                  <Box className="tour-play" sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transform: 'scale(0.85)', transition: `opacity ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}` }}>
                    <Box sx={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PlayArrowRounded sx={{ color: '#fff', fontSize: 24 }} />
                    </Box>
                  </Box>
                  {/* 360° badge */}
                  <Box sx={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 0.5, px: 0.875, py: 0.375, borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }}>
                    <ViewInArRounded sx={{ color: '#fff', fontSize: 11 }} />
                    <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>360°</Typography>
                  </Box>
                  {/* Status badge */}
                  <Box sx={{ position: 'absolute', top: 8, right: 8, px: 1, py: 0.375, borderRadius: '5px', backgroundColor: st.bg, fontSize: '0.5625rem', fontWeight: 700, color: st.color }}>
                    {st.label}
                  </Box>
                  {/* Delete button on hover */}
                  <Box className="tour-delete" sx={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10, opacity: 0, transition: `opacity ${motion.durationNormal} ${motion.easeOut}` }}>
                    <Box
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(tour); }}
                      sx={{ width: 32, height: 32, borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.9)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background-color 150ms ease, transform 150ms ease', '&:hover': { backgroundColor: 'rgba(220,38,38,1)', transform: 'scale(1.05)' } }}
                    >
                      <DeleteRounded sx={{ color: '#fff', fontSize: 16 }} />
                    </Box>
                  </Box>
                </Box>

                {/* Metadata */}
                <Box sx={{ pt: 1.25, px: 0.25 }}>
                  <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em' }}>
                    {tour.roomName}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.375 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
                    <Typography noWrap sx={{ fontSize: '0.75rem', color: P.muted }}>
                      {tour.towerName} · {tour.floorLabel}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.375, color: P.subtle }}>
                    <CameraAltRounded sx={{ fontSize: 11 }} />
                    <Typography sx={{ fontSize: '0.6875rem', color: 'inherit' }}>{tour.captures} captures</Typography>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this tour?"
        description={`The generated tour for ${deleteTarget?.roomName ?? 'this room'} will be permanently removed. The underlying capture point will still exist. This cannot be undone.`}
        confirmLabel="Delete tour"
        destructive
        onConfirm={() => { if (deleteTarget) deleteTour(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
