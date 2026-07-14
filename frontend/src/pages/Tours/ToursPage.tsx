import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, InputBase, Menu, MenuItem, Pagination, useMediaQuery, useTheme } from '@mui/material';
import {
  ViewInArRounded, PlayArrowRounded, CameraAltRounded,
  KeyboardArrowDownRounded, CheckRounded, SearchRounded, ArrowBackRounded, DeleteRounded,
  BusinessRounded, LayersRounded, SortRounded, ArrowDownwardRounded, ArrowUpwardRounded,
  StarRounded, StarBorderRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig } from '@/data/mockData';
import type { MockTour } from '@/data/mockData';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore , getRoleLandingPath } from '@store/authStore';
import { useFavoriteToursStore, EMPTY_FAVORITES } from '@store/favoriteToursStore';
import { buildFloorOptions, floorSelectionLabel, locationFilterMenuPaperSx, locationFilterToolbarSx, type FloorOption } from '@/utils/locationFilters';
import { resolveTourThumbnailUrl } from '@/utils/captureMedia';

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

const TOURS_PAGE_SIZE_DESKTOP = 8; // 4 columns × 2 rows
const TOURS_PAGE_SIZE_MOBILE = 9;  // 3 columns × 3 rows

const TOURS_GRID_SX = {
  display: 'grid',
  width: '100%',
  minWidth: 0,
  gridTemplateColumns: {
    xs: 'repeat(3, minmax(0, 1fr))',
    sm: 'repeat(4, minmax(0, 1fr))',
  },
  gap: { xs: 0.75, sm: 2 },
} as const;

function TourCard({
  tour,
  thumbUrl,
  showProjectName,
  compact,
  isFavorite,
  onToggleFavorite,
  onDelete,
}: {
  tour: MockTour;
  thumbUrl: string;
  showProjectName?: boolean;
  compact?: boolean;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const st = (statusConfig.tour as Record<string, { label: string; color: string; bg: string }>)[tour.status] ?? statusConfig.tour.draft;
  const dot = STATUS_DOT[tour.status] ?? P.subtle;
  const projectShort = tour.projectName.replace(/^My Home\s+/i, '');
  const title = compact ? tour.floorLabel : tour.roomName;
  const locationLabel = compact && showProjectName
    ? `${projectShort} · ${tour.towerName}`
    : showProjectName
      ? `${tour.projectName} · ${tour.towerName} · ${tour.floorLabel}`
      : `${tour.towerName} · ${tour.floorLabel}`;

  return (
    <Box
      component={Link}
      to={`/tours/${tour.id}`}
      sx={{
        display: 'block', textDecoration: 'none',
        minWidth: 0, width: '100%', overflow: 'hidden',
        transition: `transform ${motion.durationNormal} ${motion.easeOut}`,
        '@media (hover: hover)': {
          '&:hover': { transform: 'translateY(-3px)' },
          '&:hover .tour-thumb': { boxShadow: '0 12px 32px rgba(15,23,42,0.14)' },
          '&:hover .tour-play': { opacity: 1, transform: 'scale(1)' },
          '&:hover .tour-delete': { opacity: 1 },
          '&:hover .tour-fav': { opacity: 1 },
        },
      }}
    >
      <Box
        className="tour-thumb"
        sx={{
          position: 'relative', width: '100%', aspectRatio: '4 / 3',
          borderRadius: { xs: '10px', sm: '14px' }, overflow: 'hidden',
          background: tour.gradient,
          boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
          transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}`,
        }}
      >
        <Box
          component="img"
          src={thumbUrl}
          alt=""
          loading="lazy"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <Box className="tour-play" sx={{ position: 'absolute', inset: 0, display: { xs: 'none', sm: 'flex' }, alignItems: 'center', justifyContent: 'center', opacity: 0, transform: 'scale(0.85)', transition: `opacity ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}` }}>
          <Box sx={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PlayArrowRounded sx={{ color: '#fff', fontSize: 24 }} />
          </Box>
        </Box>
        <Box sx={{ position: 'absolute', top: { xs: 4, sm: 8 }, left: { xs: 4, sm: 8 }, display: 'flex', alignItems: 'center', gap: 0.5, px: { xs: 0.5, sm: 0.875 }, py: { xs: 0.25, sm: 0.375 }, borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }}>
          <ViewInArRounded sx={{ color: '#fff', fontSize: { xs: 9, sm: 11 } }} />
          <Typography sx={{ fontSize: { xs: '0.5rem', sm: '0.5625rem' }, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', display: { xs: 'none', sm: 'block' } }}>360°</Typography>
        </Box>
        <Box sx={{ position: 'absolute', top: { xs: 4, sm: 8 }, right: { xs: 4, sm: 8 }, px: { xs: 0.5, sm: 1 }, py: { xs: 0.25, sm: 0.375 }, borderRadius: '5px', backgroundColor: st.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {compact ? (
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: st.color }} />
          ) : (
            <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: st.color }}>{st.label}</Typography>
          )}
        </Box>
        <Box
          className="tour-fav"
          sx={{
            position: 'absolute', bottom: 8, left: 8, zIndex: 10,
            opacity: { xs: 1, sm: isFavorite ? 1 : 0 },
            transition: `opacity ${motion.durationNormal} ${motion.easeOut}`,
          }}
        >
          <Box
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            sx={{
              width: 32, height: 32, borderRadius: '8px',
              backgroundColor: isFavorite ? 'rgba(245,158,11,0.95)' : 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background-color 150ms ease, transform 150ms ease',
              '&:hover': { backgroundColor: isFavorite ? 'rgba(217,119,6,1)' : 'rgba(0,0,0,0.7)', transform: 'scale(1.05)' },
            }}
          >
            {isFavorite
              ? <StarRounded sx={{ color: '#fff', fontSize: 16 }} />
              : <StarBorderRounded sx={{ color: '#fff', fontSize: 16 }} />}
          </Box>
        </Box>
        <Box className="tour-delete" sx={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10, opacity: 0, display: { xs: 'none', sm: 'block' }, transition: `opacity ${motion.durationNormal} ${motion.easeOut}` }}>
          <Box
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            sx={{ width: 32, height: 32, borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.9)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background-color 150ms ease, transform 150ms ease', '&:hover': { backgroundColor: 'rgba(220,38,38,1)', transform: 'scale(1.05)' } }}
          >
            <DeleteRounded sx={{ color: '#fff', fontSize: 16 }} />
          </Box>
        </Box>
      </Box>

      <Box sx={{ pt: { xs: 0.5, sm: 1.25 }, px: 0, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: { xs: '0.6875rem', sm: '0.875rem' }, fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', minWidth: 0 }}>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.375, sm: 0.75 }, mt: { xs: 0.25, sm: 0.375 }, minWidth: 0 }}>
          <Box sx={{ width: { xs: 5, sm: 6 }, height: { xs: 5, sm: 6 }, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
          <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: { xs: '0.5625rem', sm: '0.75rem' }, color: P.muted }}>
            {locationLabel}
          </Typography>
        </Box>
        {!compact && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.375, color: P.subtle }}>
            <CameraAltRounded sx={{ fontSize: 11 }} />
            <Typography sx={{ fontSize: '0.6875rem', color: 'inherit' }}>{tour.captures} captures</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default function ToursPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const user = useAuthStore(s => s.user);
  const role = user?.role || 'default';
  
  const [projectId, setProjectId] = useState<string>(() => sessionStorage.getItem(`tours_projectId_${role}`) || '');
  const [towerId, setTowerId]     = useState<string>(() => sessionStorage.getItem(`tours_towerId_${role}`) || '');
  const [floorId, setFloorId]     = useState<string>(() => sessionStorage.getItem(`tours_floorId_${role}`) || '');
  
  const [query, setQuery]             = useState('');
  const [sortOrder, setSortOrder]     = useState<'latest' | 'oldest'>('latest');
  const [viewMode, setViewMode]       = useState<'all' | 'favorites'>('all');
  const [menuAnchor, setMenuAnchor]   = useState<null | HTMLElement>(null);
  const [towerMenuAnchor, setTowerMenuAnchor] = useState<null | HTMLElement>(null);
  const [floorMenuAnchor, setFloorMenuAnchor] = useState<null | HTMLElement>(null);
  const [sortAnchor, setSortAnchor]   = useState<null | HTMLElement>(null);
  const towerPillRef = useRef<HTMLDivElement>(null);
  const [floorMenuWidth, setFloorMenuWidth] = useState<number | undefined>();

  const allTours    = useWorkflowStore(s => s.tours);
  const allCaptures = useWorkflowStore(s => s.captures);
  const allProjects = useWorkflowStore(s => s.projects);
  const allTowers   = useWorkflowStore(s => s.towers);
  const allFloors   = useWorkflowStore(s => s.floors);
  const deleteTour  = useWorkflowStore(s => s.deleteTour);
  const favoritesMap = useFavoriteToursStore(s =>
    user?.id ? (s.byUser[user.id] ?? EMPTY_FAVORITES) : EMPTY_FAVORITES,
  );
  const toggleFavorite = useFavoriteToursStore(s => s.toggleFavorite);
  const removeFavorite = useFavoriteToursStore(s => s.removeFavorite);
  const favoriteIds = useMemo(() => new Set(Object.keys(favoritesMap)), [favoritesMap]);
  const favoriteCount = useMemo(
    () => allTours.filter(t => favoriteIds.has(t.id)).length,
    [allTours, favoriteIds],
  );
  
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [page, setPage] = useState(1);
  const toursPerPage = isMobile ? TOURS_PAGE_SIZE_MOBILE : TOURS_PAGE_SIZE_DESKTOP;

  const handleProjectSelect = (id: string) => { 
    setProjectId(id); setTowerId(id === 'all' ? '' : 'all'); setFloorId(id === 'all' ? '' : 'all'); setMenuAnchor(null); 
    sessionStorage.setItem(`tours_projectId_${role}`, id);
    sessionStorage.setItem(`tours_towerId_${role}`, id === 'all' ? '' : 'all');
    sessionStorage.setItem(`tours_floorId_${role}`, id === 'all' ? '' : 'all');
  };
  const handleTowerSelect = (id: string) => { 
    setTowerId(id); setFloorId('all'); setTowerMenuAnchor(null); 
    sessionStorage.setItem(`tours_towerId_${role}`, id);
    sessionStorage.setItem(`tours_floorId_${role}`, 'all');
  };
  const handleFloorSelect = (id: string) => { 
    setFloorId(id); setFloorMenuAnchor(null); 
    sessionStorage.setItem(`tours_floorId_${role}`, id);
  };

  const projects = useMemo(() => allProjects.filter(p => !p.archived), [allProjects]);
  const availableTowers = useMemo(() => !projectId || projectId === 'all' ? [] : allTowers.filter(t => t.projectId === projectId).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true})), [allTowers, projectId]);
  const availableFloors = useMemo((): FloorOption[] => {
    if (!projectId || projectId === 'all' || !towerId) return [];
    const towerIds = new Set(availableTowers.map(t => t.id));
    return buildFloorOptions(allFloors, towerId, towerIds);
  }, [allFloors, projectId, towerId, availableTowers]);

  const filtered = useMemo(() => {
    const list = allTours.filter(t => {
      if (viewMode === 'favorites' && !favoriteIds.has(t.id)) return false;
      const matchProject = !projectId || projectId === 'all' || t.projectId === projectId;
      const matchTower   = !towerId || towerId === 'all' || t.towerId === towerId;
      const floorLabel   = floorSelectionLabel(floorId, availableFloors);
      const matchFloor   = !floorId || floorId === 'all' || (floorLabel !== null && t.floorLabel === floorLabel);
      const q = query.trim().toLowerCase();
      const matchQuery   = !q || t.roomName.toLowerCase().includes(q) || t.projectName.toLowerCase().includes(q) || t.towerName.toLowerCase().includes(q) || t.floorLabel.toLowerCase().includes(q);

      return matchProject && matchTower && matchFloor && matchQuery;
    });
    const dir = sortOrder === 'oldest' ? 1 : -1;
    return [...list].sort((a, b) => dir * String(a.lastCapture ?? '').localeCompare(String(b.lastCapture ?? '')));
  }, [allTours, projectId, towerId, floorId, availableFloors, query, sortOrder, viewMode, favoriteIds]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / toursPerPage));
  const paginatedTours = useMemo(
    () => filtered.slice((page - 1) * toursPerPage, page * toursPerPage),
    [filtered, page, toursPerPage],
  );

  useEffect(() => {
    setPage(1);
  }, [projectId, towerId, floorId, query, sortOrder, viewMode]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const selectedProject = projects.find(p => p.id === projectId);
  const selectedTower   = availableTowers.find(t => t.id === towerId);
  const selectedFloor   = availableFloors.find(f => f.id === floorId);

  const selectedCount   = !projectId || projectId === 'all'
    ? allTours.length
    : allTours.filter(t => t.projectId === projectId).length;

  const towerTourCount = (id: string) => allTours.filter(t =>
    t.projectId === projectId && (id === 'all' || t.towerId === id),
  ).length;

  const floorTourCount = (id: string) => {
    const label = floorSelectionLabel(id, availableFloors);
    return allTours.filter(t => {
      if (t.projectId !== projectId) return false;
      if (towerId && towerId !== 'all' && t.towerId !== towerId) return false;
      if (id === 'all') return true;
      return label !== null && t.floorLabel === label;
    }).length;
  };

  const isSelectionComplete = Boolean(projectId) || viewMode === 'favorites';
  const showTowerFilter = Boolean(projectId && projectId !== 'all');
  const showFloorFilter = showTowerFilter && Boolean(towerId);
  const filterCount = 1 + (showTowerFilter ? 1 : 0) + (showFloorFilter ? 1 : 0);
  const toolbarLayout = locationFilterToolbarSx(filterCount);
  const showProjectName = !projectId || projectId === 'all';

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6, width: '100%', minWidth: 0, overflow: 'hidden' }}>
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
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted, mb: 2 }}>
          {allTours.length} tour{allTours.length !== 1 ? 's' : ''} · {projects.length} project{projects.length !== 1 ? 's' : ''}
          {favoriteCount > 0 ? ` · ${favoriteCount} favorite${favoriteCount !== 1 ? 's' : ''}` : ''}
        </Typography>

        {/* All / Favorites switcher */}
        <Box sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.5,
          p: 0.5, borderRadius: '12px', backgroundColor: P.bg, border: `1px solid ${P.border}`,
        }}>
          {([
            { id: 'all' as const, label: 'All tours', icon: <ViewInArRounded sx={{ fontSize: 15 }} /> },
            { id: 'favorites' as const, label: 'Favorites', icon: <StarRounded sx={{ fontSize: 15 }} />, count: favoriteCount },
          ]).map(tab => {
            const active = viewMode === tab.id;
            return (
              <Box
                key={tab.id}
                onClick={() => setViewMode(tab.id)}
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.75,
                  px: 1.5, py: 0.75, borderRadius: '9px', cursor: 'pointer',
                  backgroundColor: active ? P.white : 'transparent',
                  color: active ? P.strong : P.muted,
                  fontSize: '0.8125rem', fontWeight: active ? 700 : 600,
                  boxShadow: active ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                  transition: T,
                  '&:hover': { color: P.strong },
                }}
              >
                <Box sx={{ color: active && tab.id === 'favorites' ? '#f59e0b' : 'inherit', display: 'flex' }}>{tab.icon}</Box>
                {tab.label}
                {tab.count !== undefined && (
                  <Box sx={{
                    px: 0.625, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700,
                    backgroundColor: active ? 'rgba(245,158,11,0.12)' : P.white,
                    color: active ? '#d97706' : P.muted,
                  }}>
                    {tab.count}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Toolbar */}
      <Box sx={toolbarLayout.row}>
        <Box sx={toolbarLayout.group}>
        {/* Project pill */}
        <Box
          onClick={e => setMenuAnchor(e.currentTarget)}
          sx={{
            ...toolbarLayout.pill,
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${menuAnchor ? P.blue : P.border}`,
            backgroundColor: menuAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            justifyContent: 'space-between',
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
        {showTowerFilter && (
          <Box ref={towerPillRef} onClick={(e) => setTowerMenuAnchor(e.currentTarget)} sx={{
            ...toolbarLayout.pill,
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${towerMenuAnchor ? P.blue : P.border}`,
            backgroundColor: towerMenuAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            justifyContent: 'space-between',
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
        {showFloorFilter && (
          <Box
            onClick={(e) => {
              setFloorMenuWidth(towerPillRef.current?.offsetWidth ?? e.currentTarget.offsetWidth);
              setFloorMenuAnchor(e.currentTarget);
            }}
            sx={{
            ...toolbarLayout.pill,
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${floorMenuAnchor ? P.blue : P.border}`,
            backgroundColor: floorMenuAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            justifyContent: 'space-between',
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

        {isSelectionComplete && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: { xs: '100%', md: 'auto' }, flexShrink: 0, flexWrap: 'wrap' }}>
            {/* Sort */}
            <Box
              onClick={e => setSortAnchor(e.currentTarget)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
                border: `1.5px solid ${sortAnchor ? P.blue : P.border}`,
                backgroundColor: sortAnchor ? P.blueSoft : P.white,
                color: P.strong, fontSize: '0.8125rem', fontWeight: 600,
                transition: T, '&:hover': { borderColor: P.blue },
                whiteSpace: 'nowrap',
              }}
            >
              <SortRounded sx={{ fontSize: 16, color: P.subtle }} />
              {sortOrder === 'latest' ? 'Latest first' : 'Oldest first'}
              {sortOrder === 'latest'
                ? <ArrowDownwardRounded sx={{ fontSize: 14, color: P.muted }} />
                : <ArrowUpwardRounded sx={{ fontSize: 14, color: P.muted }} />}
            </Box>

            {/* Search */}
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 0.75,
              flex: { xs: 1, md: 'initial' }, width: { xs: 'auto', md: 220 }, minWidth: 0,
              px: 1.25, py: 0.75, borderRadius: '10px', backgroundColor: P.white,
              border: `1.5px solid ${P.border}`, transition: T,
              '&:focus-within': { borderColor: P.blue },
            }}>
              <SearchRounded sx={{ fontSize: 16, color: P.subtle, flexShrink: 0 }} />
              <InputBase placeholder="Search tours…" value={query} onChange={e => setQuery(e.target.value)} sx={{ flex: 1, fontSize: '0.8125rem', '& input::placeholder': { color: P.subtle, opacity: 1 } }} />
            </Box>
          </Box>
        )}
      </Box>

      {/* Sort menu */}
      <Menu
        anchorEl={sortAnchor}
        open={Boolean(sortAnchor)}
        onClose={() => setSortAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { borderRadius: '12px', boxShadow: '0 8px 24px rgba(15,23,42,0.12)', mt: 0.5, border: `1px solid ${colors.borderLight}` } } }}
      >
        <MenuItem
          selected={sortOrder === 'latest'}
          onClick={() => { setSortOrder('latest'); setSortAnchor(null); }}
          sx={{ fontSize: '0.875rem', gap: 1, minWidth: 160, borderRadius: '8px', mx: 0.5 }}
        >
          <ArrowDownwardRounded sx={{ fontSize: 15, color: sortOrder === 'latest' ? colors.primary : colors.textMuted }} /> Latest first
        </MenuItem>
        <MenuItem
          selected={sortOrder === 'oldest'}
          onClick={() => { setSortOrder('oldest'); setSortAnchor(null); }}
          sx={{ fontSize: '0.875rem', gap: 1, minWidth: 160, borderRadius: '8px', mx: 0.5 }}
        >
          <ArrowUpwardRounded sx={{ fontSize: 15, color: sortOrder === 'oldest' ? colors.primary : colors.textMuted }} /> Oldest first
        </MenuItem>
      </Menu>

      {/* Project menu */}
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: locationFilterMenuPaperSx(280, colors.borderLight) } }}
      >
        <MenuItem onClick={() => handleProjectSelect('all')}
          sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, mb: 0.5, '&:hover': { backgroundColor: colors.bg }, backgroundColor: projectId === 'all' ? colors.primarySoft : 'transparent' }}
        >
          <Box sx={{ width: 22, height: 22, borderRadius: '7px', background: `linear-gradient(135deg,${P.subtle},${P.muted})`, flexShrink: 0 }} />
          <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: projectId === 'all' ? 700 : 500, color: projectId === 'all' ? colors.primary : colors.textStrong }}>
            All projects
          </Typography>
          <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
            {allTours.length}
          </Box>
          {projectId === 'all' && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
        </MenuItem>
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
        slotProps={{ paper: { sx: locationFilterMenuPaperSx(260, colors.borderLight) } }}
      >
        <MenuItem onClick={() => handleTowerSelect('all')}
          sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, mb: 0.5, '&:hover': { backgroundColor: colors.bg }, backgroundColor: towerId === 'all' ? colors.primarySoft : 'transparent' }}
        >
          <BusinessRounded sx={{ fontSize: 18, color: towerId === 'all' ? colors.primary : colors.textMuted }} />
          <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: towerId === 'all' ? 700 : 500, color: towerId === 'all' ? colors.primary : colors.textStrong }}>
            All towers
          </Typography>
          <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
            {towerTourCount('all')}
          </Box>
          {towerId === 'all' && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
        </MenuItem>
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
              <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
                {towerTourCount(t.id)}
              </Box>
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
        slotProps={{ paper: { sx: locationFilterMenuPaperSx(floorMenuWidth ?? 260, colors.borderLight) } }}
      >
        <MenuItem onClick={() => handleFloorSelect('all')}
          sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, mb: 0.5, '&:hover': { backgroundColor: colors.bg }, backgroundColor: floorId === 'all' ? colors.primarySoft : 'transparent' }}
        >
          <LayersRounded sx={{ fontSize: 18, color: floorId === 'all' ? colors.primary : colors.textMuted }} />
          <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: floorId === 'all' ? 700 : 500, color: floorId === 'all' ? colors.primary : colors.textStrong }}>
            All floors
          </Typography>
          <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
            {floorTourCount('all')}
          </Box>
          {floorId === 'all' && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
        </MenuItem>
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
              <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
                {floorTourCount(f.id)}
              </Box>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Empty state or Tours List */}
      {!isSelectionComplete ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <LayersRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>Select a project to begin</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Choose a project, or pick All projects to browse every walkthrough.</Typography>
        </Box>
      ) : filtered.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          {viewMode === 'favorites' ? (
            <>
              <StarBorderRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>No favorite tours yet</Typography>
              <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>
                Tap the star on any tour card to save it here.
              </Typography>
            </>
          ) : (
            <>
              <ViewInArRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>No tours found</Typography>
              <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Try a different search or filter.</Typography>
            </>
          )}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: { xs: 2, sm: 3 }, width: '100%', minWidth: 0 }}>
        <Box sx={TOURS_GRID_SX}>
          {paginatedTours.map(tour => (
            <TourCard
              key={tour.id}
              tour={tour}
              thumbUrl={resolveTourThumbnailUrl(tour as typeof tour & Record<string, unknown>, allCaptures)}
              showProjectName={showProjectName}
              compact={isMobile}
              isFavorite={favoriteIds.has(tour.id)}
              onToggleFavorite={() => { if (user?.id) toggleFavorite(user.id, tour.id); }}
              onDelete={() => setDeleteTarget(tour)}
            />
          ))}
        </Box>
        {totalPages > 1 && (
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, p) => setPage(p)}
            color="primary"
            size={isMobile ? 'small' : 'medium'}
            siblingCount={isMobile ? 0 : 1}
            boundaryCount={1}
            sx={{ maxWidth: '100%', '& .MuiPaginationItem-root': { fontWeight: 600 } }}
          />
        )}
        </Box>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this tour?"
        description={`The generated tour for ${deleteTarget?.roomName ?? 'this room'} will be permanently removed. The underlying capture point will still exist. This cannot be undone.`}
        confirmLabel="Delete tour"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            deleteTour(deleteTarget.id);
            if (user?.id) removeFavorite(user.id, deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
