import React, { useState, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Box, Typography, InputBase, Menu, MenuItem, Pagination, useMediaQuery, useTheme } from '@mui/material';
import { CameraAltRounded, ViewInArRounded, SearchRounded, KeyboardArrowDownRounded, CheckRounded, ArrowBackRounded, LayersRounded, MapRounded, DeleteOutlineRounded, DeleteSweepRounded, BusinessRounded, SortRounded, ArrowDownwardRounded, ArrowUpwardRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig, getRoomHistory, getPinForCapture } from '@store/workflowSelectors';
import type { MockCapture } from '@/data/mockData';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, getRoleLandingPath } from '@store/authStore';
import { can } from '@/utils/permissions';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { buildFloorOptions, floorSelectionLabel, locationFilterMenuPaperSx, locationFilterToolbarSx, type FloorOption } from '@/utils/locationFilters';
import { panoramaSourceOf, type RawCapture } from '@/utils/panoramaSource';
import { PanoramaView, useNearViewport } from '@/components/ConstructionProgress/EvidencePanoramaCard';
import { paginateGroups } from '@/utils/paginateGroups';
import { formatPinLocationLabel, formatTowerLabel, enrichCaptureLocation } from '@/utils/pinLabels';
import {
  capturesInSelection,
  collectFloorCaptureIds,
  filterGalleryCaptures,
} from '@/utils/captureGallery';
import { filterOwnCaptures, ownCaptureIdSet, pinCaptureIdsForUser } from '@/utils/captureOwnership';
import { reconcileStitchedCaptureMedia } from '@/store/fileUploadQueue';

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
  // The 360 image itself, so the card can be dragged to look around (same viewer as Evidence images).
  const source = useMemo(() => panoramaSourceOf(capture as unknown as RawCapture), [capture]);
  const hostRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(hostRef);
  const projectShort = capture.projectName.replace(/^My Home\s+/i, '');
  // Prefer live Flat · Room from the pin — capture.roomName is frozen at create
  // time and may still say "Pin N" for older uploads.
  const pins = useWorkflowStore(s => s.capturePins);
  const pin = getPinForCapture(pins, capture.id);
  const displayName = formatPinLocationLabel(pin, capture.roomName);
  const towerLabel = formatTowerLabel(capture.towerName);
  const locationLabel = compact && showProjectName
    ? `${(projectShort || 'Project').trim()} · ${capture.floorLabel || 'Floor'}`
    : showProjectName
      ? [capture.projectName, towerLabel, capture.floorLabel].filter(Boolean).join(' · ') || capture.floorLabel
      : [towerLabel, capture.floorLabel].filter(Boolean).join(' · ') || capture.floorLabel;

  return (
    <Box
      sx={{
        display: 'block', minWidth: 0, width: '100%', overflow: 'hidden',
        '@media (hover: hover)': {
          '&:hover .cap-thumb': { boxShadow: '0 12px 32px rgba(15,23,42,0.14)' },
        },
      }}
    >
      {/* The picture is a draggable 360 view, so it is not a link (a drag must not open the capture).
          The name below and the Open button open it. */}
      <Box
        ref={hostRef}
        className="cap-thumb"
        data-testid="capture-panorama-tile"
        sx={{
          position: 'relative', width: '100%', aspectRatio: '4 / 3', borderRadius: { xs: '10px', sm: '14px' }, overflow: 'hidden',
          background: capture.gradient,
          boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
          transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}`,
        }}
      >
        {source.url ? (
          <PanoramaView source={source} mounted={near} showHint={false} />
        ) : (
          // No image yet: still stitching.
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.75 }}>
            <ViewInArRounded sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 26 }} />
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>Processing 360°…</Typography>
          </Box>
        )}

        {/* Open the capture */}
        <Box
          component={Link}
          to={`/captures/${capture.id}`}
          aria-label={`Open ${displayName}`}
          sx={{
            position: 'absolute', bottom: 8, right: 8, zIndex: 3, display: 'inline-flex', alignItems: 'center', gap: 0.5,
            px: 1, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
            color: '#fff', textDecoration: 'none', fontSize: '0.6875rem', fontWeight: 600,
            '&:hover': { backgroundColor: 'rgba(0,0,0,0.75)' },
          }}
        >
          <ViewInArRounded sx={{ fontSize: 13 }} />
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{hasTour ? 'View image' : 'Open'}</Box>
        </Box>

        {/* tour marker, left of the full screen button */}
        {hasTour && (
          <Box sx={{ position: 'absolute', top: { xs: 4, sm: 8 }, right: { xs: 40, sm: 48 }, zIndex: 3, width: { xs: 18, sm: 22 }, height: { xs: 18, sm: 22 }, borderRadius: { xs: '5px', sm: '7px' }, backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <ViewInArRounded sx={{ fontSize: { xs: 10, sm: 12 }, color: '#fff' }} />
          </Box>
        )}

        {/* delete — always visible when provided (engineers need a clear control;
            hover-only + opacity:0 on sm+ hid it forever on touch tablets/laptops) */}
        {onDelete && (
          <Box
            className="cap-delete"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(capture); }}
            sx={{
              position: 'absolute', top: { xs: 4, sm: 8 }, left: { xs: 4, sm: 8 },
              width: { xs: 28, sm: 28 }, height: { xs: 28, sm: 28 },
              borderRadius: '8px',
              backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', opacity: 1, zIndex: 2,
              transition: `background-color ${motion.durationFast}`,
              '&:hover': { backgroundColor: '#dc2626' },
            }}
          >
            <DeleteOutlineRounded sx={{ fontSize: 15, color: '#fff' }} />
          </Box>
        )}
      </Box>

      {/* Metadata — name + status dot */}
      <Box component={Link} to={`/captures/${capture.id}`} sx={{ display: 'block', textDecoration: 'none', pt: { xs: 0.5, sm: 1.25 }, px: 0, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: { xs: '0.6875rem', sm: '0.875rem' }, fontWeight: 600, color: colors.textStrong, letterSpacing: '-0.01em', minWidth: 0 }}>
          {displayName}
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

// Every card is now a live 360 view, so pages stay small and a phone gets 2 wider columns (a 360 needs room to drag).
const CAPTURES_PAGE_SIZE_MOBILE = 8;   // 2 columns × 4 rows
const CAPTURES_PAGE_SIZE_TABLET = 9;   // 3 columns × 3 rows
const CAPTURES_PAGE_SIZE_DESKTOP = 12; // 4 columns × 3 rows

const GALLERY_GRID_SX = {
  display: 'grid',
  width: '100%',
  minWidth: 0,
  gridTemplateColumns: {
    xs: 'repeat(2, minmax(0, 1fr))',
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
  const sessionUserKey = user?.id || user?.role || 'default';

  const [projectId, setProjectId] = useState<string>(() => sessionStorage.getItem(`captures_projectId_${sessionUserKey}`) || '');
  const [towerId, setTowerId] = useState<string>(() => sessionStorage.getItem(`captures_towerId_${sessionUserKey}`) || '');
  const [floorId, setFloorId] = useState<string>(() => sessionStorage.getItem(`captures_floorId_${sessionUserKey}`) || '');
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
  const [deleteTarget, setDeleteTarget] = useState<MockCapture | null>(null);
  // "Delete all" on a floor header (field engineer's Capture History): what is about to be removed, shown in the
  // confirmation before anything is deleted.
  const [deleteFloorTarget, setDeleteFloorTarget] = useState<
    { label: string; ids: string[]; shown: number; earlier: number; scope: 'project' | 'tower' | 'floor' } | null
  >(null);

  // Pull finished stitch panoramas onto any still-empty capture cards (common
  // after refresh when the server finished stitching while the UI was idle).
  React.useEffect(() => {
    void reconcileStitchedCaptureMedia();
  }, []);

  const tourCaptureIds = useMemo(() => new Set(tours.map(t => t.captureId)), [tours]);
  // Same stale-roomName concern as CaptureCard's displayName — resolve the live pin label here too.
  const deleteTargetLabel = deleteTarget
    ? (() => {
        const pin = allPins.find(p => p.captureIds.includes(deleteTarget.id));
        return formatPinLocationLabel(pin, deleteTarget.roomName);
      })()
    : 'this point';

  // Gallery shows one card per pin (latest only). Deleting that card removes
  // only that visit — older captures stay on the pin timeline for Compare.
  const confirmDeleteCapture = () => {
    if (!deleteTarget) return;
    deleteCapture(deleteTarget.id);
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

  const galleryCaptures = useMemo(() => {
    const scopedCaptures = isEngineerView ? filterOwnCaptures(mockCaptures, user) : mockCaptures;
    const ownIds = isEngineerView ? ownCaptureIdSet(mockCaptures, user) : null;
    const pinsForGallery = ownIds
      ? allPins.map(p => ({ ...p, captureIds: pinCaptureIdsForUser(p.captureIds, ownIds) }))
      : allPins;
    const enriched = scopedCaptures.map(c => enrichCaptureLocation(c, {
      pins: pinsForGallery,
      projects: allProjects,
      towers: allTowers,
      floors: allFloors,
    }));
    return filterGalleryCaptures(enriched, pinsForGallery, assignedProjectIds);
  }, [mockCaptures, allPins, assignedProjectIds, allProjects, allTowers, allFloors, isEngineerView, user]);

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
        const pin = getPinForCapture(allPins, c.id);
        const floor =
          allFloors.find(f => f.id === pin?.floorId)
          ?? allFloors.find(f => f.towerId === c.towerId && f.label === c.floorLabel);
        map.set(key, {
          projectId: c.projectId,
          towerId: c.towerId,
          floorId: floor?.id ?? pin?.floorId ?? '',
          towerName: c.towerName,
          floorLabel: c.floorLabel,
          projectName: c.projectName,
          captures: [],
        });
      }
      map.get(key)!.captures.push(c);
    }
    return [...map.values()].sort((a, b) =>
      a.towerName.localeCompare(b.towerName, undefined, { numeric: true }) ||
      a.floorLabel.localeCompare(b.floorLabel, undefined, { numeric: true })
    );
  };

  const groupedByFloor = useMemo(() => buildFloorGroups(filtered), [filtered, allFloors, allPins]);

  // Paginate by floor-group: small floors are packed together on a page (up to the page size) and not split.
  // A floor with MORE captures than one page holds is split into consecutive pages of its own, each under the same
  // floor header (which then reads "12 of 104 captures"). Before this, such a floor was kept whole on a single page,
  // so a floor with 100+ captures rendered every card at once and had no usable pagination.
  const floorGroupPages = useMemo(
    () => paginateGroups(groupedByFloor, itemsPerPage),
    [groupedByFloor, itemsPerPage],
  );

  const totalPages = Math.max(1, floorGroupPages.length);
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

  // Deleting a whole floor is offered to field engineers on Capture History (their own captures only).
  const canDeleteWholeFloor = isEngineerView && can(user?.role, 'captures', 'delete');

  const requestDeleteFloor = (group: { projectId: string; towerId: string; floorLabel: string; projectName: string; towerName: string }) => {
    const key = `${group.projectId}::${group.towerId}::${group.floorLabel}`;
    // The whole floor, not just the page slice that sits under this header.
    const full = groupedByFloor.find(g => `${g.projectId}::${g.towerId}::${g.floorLabel}` === key);
    if (!full) return;
    const { ids, shown, earlier } = collectFloorCaptureIds(full.captures, allPins, ownCaptureIdSet(mockCaptures, user));
    if (ids.length === 0) return;
    const label = [showProjectName ? group.projectName : '', formatTowerLabel(group.towerName), group.floorLabel]
      .filter(Boolean)
      .join(' · ') || group.floorLabel;
    setDeleteFloorTarget({ label, ids, shown, earlier, scope: 'floor' });
  };

  // "Delete all" in the toolbar follows the CURRENT selection and nothing wider: a project removes that project's
  // captures, a tower only that tower's (inside the selected project), a floor only that floor's (inside the
  // selected tower). `filtered` is already narrowed by exactly those three choices (and, for engineers, to their
  // own captures), so other projects, towers and floors can never be included.
  const requestDeleteSelection = () => {
    if (!projectId || projectId === 'all' || !selectedProject) return;
    const { scope, cards } = capturesInSelection(filtered, {
      projectId, towerId, floorId, floorLabel: floorSelectionLabel(floorId, availableFloors),
    });
    const { ids, shown, earlier } = collectFloorCaptureIds(cards, allPins, ownCaptureIdSet(mockCaptures, user));
    if (ids.length === 0) return;
    const parts = scope === 'floor'
      ? [selectedFloor?.label, selectedTower ? formatTowerLabel(selectedTower.name) : '', selectedProject.name]
      : scope === 'tower'
        ? [selectedTower ? formatTowerLabel(selectedTower.name) : '', selectedProject.name]
        : [selectedProject.name];
    setDeleteFloorTarget({ label: parts.filter(Boolean).join(' · '), ids, shown, earlier, scope });
  };

  const confirmDeleteFloor = () => {
    const target = deleteFloorTarget;
    setDeleteFloorTarget(null); // close first, so a second tap on "Delete" cannot run it twice
    if (!target) return;
    target.ids.forEach(id => deleteCapture(id)); // the same per-capture delete the card button uses
  };

  const pageCapturesCount = paginatedGroupedByFloor.reduce((sum, g) => sum + g.captures.length, 0);
  const pageStart = filtered.length === 0 ? 0 :
    floorGroupPages.slice(0, page - 1).reduce((sum, grp) => sum + grp.reduce((s, g) => s + g.captures.length, 0), 0) + 1;
  const pageEnd = pageStart === 0 ? 0 : pageStart - 1 + pageCapturesCount;

  const showProjectName = !projectId || projectId === 'all';

  const pendingCount = galleryCaptures.filter(c => c.status === 'review').length;

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
    sessionStorage.setItem(`captures_projectId_${sessionUserKey}`, id);
    sessionStorage.setItem(`captures_towerId_${sessionUserKey}`, id === 'all' ? '' : 'all');
    sessionStorage.setItem(`captures_floorId_${sessionUserKey}`, id === 'all' ? '' : 'all');
  };
  const handleTowerSelect = (id: string) => { 
    setTowerId(id); setFloorId('all'); setTowerMenuAnchor(null); 
    sessionStorage.setItem(`captures_towerId_${sessionUserKey}`, id);
    sessionStorage.setItem(`captures_floorId_${sessionUserKey}`, 'all');
  };
  const handleFloorSelect = (id: string) => { 
    setFloorId(id); setFloorMenuAnchor(null); 
    sessionStorage.setItem(`captures_floorId_${sessionUserKey}`, id);
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
          {galleryCaptures.length} captures · {PROJECTS_WITH_CAPTURES.length} projects · {pendingCount} pending review
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

        {/* Delete all: scoped to whatever project / tower / floor is selected above */}
        {canDeleteWholeFloor && selectedProject && filtered.length > 0 && (
          <Box
            component="button"
            type="button"
            onClick={requestDeleteSelection}
            title={floorId && floorId !== 'all' && towerId && towerId !== 'all'
              ? 'Delete all captures on the selected floor'
              : towerId && towerId !== 'all'
                ? 'Delete all captures in the selected tower'
                : 'Delete all captures in the selected project'}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.75, flexShrink: 0,
              px: 1.5, py: 0.875, borderRadius: '10px', border: `1.5px solid ${P.border}`, backgroundColor: P.white,
              color: P.strong, fontFamily: 'inherit', fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
              transition: T, alignSelf: { xs: 'stretch', md: 'center' }, justifyContent: 'center',
              '&:hover': { borderColor: colors.danger, color: colors.danger, backgroundColor: colors.dangerBg },
            }}
          >
            <DeleteSweepRounded sx={{ fontSize: 16 }} />
            Delete all
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
      ) : (
        /* Gallery + History — grouped by floor, with View Floor Plan for pin locations */
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: { xs: 2, sm: 3 }, width: '100%', minWidth: 0 }}>
          <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
            {paginatedGroupedByFloor.map(group => {
              const floorKey = `${group.projectId}::${group.towerId}::${group.floorLabel}`;
              const floorTotal = floorTotalCounts.get(floorKey) ?? group.captures.length;
              const captureLabel = group.captures.length === floorTotal
                ? `${floorTotal} capture${floorTotal !== 1 ? 's' : ''}`
                : `${group.captures.length} of ${floorTotal} captures`;
              const returnTo = isEngineerView ? '/my-captures' : '/captures';

              return (
              <Box key={`${group.projectName}-${group.towerName}-${group.floorLabel}`}>
                {/* Floor section header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.75 }}>
                  <Box sx={{ width: 30, height: 30, borderRadius: '8px', backgroundColor: P.blueSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <LayersRounded sx={{ fontSize: 17, color: P.blue }} />
                  </Box>
                  <Box sx={{ minWidth: 0, mr: { xs: 'auto', sm: 0 } }}>
                    <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, letterSpacing: '-0.02em', lineHeight: 1.2 }} noWrap>
                      {[showProjectName ? group.projectName : '', formatTowerLabel(group.towerName), group.floorLabel]
                        .filter(Boolean)
                        .join(' · ') || group.floorLabel}
                    </Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
                      {captureLabel}
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1, height: 1, backgroundColor: P.border, mx: 1, display: { xs: 'none', sm: 'block' } }} />
                  {group.floorId && (
                    <Box
                      component={Link}
                      to={`/floor-plans/${group.projectId}/${group.towerId}/${group.floorId}?pinsOnly=1&returnTo=${encodeURIComponent(returnTo)}`}
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.625, borderRadius: '8px', border: `1.5px solid ${P.border}`, color: P.muted, fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } }}
                    >
                      <MapRounded sx={{ fontSize: 14 }} /> View on Floor Plan
                    </Box>
                  )}
                  {canDeleteWholeFloor && (
                    <Box
                      component="button"
                      type="button"
                      onClick={() => requestDeleteFloor(group)}
                      aria-label={`Delete all captures on ${group.floorLabel}`}
                      title="Delete all captures on this floor"
                      sx={{
                        display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.625, borderRadius: '8px',
                        border: `1.5px solid ${P.border}`, backgroundColor: 'transparent', color: P.muted, fontFamily: 'inherit',
                        fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer', transition: T,
                        '&:hover': { borderColor: colors.danger, color: colors.danger, backgroundColor: colors.dangerBg },
                      }}
                    >
                      <DeleteSweepRounded sx={{ fontSize: 15 }} />
                      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Delete all</Box>
                    </Box>
                  )}
                </Box>
                <Box sx={GALLERY_GRID_SX}>
                  {group.captures.map(c => (
                    <CaptureCard
                      key={c.id}
                      capture={c}
                      hasTour={tourCaptureIds.has(c.id)}
                      onDelete={can(user?.role, 'captures', 'delete') ? setDeleteTarget : undefined}
                      showProjectName={showProjectName}
                      compact={isMobile}
                    />
                  ))}
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
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this capture?"
        description={`Remove this visit for ${deleteTargetLabel}${deleteTarget ? ` (${formatTowerLabel(deleteTarget.towerName)} · ${deleteTarget.floorLabel})` : ''}? Older captures on the same pin stay in the timeline for Compare. This cannot be undone.`}
        confirmLabel="Delete capture"
        destructive
        onConfirm={confirmDeleteCapture}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteFloorTarget}
        title={deleteFloorTarget?.scope === 'project' ? 'Delete all captures in this project?'
          : deleteFloorTarget?.scope === 'tower' ? 'Delete all captures in this tower?'
            : 'Delete all captures on this floor?'}
        description={deleteFloorTarget
          ? `This will permanently delete ${deleteFloorTarget.ids.length} capture${deleteFloorTarget.ids.length === 1 ? '' : 's'} on ${deleteFloorTarget.label}, and nothing from any other ${deleteFloorTarget.scope === 'project' ? 'project' : deleteFloorTarget.scope === 'tower' ? 'tower or project' : 'floor, tower or project'}`
            + (deleteFloorTarget.earlier > 0
              ? ` (${deleteFloorTarget.shown} shown here plus ${deleteFloorTarget.earlier} earlier visit${deleteFloorTarget.earlier === 1 ? '' : 's'} of the same points)`
              : '')
            + '. Any progress results based on them are removed too. Capture points stay on the floor plan. This cannot be undone.'
          : ''}
        confirmLabel={deleteFloorTarget ? `Delete ${deleteFloorTarget.ids.length} capture${deleteFloorTarget.ids.length === 1 ? '' : 's'}` : 'Delete'}
        destructive
        onConfirm={confirmDeleteFloor}
        onCancel={() => setDeleteFloorTarget(null)}
      />
    </Box>
  );
}
