import React, { useState, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Box, Typography, InputBase, Menu, MenuItem, Pagination, useMediaQuery, useTheme } from '@mui/material';
import { CameraAltRounded, ViewInArRounded, SearchRounded, KeyboardArrowDownRounded, CheckRounded, ArrowBackRounded, LayersRounded, MapRounded, DeleteOutlineRounded, BusinessRounded, SortRounded, ArrowDownwardRounded, ArrowUpwardRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig, getRoomHistory } from '@store/workflowSelectors';
import type { MockCapture } from '@/data/mockData';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore , getRoleLandingPath } from '@store/authStore';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { buildFloorOptions, floorSelectionLabel, locationFilterMenuPaperSx, locationFilterToolbarSx, type FloorOption } from '@/utils/locationFilters';
import { resolveCaptureThumbnailUrl } from '@/utils/captureMedia';

// Capture gallery — project-wise selection, calm minimal cards.

const STATUS_FILTERS = ['All', 'Processed', 'In Review', 'Rejected'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const STATUS_DOT: Record<string, string> = {
  processed: colors.success,
  review: colors.warning,
  rejected: colors.danger,
  uploading: colors.info,
};

function CaptureCard({ capture, hasTour, onDelete, showProjectName, compact }: { capture: MockCapture; hasTour: boolean; onDelete?: (c: MockCapture) => void; showProjectName?: boolean; compact?: boolean }) {
  const st = statusConfig.capture[capture.status];
  const history = getRoomHistory(capture);
  const dot = STATUS_DOT[capture.status] ?? colors.textSubdued;
  const thumbUrl = resolveCaptureThumbnailUrl(capture as MockCapture & Record<string, unknown>);
  const projectShort = capture.projectName.replace(/^My Home\s+/i, '');
  const locationLabel = compact && showProjectName
    ? `${projectShort} · ${capture.floorLabel}`
    : showProjectName
      ? `${capture.projectName} · ${capture.towerName} · ${capture.floorLabel}`
      : `${capture.towerName} · ${capture.floorLabel}`;

  return (
    <Box
      component={Link}
      to={`/captures/${capture.id}`}
      sx={{
        display: 'block', textDecoration: 'none',
        minWidth: 0, width: '100%', overflow: 'hidden',
        transition: `transform ${motion.durationNormal} ${motion.easeOut}`,
        '@media (hover: hover)': {
          '&:hover': { transform: 'translateY(-3px)' },
          '&:hover .cap-thumb': { boxShadow: '0 12px 32px rgba(15,23,42,0.14)' },
          '&:hover .cap-open': { opacity: 1 },
          '&:hover .cap-delete': { opacity: 1 },
        },
      }}
    >
      {/* Thumbnail — soft, single subtle tint */}
      <Box
        className="cap-thumb"
        sx={{
          position: 'relative', width: '100%', aspectRatio: '4 / 3', borderRadius: { xs: '10px', sm: '14px' }, overflow: 'hidden',
          background: capture.gradient,
          boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
          transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}`,
        }}
      >
        {thumbUrl ? (
          <Box
            component="img"
            src={thumbUrl}
            alt=""
            loading="lazy"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          // No image yet — a raw 360 still stitching in the background. The
          // card's gradient shows through as the backdrop.
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.75 }}>
            <ViewInArRounded sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 26 }} />
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>
              Processing 360°…
            </Typography>
          </Box>
        )}

        {/* hover: single open hint */}
        <Box className="cap-open" sx={{ position: 'absolute', bottom: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', opacity: 0, transition: `opacity ${motion.durationFast}` }}>
          <ViewInArRounded sx={{ color: '#fff', fontSize: 13 }} />
          <Typography sx={{ fontSize: '0.6875rem', color: '#fff', fontWeight: 600 }}>{hasTour ? 'View image' : 'Open'}</Typography>
        </Box>

        {/* tour marker — one quiet glyph */}
        {hasTour && (
          <Box sx={{ position: 'absolute', top: { xs: 4, sm: 8 }, right: { xs: 4, sm: 8 }, width: { xs: 18, sm: 22 }, height: { xs: 18, sm: 22 }, borderRadius: { xs: '5px', sm: '7px' }, backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ViewInArRounded sx={{ fontSize: { xs: 10, sm: 12 }, color: '#fff' }} />
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
      <Box sx={{ pt: { xs: 0.5, sm: 1.25 }, px: 0, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: { xs: '0.6875rem', sm: '0.875rem' }, fontWeight: 600, color: colors.textStrong, letterSpacing: '-0.01em', minWidth: 0 }}>
          {capture.roomName}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.375, sm: 0.75 }, mt: { xs: 0.25, sm: 0.375 }, minWidth: 0 }}>
          <Box sx={{ width: { xs: 5, sm: 6 }, height: { xs: 5, sm: 6 }, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
          <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: { xs: '0.5625rem', sm: '0.75rem' }, color: colors.textMuted }}>
            {locationLabel}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function isGalleryVisibleCapture(
  c: MockCapture,
  allPinCaptureIds: Set<string>,
  latestPinCaptureIds: Set<string>,
): boolean {
  if (allPinCaptureIds.has(c.id) && !latestPinCaptureIds.has(c.id)) return false;
  if (/^Pin\s+\d+$/i.test(c.roomName ?? '') && !allPinCaptureIds.has(c.id)) return false;
  return true;
}

const CAPTURES_PAGE_SIZE_MOBILE = 9;  // 3 columns × 3 rows
const CAPTURES_PAGE_SIZE_TABLET = 6;  // 3 columns × 2 rows
const CAPTURES_PAGE_SIZE_DESKTOP = 8; // 4 columns × 2 rows

const GALLERY_GRID_SX = {
  display: 'grid',
  width: '100%',
  minWidth: 0,
  gridTemplateColumns: {
    xs: 'repeat(3, minmax(0, 1fr))',
    sm: 'repeat(3, minmax(0, 1fr))',
    md: 'repeat(4, minmax(0, 1fr))',
  },
  gap: { xs: 0.75, sm: 1.5, md: 2 },
} as const;

export default function CapturesPage() {
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const isEngineerView = location.pathname === '/my-captures';
  const user = useAuthStore(s => s.user);
  const role = user?.role || 'default';

  const [projectId, setProjectId] = useState<string>(() => sessionStorage.getItem(`captures_projectId_${role}`) || '');
  const [towerId, setTowerId] = useState<string>(() => sessionStorage.getItem(`captures_towerId_${role}`) || '');
  const [floorId, setFloorId] = useState<string>(() => sessionStorage.getItem(`captures_floorId_${role}`) || '');
  const [sortOrder, setSortOrder] = useState<'latest' | 'oldest'>('latest');
  const [sortAnchor, setSortAnchor] = useState<null | HTMLElement>(null);

  // Reactive: read live data from the workflow store.
  const mockCaptures = useWorkflowStore(s => s.captures);
  const allProjects = useWorkflowStore(s => s.projects);
  const allFloors = useWorkflowStore(s => s.floors);
  const allTowers = useWorkflowStore(s => s.towers);
  const allPins = useWorkflowStore(s => s.capturePins);
  const tours = useWorkflowStore(s => s.tours);
  const deleteCapture = useWorkflowStore(s => s.deleteCapture);

  // Set of capture IDs that are the LATEST capture for their pin.
  // Non-latest captures in a pin's history should not appear as standalone gallery cards.
  const latestPinCaptureIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pin of allPins) {
      if (pin.captureIds.length > 0) {
        ids.add(pin.captureIds[pin.captureIds.length - 1]);
      }
    }
    return ids;
  }, [allPins]);

  // Set of ALL capture IDs that belong to any pin (including non-latest history entries).
  const allPinCaptureIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pin of allPins) {
      for (const id of pin.captureIds) ids.add(id);
    }
    return ids;
  }, [allPins]);
  const [deleteTarget, setDeleteTarget] = useState<MockCapture | null>(null);
  const tourCaptureIds = useMemo(() => new Set(tours.map(t => t.captureId)), [tours]);

  // Gallery shows one card per pin (latest only). Deleting that card must remove the
  // whole pin timeline — otherwise the previous visit becomes the new latest and
  // reappears in the same slot (looks stacked; requires multiple deletes).
  const confirmDeleteCapture = () => {
    if (!deleteTarget) return;
    const pin = allPins.find(p => p.captureIds.includes(deleteTarget.id));
    const idsToDelete = pin ? [...pin.captureIds] : [deleteTarget.id];
    idsToDelete.forEach(id => deleteCapture(id));
    setDeleteTarget(null);
  };

  // For field engineers on /my-captures, restrict the project list and captures
  // to their assigned projects only (same scoping as CaptureWorkflowPage).
  const assignedProjectIds = useMemo(() => {
    if (!isEngineerView) return null;
    const ids = user?.assignedProjectIds ?? [];
    return ids.length > 0 ? new Set(ids) : null;
  }, [isEngineerView, user?.assignedProjectIds]);

  const PROJECTS_WITH_CAPTURES = useMemo(() => {
    const base = allProjects.filter(p => !p.archived);
    return assignedProjectIds ? base.filter(p => assignedProjectIds.has(p.id)) : base;
  }, [allProjects, assignedProjectIds]);

  const availableTowers = useMemo(() => !projectId || projectId === 'all' ? [] : allTowers.filter(t => t.projectId === projectId).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true})), [allTowers, projectId]);
  const availableFloors = useMemo((): FloorOption[] => {
    if (!projectId || projectId === 'all' || !towerId) return [];
    const towerIds = new Set(availableTowers.map(t => t.id));
    return buildFloorOptions(allFloors, towerId, towerIds);
  }, [allFloors, projectId, towerId, availableTowers]);

  const galleryCaptures = useMemo(() => mockCaptures.filter(c => {
    if (assignedProjectIds && !assignedProjectIds.has(c.projectId)) return false;
    return isGalleryVisibleCapture(c, allPinCaptureIds, latestPinCaptureIds);
  }), [mockCaptures, assignedProjectIds, allPinCaptureIds, latestPinCaptureIds]);

  const filtered = useMemo(() => {
    const list = galleryCaptures.filter(c => {
      const matchesProject = !projectId || projectId === 'all' || c.projectId === projectId;
      const matchesTower = !towerId || towerId === 'all' || c.towerId === towerId;
      const floorLabel = floorSelectionLabel(floorId, availableFloors);
      const matchesFloor = !floorId || floorId === 'all' || (floorLabel !== null && c.floorLabel === floorLabel);
      return matchesProject && matchesTower && matchesFloor;
    });
    const dir = sortOrder === 'oldest' ? 1 : -1;
    const sortKey = (c: MockCapture) => String(c.capturedAt ?? c.uploadedAt ?? '');
    return [...list].sort((a, b) => dir * sortKey(a).localeCompare(sortKey(b)));
  }, [galleryCaptures, projectId, towerId, floorId, availableFloors, sortOrder]);

  const [page, setPage] = useState(1);
  const itemsPerPage = isMobile ? CAPTURES_PAGE_SIZE_MOBILE : isMdUp ? CAPTURES_PAGE_SIZE_DESKTOP : CAPTURES_PAGE_SIZE_TABLET;

  // Group captures by Tower → Floor so the history reads structurally:
  // each floor is a section holding its own captures, with a link to its plan.
  const buildFloorGroups = (captures: MockCapture[]) => {
    interface FloorGroup { projectId: string; towerId: string; floorId: string; towerName: string; floorLabel: string; projectName: string; captures: MockCapture[]; }
    const map = new Map<string, FloorGroup>();
    for (const c of captures) {
      const key = `${c.projectId}::${c.towerId}::${c.floorLabel}`;
      if (!map.has(key)) {
        const floor = allFloors.find(f => f.towerId === c.towerId && f.label === c.floorLabel);
        map.set(key, { projectId: c.projectId, towerId: c.towerId, floorId: floor?.id ?? '', towerName: c.towerName, floorLabel: c.floorLabel, projectName: c.projectName, captures: [] });
      }
      map.get(key)!.captures.push(c);
    }
    return [...map.values()].sort((a, b) =>
      a.towerName.localeCompare(b.towerName, undefined, { numeric: true }) ||
      a.floorLabel.localeCompare(b.floorLabel, undefined, { numeric: true })
    );
  };

  const groupedByFloor = useMemo(() => buildFloorGroups(filtered), [filtered, allFloors]);

  // Engineer view paginates whole floor-groups per page — a floor's captures
  // never split across pages, even if that makes a page larger/smaller than
  // itemsPerPage. Packing stops as soon as adding the next group would exceed
  // the target, unless the page is still empty (then it takes that one group).
  const floorGroupPages = useMemo(() => {
    const pages: (typeof groupedByFloor)[] = [];
    let current: typeof groupedByFloor = [];
    let currentCount = 0;
    for (const group of groupedByFloor) {
      if (current.length > 0 && currentCount + group.captures.length > itemsPerPage) {
        pages.push(current);
        current = [];
        currentCount = 0;
      }
      current.push(group);
      currentCount += group.captures.length;
    }
    if (current.length > 0) pages.push(current);
    return pages.length > 0 ? pages : [[]];
  }, [groupedByFloor, itemsPerPage]);

  const totalPages = isEngineerView ? floorGroupPages.length : Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginatedFiltered = useMemo(() => filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage), [filtered, page, itemsPerPage]);
  const paginatedGroupedByFloor = floorGroupPages[Math.min(page, floorGroupPages.length) - 1] ?? [];

  React.useEffect(() => {
    setPage(1);
  }, [projectId, towerId, floorId, sortOrder]);

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const floorTotalCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of groupedByFloor) {
      map.set(`${g.projectId}::${g.towerId}::${g.floorLabel}`, g.captures.length);
    }
    return map;
  }, [groupedByFloor]);

  const pageCapturesCount = isEngineerView
    ? paginatedGroupedByFloor.reduce((sum, g) => sum + g.captures.length, 0)
    : paginatedFiltered.length;
  const pageStart = filtered.length === 0 ? 0 : isEngineerView
    ? floorGroupPages.slice(0, page - 1).reduce((sum, grp) => sum + grp.reduce((s, g) => s + g.captures.length, 0), 0) + 1
    : (page - 1) * itemsPerPage + 1;
  const pageEnd = pageStart === 0 ? 0 : pageStart - 1 + pageCapturesCount;

  const showProjectName = !projectId || projectId === 'all';

  const pendingCount = mockCaptures.filter(c => c.status === 'review').length;

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [towerMenuAnchor, setTowerMenuAnchor] = useState<null | HTMLElement>(null);
  const [floorMenuAnchor, setFloorMenuAnchor] = useState<null | HTMLElement>(null);
  const towerPillRef = useRef<HTMLDivElement>(null);
  const [floorMenuWidth, setFloorMenuWidth] = useState<number | undefined>();
  const handleProjectSelect = (id: string) => { 
    setProjectId(id);
    setTowerId(id === 'all' ? '' : 'all');
    setFloorId(id === 'all' ? '' : 'all');
    setMenuAnchor(null); 
    sessionStorage.setItem(`captures_projectId_${role}`, id);
    sessionStorage.setItem(`captures_towerId_${role}`, id === 'all' ? '' : 'all');
    sessionStorage.setItem(`captures_floorId_${role}`, id === 'all' ? '' : 'all');
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
  
  const selectedCount = !projectId || projectId === 'all'
    ? galleryCaptures.length
    : galleryCaptures.filter(c => c.projectId === projectId).length;

  const towerCaptureCount = (id: string) => galleryCaptures.filter(c => {
    if (projectId && projectId !== 'all' && c.projectId !== projectId) return false;
    return id === 'all' || c.towerId === id;
  }).length;

  const floorCaptureCount = (id: string) => {
    const label = floorSelectionLabel(id, availableFloors);
    return galleryCaptures.filter(c => {
      if (projectId && projectId !== 'all' && c.projectId !== projectId) return false;
      if (towerId && towerId !== 'all' && c.towerId !== towerId) return false;
      if (id === 'all') return true;
      return label !== null && c.floorLabel === label;
    }).length;
  };

  const isSelectionComplete = Boolean(projectId);
  const showTowerFilter = Boolean(projectId && projectId !== 'all');
  const showFloorFilter = showTowerFilter && Boolean(towerId);
  const filterCount = 1 + (showTowerFilter ? 1 : 0) + (showFloorFilter ? 1 : 0);
  const toolbarLayout = locationFilterToolbarSx(filterCount);


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
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6, width: '100%', minWidth: 0, overflow: 'hidden' }}>
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
      <Box sx={toolbarLayout.row}>
        <Box sx={toolbarLayout.group}>
        {/* Project pill */}
        <Box onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{
          ...toolbarLayout.pill,
          display: 'flex', alignItems: 'center', gap: 1,
          px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
          border: `1.5px solid ${menuAnchor ? P.blue : P.border}`,
          backgroundColor: menuAnchor ? P.blueSoft : P.white,
          transition: T, '&:hover': { borderColor: P.blue },
          justifyContent: 'space-between',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
            <Box sx={{ width: 18, height: 18, borderRadius: '5px', background: selectedProject ? selectedProject.gradient : `linear-gradient(135deg,${P.subtle},${P.muted})`, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedProject ? selectedProject.name : (projectId === 'all' ? 'All projects' : 'Select a project')}
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

        {/* Sort */}
        {isSelectionComplete && (
          <Box
            onClick={e => setSortAnchor(e.currentTarget)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0,
              px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
              border: `1.5px solid ${sortAnchor ? P.blue : P.border}`,
              backgroundColor: sortAnchor ? P.blueSoft : P.white,
              color: P.strong, fontSize: '0.8125rem', fontWeight: 600,
              transition: T, '&:hover': { borderColor: P.blue },
              whiteSpace: 'nowrap', alignSelf: { xs: 'stretch', md: 'center' },
              justifyContent: { xs: 'space-between', md: 'flex-start' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <SortRounded sx={{ fontSize: 16, color: P.subtle }} />
              {sortOrder === 'latest' ? 'Latest first' : 'Oldest first'}
            </Box>
            {sortOrder === 'latest'
              ? <ArrowDownwardRounded sx={{ fontSize: 14, color: P.muted }} />
              : <ArrowUpwardRounded sx={{ fontSize: 14, color: P.muted }} />}
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
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: locationFilterMenuPaperSx(280, colors.borderLight) } }}
      >
        {[{ id: 'all', name: 'All projects', gradient: `linear-gradient(135deg, ${colors.textSubdued} 0%, ${colors.textMuted} 100%)`, count: galleryCaptures.length },
          ...PROJECTS_WITH_CAPTURES.map(p => ({ id: p.id, name: p.name, gradient: p.gradient, count: galleryCaptures.filter(c => c.projectId === p.id).length }))]
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
        slotProps={{ paper: { sx: locationFilterMenuPaperSx(200, colors.borderLight) } }}
      >
        {[{ id: 'all', name: 'All towers' }, ...availableTowers].map(opt => {
          const isActive = towerId === opt.id;
          return (
            <MenuItem
              key={opt.id}
              onClick={() => handleTowerSelect(opt.id)}
              sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
            >
              <BusinessRounded sx={{ fontSize: 18, color: isActive ? colors.primary : colors.textMuted }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong, letterSpacing: '-0.01em' }}>
                {opt.name}
              </Typography>
              <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
                {towerCaptureCount(opt.id)}
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
        slotProps={{ paper: { sx: locationFilterMenuPaperSx(floorMenuWidth ?? 200, colors.borderLight) } }}
      >
        {[{ id: 'all', label: 'All floors' }, ...availableFloors].map(opt => {
          const isActive = floorId === opt.id;
          return (
            <MenuItem
              key={opt.id}
              onClick={() => handleFloorSelect(opt.id)}
              sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
            >
              <LayersRounded sx={{ fontSize: 18, color: isActive ? colors.primary : colors.textMuted }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong, letterSpacing: '-0.01em' }}>
                {opt.label}
              </Typography>
              <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
                {floorCaptureCount(opt.id)}
              </Box>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!isSelectionComplete ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <LayersRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>Select a project to begin</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Choose a project, or pick All projects to browse every capture.</Typography>
        </Box>
      ) : filtered.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <CameraAltRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>No captures found</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Try a different project, tower, or floor.</Typography>
        </Box>
      ) : isEngineerView ? (
        /* Engineer history — grouped by floor, paginated to limit vertical scroll */
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: { xs: 2, sm: 3 }, width: '100%', minWidth: 0 }}>
          <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
            {paginatedGroupedByFloor.map(group => {
              const floorKey = `${group.projectId}::${group.towerId}::${group.floorLabel}`;
              const floorTotal = floorTotalCounts.get(floorKey) ?? group.captures.length;
              const captureLabel = group.captures.length === floorTotal
                ? `${floorTotal} capture${floorTotal !== 1 ? 's' : ''}`
                : `${group.captures.length} of ${floorTotal} captures`;

              return (
              <Box key={`${group.projectName}-${group.towerName}-${group.floorLabel}`}>
                {/* Floor section header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.75 }}>
                  <Box sx={{ width: 30, height: 30, borderRadius: '8px', backgroundColor: P.blueSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <LayersRounded sx={{ fontSize: 17, color: P.blue }} />
                  </Box>
                  <Box sx={{ minWidth: 0, mr: { xs: 'auto', sm: 0 } }}>
                    <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, letterSpacing: '-0.02em', lineHeight: 1.2 }} noWrap>
                      {showProjectName ? `${group.projectName} · ` : ''}{group.towerName} · {group.floorLabel}
                    </Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
                      {captureLabel}
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
                <Box sx={GALLERY_GRID_SX}>
                  {group.captures.map(c => <CaptureCard key={c.id} capture={c} hasTour={tourCaptureIds.has(c.id)} onDelete={setDeleteTarget} showProjectName={showProjectName} compact={isMobile} />)}
                </Box>
              </Box>
            );
            })}
          </Box>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: '100%' }}>
              <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>
                Showing {pageStart}–{pageEnd} of {filtered.length} captures · {groupedByFloor.length} floor{groupedByFloor.length !== 1 ? 's' : ''}
              </Typography>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => {
                  setPage(p);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                color="primary"
                size={isMobile ? 'small' : 'medium'}
                siblingCount={isMobile ? 0 : 1}
                boundaryCount={1}
                sx={{ maxWidth: '100%', '& .MuiPaginationItem-root': { fontWeight: 600 } }}
              />
            </Box>
          )}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: { xs: 2, sm: 4 }, width: '100%', minWidth: 0 }}>
          <Box sx={GALLERY_GRID_SX}>
            {paginatedFiltered.map(c => <CaptureCard key={c.id} capture={c} hasTour={tourCaptureIds.has(c.id)} showProjectName={showProjectName} compact={isMobile} />)}
          </Box>
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: '100%' }}>
              <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>
                Showing {pageStart}–{pageEnd} of {filtered.length} captures
              </Typography>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => {
                  setPage(p);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                color="primary"
                size={isMobile ? 'small' : 'medium'}
                siblingCount={isMobile ? 0 : 1}
                boundaryCount={1}
                sx={{ maxWidth: '100%', '& .MuiPaginationItem-root': { fontWeight: 600 } }}
              />
            </Box>
          )}
        </Box>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this capture?"
        description={`The capture for ${deleteTarget?.roomName ?? 'this point'}${deleteTarget ? ` (${deleteTarget.towerName} · ${deleteTarget.floorLabel})` : ''}, any earlier visits at this point, and any tour generated from them will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete capture"
        destructive
        onConfirm={confirmDeleteCapture}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
