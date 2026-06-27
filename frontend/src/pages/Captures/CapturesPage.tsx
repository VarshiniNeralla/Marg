import React, { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Box, Typography, InputBase, Menu, MenuItem, Pagination } from '@mui/material';
import { CameraAltRounded, ViewInArRounded, SearchRounded, KeyboardArrowDownRounded, CheckRounded, ArrowBackRounded, LayersRounded, MapRounded, DeleteOutlineRounded, BusinessRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig, getRoomHistory } from '@store/workflowSelectors';
import type { MockCapture } from '@/data/mockData';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore , getRoleLandingPath } from '@store/authStore';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';

// Capture gallery — project-wise selection, calm minimal cards.

const STATUS_FILTERS = ['All', 'Processed', 'In Review', 'Rejected'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const STATUS_DOT: Record<string, string> = {
  processed: colors.success,
  review: colors.warning,
  rejected: colors.danger,
  uploading: colors.info,
};

function CaptureCard({ capture, hasTour, onDelete }: { capture: MockCapture; hasTour: boolean; onDelete?: (c: MockCapture) => void }) {
  const st = statusConfig.capture[capture.status];
  const history = getRoomHistory(capture);
  const dot = STATUS_DOT[capture.status] ?? colors.textSubdued;

  return (
    <Box
      component={Link}
      to={`/captures/${capture.id}`}
      sx={{
        display: 'block', textDecoration: 'none',
        transition: `transform ${motion.durationNormal} ${motion.easeOut}`,
        '&:hover': { transform: 'translateY(-3px)' },
        '&:hover .cap-thumb': { boxShadow: '0 12px 32px rgba(15,23,42,0.14)' },
        '&:hover .cap-open': { opacity: 1 },
        '&:hover .cap-delete': { opacity: 1 },
      }}
    >
      {/* Thumbnail — soft, single subtle tint */}
      <Box
        className="cap-thumb"
        sx={{
          position: 'relative', aspectRatio: '4 / 3', borderRadius: '14px', overflow: 'hidden',
          background: capture.gradient,
          boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
          transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}`,
        }}
      >
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CameraAltRounded sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 32 }} />
        </Box>

        {/* hover: single open hint */}
        <Box className="cap-open" sx={{ position: 'absolute', bottom: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', opacity: 0, transition: `opacity ${motion.durationFast}` }}>
          <ViewInArRounded sx={{ color: '#fff', fontSize: 13 }} />
          <Typography sx={{ fontSize: '0.6875rem', color: '#fff', fontWeight: 600 }}>{hasTour ? 'View image' : 'Open'}</Typography>
        </Box>

        {/* tour marker — one quiet glyph */}
        {hasTour && (
          <Box sx={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: '7px', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ViewInArRounded sx={{ fontSize: 12, color: '#fff' }} />
          </Box>
        )}

        {/* delete (engineer history only) */}
        {onDelete && (
          <Box
            className="cap-delete"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(capture); }}
            sx={{ position: 'absolute', top: 8, left: 8, width: 24, height: 24, borderRadius: '7px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: { xs: 1, sm: 0 }, transition: `opacity ${motion.durationFast}, background-color ${motion.durationFast}`, '&:hover': { backgroundColor: '#dc2626' } }}
          >
            <DeleteOutlineRounded sx={{ fontSize: 14, color: '#fff' }} />
          </Box>
        )}
      </Box>

      {/* Metadata — name + status dot */}
      <Box sx={{ pt: 1.25, px: 0.25 }}>
        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, letterSpacing: '-0.01em' }}>
          {capture.roomName}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.375 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
          <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
            {capture.towerName} · {capture.floorLabel}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default function CapturesPage() {
  const location = useLocation();
  const isEngineerView = location.pathname === '/my-captures';
  const user = useAuthStore(s => s.user);
  const role = user?.role || 'default';

  const [projectId, setProjectId] = useState<string>(() => sessionStorage.getItem(`captures_projectId_${role}`) || '');
  const [towerId, setTowerId] = useState<string>(() => sessionStorage.getItem(`captures_towerId_${role}`) || '');
  const [floorId, setFloorId] = useState<string>(() => sessionStorage.getItem(`captures_floorId_${role}`) || '');


  // Reactive: read live data from the workflow store.
  const mockCaptures = useWorkflowStore(s => s.captures);
  const allProjects = useWorkflowStore(s => s.projects);
  const allFloors = useWorkflowStore(s => s.floors);
  const allTowers = useWorkflowStore(s => s.towers);
  const tours = useWorkflowStore(s => s.tours);
  const deleteCapture = useWorkflowStore(s => s.deleteCapture);
  const [deleteTarget, setDeleteTarget] = useState<MockCapture | null>(null);
  const tourCaptureIds = useMemo(() => new Set(tours.map(t => t.captureId)), [tours]);
  const PROJECTS_WITH_CAPTURES = useMemo(() => allProjects.filter(p => !p.archived), [allProjects]);
  const availableTowers = useMemo(() => !projectId || projectId === 'all' ? [] : allTowers.filter(t => t.projectId === projectId).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true})), [allTowers, projectId]);
  const availableFloors = useMemo(() => !towerId || towerId === 'all' ? [] : allFloors.filter(f => f.towerId === towerId).sort((a,b) => a.label.localeCompare(b.label, undefined, {numeric:true})), [allFloors, towerId]);

  const filtered = useMemo(() => {
    return mockCaptures.filter(c => {
      const matchesProject = projectId === 'all' || c.projectId === projectId;
      const matchesTower = towerId === 'all' || c.towerId === towerId;
      const floorLabel = availableFloors.find(f => f.id === floorId)?.label;
      const matchesFloor = floorId === 'all' || c.floorLabel === floorLabel;
      return matchesProject && matchesTower && matchesFloor;
    });
  }, [mockCaptures, projectId, towerId, floorId, availableFloors]);

  const [page, setPage] = useState(1);
  const itemsPerPage = 12;
  const paginatedFiltered = useMemo(() => filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage), [filtered, page]);
  const totalPages = Math.ceil(filtered.length / itemsPerPage);

  React.useEffect(() => {
    setPage(1);
  }, [projectId, towerId, floorId]);

  // Group captures by Tower → Floor so the history reads structurally:
  // each floor is a section holding its own captures, with a link to its plan.
  const groupedByFloor = useMemo(() => {
    interface FloorGroup { projectId: string; towerId: string; floorId: string; towerName: string; floorLabel: string; projectName: string; captures: MockCapture[]; }
    const map = new Map<string, FloorGroup>();
    for (const c of filtered) {
      const key = `${c.projectId}::${c.towerId}::${c.floorLabel}`;
      if (!map.has(key)) {
        // Resolve floorId from the floors store (captures store label, not id).
        const floor = allFloors.find(f => f.towerId === c.towerId && f.label === c.floorLabel);
        map.set(key, { projectId: c.projectId, towerId: c.towerId, floorId: floor?.id ?? '', towerName: c.towerName, floorLabel: c.floorLabel, projectName: c.projectName, captures: [] });
      }
      map.get(key)!.captures.push(c);
    }
    return [...map.values()].sort((a, b) =>
      a.towerName.localeCompare(b.towerName, undefined, { numeric: true }) ||
      a.floorLabel.localeCompare(b.floorLabel, undefined, { numeric: true })
    );
  }, [filtered, allFloors]);

  const pendingCount = mockCaptures.filter(c => c.status === 'review').length;

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [towerMenuAnchor, setTowerMenuAnchor] = useState<null | HTMLElement>(null);
  const [floorMenuAnchor, setFloorMenuAnchor] = useState<null | HTMLElement>(null);
  const handleProjectSelect = (id: string) => { 
    setProjectId(id); setTowerId('all'); setFloorId('all'); setMenuAnchor(null); 
    sessionStorage.setItem(`captures_projectId_${role}`, id);
    sessionStorage.setItem(`captures_towerId_${role}`, 'all');
    sessionStorage.setItem(`captures_floorId_${role}`, 'all');
  };
  const handleTowerSelect = (id: string) => { 
    setTowerId(id); setFloorId('all'); setTowerMenuAnchor(null); 
    sessionStorage.setItem(`captures_towerId_${role}`, id);
    sessionStorage.setItem(`captures_floorId_${role}`, 'all');
  };
  const handleFloorSelect = (id: string) => { 
    setFloorId(id); setFloorMenuAnchor(null); 
    sessionStorage.setItem(`captures_floorId_${role}`, id);
  };

  const selectedProject = PROJECTS_WITH_CAPTURES.find(p => p.id === projectId);
  const selectedTower = availableTowers.find(t => t.id === towerId);
  const selectedFloor = availableFloors.find(f => f.id === floorId);
  
  const selectedCount = projectId === 'all' ? mockCaptures.length : mockCaptures.filter(c => c.projectId === projectId).length;


  /* ── local palette (matches CaptureWorkflowPage / FloorPlansPage) ── */
  const P = {
    border:    '#e4e7ec',
    muted:     '#6b7280',
    subtle:    '#9ca3af',
    strong:    '#111827',
    blue:      '#2563eb',
    blueSoft:  'rgba(37,99,235,0.08)',
    blueRing:  'rgba(37,99,235,0.18)',
    white:     '#ffffff',
    bg:        '#f7f8fa',
    ink:       '#111318',
  };
  const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>
      {/* Back to overview — available for all roles */}
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

      {/* ── Heading ───────────────────────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>
          {isEngineerView ? 'Capture History' : 'Capture Gallery'}
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
          {mockCaptures.length} captures · {PROJECTS_WITH_CAPTURES.length} projects · {pendingCount} pending review
        </Typography>
      </Box>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, mb: 3, flexWrap: 'wrap' }}>
        {/* Project pill */}
        <Box onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
          border: `1.5px solid ${menuAnchor ? P.blue : P.border}`,
          backgroundColor: menuAnchor ? P.blueSoft : P.white,
          transition: T, '&:hover': { borderColor: P.blue },
          flex: { xs: '1 1 0%', sm: 'initial' },
          justifyContent: 'space-between',
          order: 1
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
            <Box sx={{ width: 18, height: 18, borderRadius: '5px', background: selectedProject ? selectedProject.gradient : `linear-gradient(135deg,${P.subtle},${P.muted})`, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedProject ? selectedProject.name : 'All projects'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
            <Box sx={{ px: 0.75, py: 0.25, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

      </Box>

      {/* Project menu */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1, width: { xs: menuAnchor ? menuAnchor.offsetWidth : 'auto', sm: 280 }, minWidth: { sm: 280 }, maxWidth: 'calc(100vw - 32px)', borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {[{ id: 'all', name: 'All projects', gradient: `linear-gradient(135deg, ${colors.textSubdued} 0%, ${colors.textMuted} 100%)`, count: mockCaptures.length },
          ...PROJECTS_WITH_CAPTURES.map(p => ({ id: p.id, name: p.name, gradient: p.gradient, count: mockCaptures.filter(c => c.projectId === p.id).length }))]
          .map(opt => {
            const isActive = projectId === opt.id;
            return (
              <MenuItem
                key={opt.id}
                onClick={() => handleProjectSelect(opt.id)}
                sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
              >
                <Box sx={{ width: 22, height: 22, borderRadius: '7px', background: opt.gradient, flexShrink: 0 }} />
                <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong, letterSpacing: '-0.01em' }}>
                  {opt.name}
                </Typography>
                <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
                  {opt.count}
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
        slotProps={{ paper: { sx: { mt: 1, width: { xs: towerMenuAnchor ? towerMenuAnchor.offsetWidth : 'auto', sm: 200 }, minWidth: { sm: 200 }, maxWidth: 'calc(100vw - 32px)', borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {[{ id: 'all', name: 'All towers' }, ...availableTowers].map(opt => {
          const isActive = towerId === opt.id;
          return (
            <MenuItem
              key={opt.id}
              onClick={() => handleTowerSelect(opt.id)}
              sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
            >
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong, letterSpacing: '-0.01em' }}>
                {opt.name}
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
        slotProps={{ paper: { sx: { mt: 1, width: { xs: floorMenuAnchor ? floorMenuAnchor.offsetWidth : 'auto', sm: 160 }, minWidth: { sm: 160 }, maxWidth: 'calc(100vw - 32px)', borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {[{ id: 'all', label: 'All floors' }, ...availableFloors].map(opt => {
          const isActive = floorId === opt.id;
          return (
            <MenuItem
              key={opt.id}
              onClick={() => handleFloorSelect(opt.id)}
              sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
            >
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong, letterSpacing: '-0.01em' }}>
                {opt.label}
              </Typography>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!floorId ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <LayersRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>Select a project, tower, and floor</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Use the dropdowns above to view captures for a specific floor.</Typography>
        </Box>
      ) : filtered.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <CameraAltRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>No captures found</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Try a different project, tower, or floor.</Typography>
        </Box>
      ) : isEngineerView ? (
        /* Engineer history — grouped by floor for a structured walkthrough view */
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
          {groupedByFloor.map(group => (
            <Box key={`${group.projectName}-${group.towerName}-${group.floorLabel}`}>
              {/* Floor section header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.75 }}>
                <Box sx={{ width: 30, height: 30, borderRadius: '8px', backgroundColor: P.blueSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <LayersRounded sx={{ fontSize: 17, color: P.blue }} />
                </Box>
                <Box sx={{ minWidth: 0, mr: { xs: 'auto', sm: 0 } }}>
                  <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, letterSpacing: '-0.02em', lineHeight: 1.2 }} noWrap>
                    {group.towerName} · {group.floorLabel}
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
                    {group.captures.length} capture{group.captures.length !== 1 ? 's' : ''}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, height: 1, backgroundColor: P.border, mx: 1, display: { xs: 'none', sm: 'block' } }} />
                {group.floorId && (
                  <Box
                    component={Link}
                    to={`/floor-plans/${group.projectId}/${group.towerId}/${group.floorId}?pinsOnly=1`}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.625, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } }}
                  >
                    <MapRounded sx={{ fontSize: 14 }} /> View Floor Plan
                  </Box>
                )}
              </Box>
              {/* Captures within this floor */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(4,1fr)' }, gap: 2 }}>
                {group.captures.map(c => <CaptureCard key={c.id} capture={c} hasTour={tourCaptureIds.has(c.id)} onDelete={setDeleteTarget} />)}
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <Box sx={{ display: 'grid', width: '100%', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(4,1fr)' }, gap: 2 }}>
            {paginatedFiltered.map(c => <CaptureCard key={c.id} capture={c} hasTour={tourCaptureIds.has(c.id)} />)}
          </Box>
          {totalPages > 1 && (
            <Pagination 
              count={totalPages} 
              page={page} 
              onChange={(_, p) => setPage(p)} 
              color="primary" 
              sx={{ '& .MuiPaginationItem-root': { fontWeight: 600 } }}
            />
          )}
        </Box>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this capture?"
        description={`The capture for ${deleteTarget?.roomName ?? 'this point'}${deleteTarget ? ` (${deleteTarget.towerName} · ${deleteTarget.floorLabel})` : ''} and any tour generated from it will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete capture"
        destructive
        onConfirm={() => { if (deleteTarget) deleteCapture(deleteTarget.id); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
