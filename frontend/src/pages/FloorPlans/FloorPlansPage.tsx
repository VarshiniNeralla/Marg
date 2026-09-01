import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Box, Typography, useMediaQuery, useTheme, MenuItem, Pagination, Tooltip, Select, FormControl, type SelectChangeEvent } from '@mui/material';
import {
  LayersRounded, MapRounded, CheckCircleRounded, AddRounded,
  CameraAltRounded, ViewInArRounded, UploadFileRounded, ArrowBackRounded,
  BusinessRounded, DeleteOutlineRounded,
} from '@mui/icons-material';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isFieldEngineer, isManagerOrAdmin, getRoleLandingPath } from '@store/authStore';
import { getTowersByProject, getFloorsByTower, getFloorPlanByFloor, enrichFloorStats } from '@store/workflowSelectors';
import EmptyState from '@shared/components/EmptyState/EmptyState';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { locationFilterToolbarSx } from '@/utils/locationFilters';

const PLANS_PAGE_SIZE_MOBILE = 9;  // 3 × 3
const PLANS_PAGE_SIZE_DESKTOP = 8; // 4 × 2

const FLOOR_PLANS_GRID_SX = {
  display: 'grid',
  width: '100%',
  minWidth: 0,
  gridTemplateColumns: {
    xs: 'repeat(3, minmax(0, 1fr))',
    sm: 'repeat(4, minmax(0, 1fr))',
  },
  gap: { xs: 0.75, sm: 1.5 },
} as const;

/* ── palette ────────────────────────────────────────────────────────────── */
const P = {
  border:    '#e4e7ec',
  muted:     '#6b7280',
  subtle:    '#9ca3af',
  strong:    '#111827',
  blue:      '#2563eb',
  blueHover: '#1d4ed8',
  blueSoft:  'rgba(37,99,235,0.08)',
  blueRing:  'rgba(37,99,235,0.18)',
  white:     '#ffffff',
  bg:        '#f7f8fa',
  ink:       '#111318',
  success:   '#16a34a',
};
const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

export default function FloorPlansPage() {
  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const user       = useAuthStore(s => s.user);
  const isEngineer = isFieldEngineer(user);
  const canManagePlans = isManagerOrAdmin(user);
  const sessionUserKey = user?.id || user?.role || 'default';

  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<{ planId: string; floorLabel: string } | null>(null);

  const projects   = useWorkflowStore(s => s.projects);
  const towers     = useWorkflowStore(s => s.towers);
  const floors     = useWorkflowStore(s => s.floors);
  const flats      = useWorkflowStore(s => s.flats);
  const rooms      = useWorkflowStore(s => s.rooms);
  const captures   = useWorkflowStore(s => s.captures);
  const tours      = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const capturePins = useWorkflowStore(s => s.capturePins);
  const deleteFloorPlan = useWorkflowStore(s => s.deleteFloorPlan);
  const [searchParams] = useSearchParams();

  // Field engineers only see assigned projects (same as Capture Workflow / History).
  const assignedProjectIds = useMemo(() => {
    if (!isEngineer) return null;
    const ids = user?.assignedProjectIds ?? [];
    return ids.length > 0 ? new Set(ids) : null;
  }, [isEngineer, user?.assignedProjectIds]);

  const activeProjects = useMemo(() => {
    const base = projects.filter(p => !p.archived && getTowersByProject(towers, p.id).length > 0);
    return assignedProjectIds ? base.filter(p => assignedProjectIds.has(p.id)) : base;
  }, [projects, towers, assignedProjectIds]);

  const storageKey = (kind: 'project' | 'tower') => `floorplans_${kind}Id_${sessionUserKey}`;

  const [projectId, setProjectId] = useState(() => {
    const fromUrl = searchParams.get('project');
    if (fromUrl) return fromUrl;
    try { return sessionStorage.getItem(storageKey('project')) || ''; } catch { return ''; }
  });
  const [towerId, setTowerId] = useState(() => {
    const fromUrl = searchParams.get('tower');
    if (fromUrl) return fromUrl;
    try { return sessionStorage.getItem(storageKey('tower')) || ''; } catch { return ''; }
  });

  const project = activeProjects.find(p => p.id === projectId) ?? null;

  const projectTowers = useMemo(
    () => project
      ? [...getTowersByProject(towers, project.id)].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      : [],
    [towers, project],
  );

  // One-shot repair after store hydrate — do NOT depend on searchParams (URL writes
  // were remounting anchors and leaving the old Menu stuck open).
  const didRepairSelection = useRef(false);
  useEffect(() => {
    if (didRepairSelection.current) return;
    if (projects.length === 0) return; // wait for real data
    didRepairSelection.current = true;

    let nextProject = projectId;
    if (!nextProject || !activeProjects.some(p => p.id === nextProject)) {
      nextProject = activeProjects[0]?.id ?? '';
    }
    if (nextProject !== projectId) setProjectId(nextProject);

    const towersForProject = nextProject
      ? [...getTowersByProject(towers, nextProject)].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      : [];
    let nextTower = towerId;
    if (!nextTower || !towersForProject.some(t => t.id === nextTower)) {
      nextTower = towersForProject[0]?.id ?? '';
    }
    if (nextTower !== towerId) setTowerId(nextTower);
  }, [projects.length, activeProjects, towers, projectId, towerId]);

  // Persist selection locally only — avoid setSearchParams while menus are open.
  useEffect(() => {
    try {
      if (projectId) sessionStorage.setItem(storageKey('project'), projectId);
      else sessionStorage.removeItem(storageKey('project'));
      if (towerId) sessionStorage.setItem(storageKey('tower'), towerId);
      else sessionStorage.removeItem(storageKey('tower'));
    } catch { /* ignore */ }
  }, [projectId, towerId, sessionUserKey]);

  const tower = projectTowers.find(t => t.id === towerId) ?? null;

  const towerFloors = useMemo(
    () => tower ? [...getFloorsByTower(floors, tower.id)].sort((a, b) => a.number - b.number) : [],
    [floors, tower],
  );

  const visibleFloors = useMemo(
    () => isEngineer
      ? towerFloors.filter(f => !!getFloorPlanByFloor(floorPlans, tower?.id ?? '', f.id))
      : towerFloors,
    [towerFloors, floorPlans, tower, isEngineer],
  );

  function selectProject(id: string) {
    setProjectId(id);
    const sorted = [...getTowersByProject(towers, id)].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setTowerId(sorted[0]?.id ?? '');
    setPage(1);
  }

  function selectTower(id: string) {
    setTowerId(id);
    setPage(1);
  }

  const dataSlice = { flats, rooms, captures, tours, floorPlans, capturePins };
  const mappedCount = towerFloors.filter(f => getFloorPlanByFloor(floorPlans, tower?.id ?? '', f.id)).length;
  const plansPerPage = isMobile ? PLANS_PAGE_SIZE_MOBILE : PLANS_PAGE_SIZE_DESKTOP;
  const totalPages = Math.max(1, Math.ceil(visibleFloors.length / plansPerPage));
  const paginatedFloors = useMemo(
    () => visibleFloors.slice((page - 1) * plansPerPage, page * plansPerPage),
    [visibleFloors, page, plansPerPage],
  );

  useEffect(() => {
    setPage(1);
  }, [towerId]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const filterCount = project ? 2 : 1;
  const toolbarLayout = locationFilterToolbarSx(filterCount);

  const selectSx = {
    borderRadius: '10px',
    backgroundColor: P.white,
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: P.strong,
    '& .MuiOutlinedInput-notchedOutline': { borderColor: P.border, borderWidth: '1.5px' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: P.blue },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: P.blue, borderWidth: '1.5px' },
    '& .MuiSelect-select': {
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      py: 1.125,
      px: 1.5,
    },
  } as const;

  if (activeProjects.length === 0) {
    return (
      <EmptyState
        icon={<MapRounded />}
        title="No projects with floor plans"
        description={
          isEngineer
            ? 'No assigned projects have towers yet. Ask your admin to assign you to a project.'
            : 'Create a project and add towers to start mapping floor plans.'
        }
        action={!isEngineer ? { label: 'Create project', onClick: () => window.location.href = '/projects/new' } : undefined}
      />
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6, width: '100%', minWidth: 0 }}>

      {/* ── Back to overview (all roles) ──────────────────────────────── */}
      <Box
        component={Link}
        to={getRoleLandingPath(user?.role)}
        sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
            px: 1.25, py: 0.625, borderRadius: '8px',
            border: `1.5px solid ${P.border}`, color: P.muted,
            fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
            transition: T,
            '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
          }}
        >
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
        </Box>

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.ink, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>
          Floor Plans
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
          {project && tower
            ? `${towerFloors.length} floor${towerFloors.length !== 1 ? 's' : ''} · ${mappedCount} uploaded`
            : isEngineer
              ? 'View uploaded floor plans for your project sites'
              : 'Architectural blueprint view — map rooms, captures, and tours'}
        </Typography>
        {canManagePlans && project && tower && (
          <Typography sx={{ fontSize: '0.8125rem', color: P.subtle, mt: 0.75 }}>
            Use the trash / upload icons on a card to replace a plan. Open a floor to Import annotations from another floor.
          </Typography>
        )}
      </Box>

      {/* ── Toolbar: project + tower selects (native MUI Select — stable open/close) ── */}
      <Box sx={{ ...toolbarLayout.row, mb: 3 }}>
        <Box sx={toolbarLayout.group}>
          <FormControl fullWidth size="small" sx={toolbarLayout.pill}>
            <Select
              displayEmpty
              value={projectId && activeProjects.some(p => p.id === projectId) ? projectId : ''}
              onChange={(e: SelectChangeEvent<string>) => {
                const id = e.target.value;
                if (id) selectProject(id);
              }}
              sx={selectSx}
              renderValue={(selected) => {
                const p = activeProjects.find(x => x.id === selected);
                return (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, width: '100%' }}>
                    <Box sx={{ width: 18, height: 18, borderRadius: '5px', background: p?.gradient ?? `linear-gradient(135deg,${P.subtle},${P.muted})`, flexShrink: 0 }} />
                    <Typography noWrap sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 600, color: P.strong }}>
                      {p?.name ?? 'Select a project'}
                    </Typography>
                    <Box sx={{ px: 0.75, py: 0.25, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted, flexShrink: 0 }}>
                      {p ? getTowersByProject(towers, p.id).length : activeProjects.length}
                    </Box>
                  </Box>
                );
              }}
              MenuProps={{
                disableScrollLock: true,
                slotProps: {
                  paper: {
                    sx: {
                      mt: 1,
                      borderRadius: '14px',
                      border: `1px solid ${P.border}`,
                      boxShadow: '0 12px 40px rgba(15,23,42,0.14)',
                      maxHeight: 360,
                    },
                  },
                },
              }}
            >
              {activeProjects.map(proj => (
                <MenuItem key={proj.id} value={proj.id} sx={{ gap: 1.25, py: 1, borderRadius: '10px', mx: 0.5 }}>
                  <Box sx={{ width: 22, height: 22, borderRadius: '7px', background: proj.gradient, flexShrink: 0 }} />
                  <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: projectId === proj.id ? 700 : 500, color: projectId === proj.id ? P.blue : P.strong }}>
                    {proj.name}
                  </Typography>
                  <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted }}>
                    {getTowersByProject(towers, proj.id).length}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {project && projectTowers.length > 0 && (
            <FormControl fullWidth size="small" sx={toolbarLayout.pill}>
              <Select
                displayEmpty
                value={towerId && projectTowers.some(t => t.id === towerId) ? towerId : ''}
                onChange={(e: SelectChangeEvent<string>) => {
                  const id = e.target.value;
                  if (id) selectTower(id);
                }}
                sx={selectSx}
                renderValue={(selected) => {
                  const t = projectTowers.find(x => x.id === selected);
                  const floorCount = t
                    ? (isEngineer
                      ? getFloorsByTower(floors, t.id).filter(f => !!getFloorPlanByFloor(floorPlans, t.id, f.id)).length
                      : getFloorsByTower(floors, t.id).length)
                    : 0;
                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, width: '100%' }}>
                      <BusinessRounded sx={{ fontSize: 18, color: P.subtle, flexShrink: 0 }} />
                      <Typography noWrap sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 600, color: P.strong }}>
                        {t?.name ?? 'Select a tower'}
                      </Typography>
                      <Box sx={{ px: 0.75, py: 0.25, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted, flexShrink: 0 }}>
                        {floorCount}
                      </Box>
                    </Box>
                  );
                }}
                MenuProps={{
                  disableScrollLock: true,
                  slotProps: {
                    paper: {
                      sx: {
                        mt: 1,
                        borderRadius: '14px',
                        border: `1px solid ${P.border}`,
                        boxShadow: '0 12px 40px rgba(15,23,42,0.14)',
                        maxHeight: 360,
                      },
                    },
                  },
                }}
              >
                {projectTowers.map(t => {
                  const tFloors = getFloorsByTower(floors, t.id);
                  const floorCount = isEngineer
                    ? tFloors.filter(f => !!getFloorPlanByFloor(floorPlans, t.id, f.id)).length
                    : tFloors.length;
                  return (
                    <MenuItem key={t.id} value={t.id} sx={{ gap: 1.25, py: 1, borderRadius: '10px', mx: 0.5 }}>
                      <BusinessRounded sx={{ fontSize: 18, color: towerId === t.id ? P.blue : P.muted }} />
                      <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: towerId === t.id ? 700 : 500, color: towerId === t.id ? P.blue : P.strong }}>
                        {t.name}
                      </Typography>
                      <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted }}>
                        {floorCount}
                      </Box>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          )}
        </Box>
      </Box>

      {/* ── Prompt to pick a project ───────────────────────────────────── */}
      {!project && (
        <Box sx={{
          py: 8, textAlign: 'center',
          border: `1.5px dashed ${P.border}`,
          borderRadius: '18px', backgroundColor: P.white,
        }}>
          <MapRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>
            Select a project to begin
          </Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>
            Choose a project and tower above to view floor plans.
          </Typography>
        </Box>
      )}

      {/* Everything below depends on a chosen project */}
      {project && tower && (
      <>
      {/* ── Floor cards grid ─────────────────────────────────────────────── */}
      {visibleFloors.length === 0 ? (
        <Box sx={{
          py: 8, textAlign: 'center',
          border: `1.5px dashed ${P.border}`,
          borderRadius: '18px', backgroundColor: P.white,
        }}>
          <LayersRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>
            {isEngineer ? 'No floor plans uploaded yet' : 'No floors found'}
          </Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>
            {isEngineer
              ? 'The admin will upload floor plans for this tower.'
              : 'Add floors to this tower to get started.'}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: { xs: 2, sm: 3 }, width: '100%', minWidth: 0 }}>
        <Box sx={FLOOR_PLANS_GRID_SX}>
          {paginatedFloors.map(floor => {
            const stats      = enrichFloorStats(floor, dataSlice);
            const hasPlan    = !!stats.plan;
            const pct        = stats.roomCount > 0 ? Math.round((stats.mapped / stats.roomCount) * 100) : 0;
            const isComplete = hasPlan && stats.mapped === stats.roomCount && stats.roomCount > 0;

            const planRecord = stats.plan as (typeof stats.plan & Record<string, unknown>) | undefined;
            const imageUrl: string | null = planRecord
              ? ((planRecord as any).fileUrl ?? (planRecord as any).file_url
                ?? ((planRecord as any).mediaAssets as any)?.[0]?.original_url ?? null)
              : null;

            const href = hasPlan
              ? `/floor-plans/${project.id}/${tower?.id}/${floor.id}`
              : isEngineer
                ? null
                : `/floor-plans/${project.id}/${tower?.id}/${floor.id}/upload`;

            const card = (
              <Box sx={{
                borderRadius: { xs: '10px', sm: '14px' },
                overflow: 'hidden',
                minWidth: 0,
                width: '100%',
                border: `1.5px solid ${hasPlan ? P.blueRing : P.border}`,
                backgroundColor: P.white,
                transition: T,
                ...(href ? {
                  cursor: 'pointer',
                  '@media (hover: hover)': {
                    '&:hover': {
                      borderColor: P.blue,
                      transform: 'translateY(-2px)',
                      boxShadow: `0 6px 20px rgba(37,99,235,0.10)`,
                    },
                  },
                } : { opacity: 0.5 }),
              }}>
                {/* Thumbnail */}
                <Box sx={{
                  aspectRatio: '4 / 3', position: 'relative', overflow: 'hidden',
                  backgroundColor: hasPlan ? P.blueSoft : P.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {imageUrl ? (
                    <Box
                      component="img"
                      src={imageUrl}
                      alt={floor.label}
                      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <LayersRounded sx={{ fontSize: 32, color: hasPlan ? P.blue : P.subtle, opacity: 0.5 }} />
                  )}

                  {/* Gradient label overlay */}
                  <Box sx={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    px: { xs: 1, sm: 1.5 }, py: { xs: 0.625, sm: 0.875 },
                    background: 'linear-gradient(0deg,rgba(0,0,0,0.62) 0%,transparent 100%)',
                    display: 'flex', alignItems: 'center', gap: 0.75,
                  }}>
                    <Typography sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' }, fontWeight: 700, color: P.white }}>
                      {floor.label}
                    </Typography>
                    {isComplete && <CheckCircleRounded sx={{ fontSize: 13, color: '#22c55e' }} />}
                    {!hasPlan && !isEngineer && (
                      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.375, color: 'rgba(255,255,255,0.80)' }}>
                        <UploadFileRounded sx={{ fontSize: 12 }} />
                        <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Upload
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>

                {/* Stats footer */}
                {!isMobile && (
                <Box sx={{ px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  {hasPlan ? (
                    <>
                      {stats.capturesOnFloor.length > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: P.muted }}>
                          <CameraAltRounded sx={{ fontSize: 11 }} />
                          <Typography sx={{ fontSize: '0.6875rem', color: 'inherit' }}>
                            {stats.capturesOnFloor.length}
                          </Typography>
                        </Box>
                      )}
                      {stats.tourCount > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: P.muted }}>
                          <ViewInArRounded sx={{ fontSize: 11 }} />
                          <Typography sx={{ fontSize: '0.6875rem', color: 'inherit' }}>
                            {stats.tourCount}
                          </Typography>
                        </Box>
                      )}
                      {stats.roomCount > 0 && (
                        <Box sx={{ ml: 'auto', height: 3, flex: 1, borderRadius: '99px', backgroundColor: P.border, minWidth: 30 }}>
                          <Box sx={{
                            height: '100%',
                            width: `${pct}%`,
                            borderRadius: '99px',
                            backgroundColor: isComplete ? P.success : P.blue,
                            transition: T,
                          }} />
                        </Box>
                      )}
                    </>
                  ) : (
                    !isEngineer && (
                      <Typography sx={{
                        fontSize: '0.75rem', color: P.blue, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 0.375,
                      }}>
                        <AddRounded sx={{ fontSize: 12 }} /> Upload plan
                      </Typography>
                    )
                  )}
                </Box>
                )}
              </Box>
            );

            const uploadHref = project && tower
              ? `/floor-plans/${project.id}/${tower.id}/${floor.id}/upload`
              : null;

            // Keep delete/upload-new OUTSIDE the card Link — otherwise clicks navigate
            // to the viewer and the delete control never opens the confirm dialog.
            return (
              <Box key={floor.id} sx={{ position: 'relative', minWidth: 0, width: '100%' }}>
                {href ? (
                  <Box component={Link} to={href} sx={{ textDecoration: 'none', display: 'block', minWidth: 0, width: '100%' }}>
                    {card}
                  </Box>
                ) : (
                  <Box sx={{ minWidth: 0, width: '100%' }}>{card}</Box>
                )}

                {canManagePlans && hasPlan && stats.plan && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      zIndex: 6,
                      display: 'flex',
                      flexDirection: 'row',
                      gap: 0.5,
                    }}
                  >
                    <Tooltip title="Delete plan">
                      <Box
                        component="button"
                        type="button"
                        aria-label={`Delete floor plan for ${floor.label}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeleteTarget({ planId: stats.plan!.id, floorLabel: floor.label });
                        }}
                        sx={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 26, height: 26, p: 0,
                          borderRadius: '7px', cursor: 'pointer',
                          border: `1px solid ${P.border}`,
                          backgroundColor: 'rgba(255,255,255,0.96)',
                          color: '#b91c1c',
                          boxShadow: '0 1px 4px rgba(15,23,42,0.10)',
                          '&:hover': { backgroundColor: '#fff', borderColor: '#ef4444', color: '#ef4444' },
                        }}
                      >
                        <DeleteOutlineRounded sx={{ fontSize: 14 }} />
                      </Box>
                    </Tooltip>
                    {uploadHref && (
                      <Tooltip title="Upload new plan">
                        <Box
                          component={Link}
                          to={uploadHref}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Upload new floor plan for ${floor.label}`}
                          sx={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 26, height: 26, p: 0,
                            borderRadius: '7px', textDecoration: 'none',
                            border: `1px solid ${P.border}`,
                            backgroundColor: 'rgba(255,255,255,0.96)',
                            color: P.blue,
                            boxShadow: '0 1px 4px rgba(15,23,42,0.10)',
                            '&:hover': { backgroundColor: '#fff', borderColor: P.blue },
                          }}
                        >
                          <UploadFileRounded sx={{ fontSize: 14 }} />
                        </Box>
                      </Tooltip>
                    )}
                  </Box>
                )}
              </Box>
            );
          })}
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
      </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete floor plan?"
        description={
          deleteTarget
            ? `Remove the floor plan for ${deleteTarget.floorLabel}? Capture points on this plan will also be removed. You can upload a new plan afterward.`
            : ''
        }
        confirmLabel="Delete plan"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            deleteFloorPlan(deleteTarget.planId);
            setDeleteTarget(null);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
