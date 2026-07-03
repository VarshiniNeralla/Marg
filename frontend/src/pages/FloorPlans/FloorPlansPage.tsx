import React, { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Box, Typography, useMediaQuery, useTheme, Menu, MenuItem, Pagination } from '@mui/material';
import {
  LayersRounded, MapRounded, CheckCircleRounded, AddRounded,
  CameraAltRounded, ViewInArRounded, UploadFileRounded, ArrowBackRounded,
  BusinessRounded, KeyboardArrowDownRounded, CheckRounded,
} from '@mui/icons-material';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isFieldEngineer , getRoleLandingPath } from '@store/authStore';
import { getTowersByProject, getFloorsByTower, getFloorPlanByFloor, enrichFloorStats } from '@store/workflowSelectors';
import EmptyState from '@shared/components/EmptyState/EmptyState';
import { locationFilterMenuPaperSx, locationFilterToolbarSx } from '@/utils/locationFilters';

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

  const [towerMenuAnchor, setTowerMenuAnchor] = useState<null | HTMLElement>(null);
  const [projectMenuAnchor, setProjectMenuAnchor] = useState<null | HTMLElement>(null);
  const [page, setPage] = useState(1);

  const projects   = useWorkflowStore(s => s.projects);
  const towers     = useWorkflowStore(s => s.towers);
  const floors     = useWorkflowStore(s => s.floors);
  const flats      = useWorkflowStore(s => s.flats);
  const rooms      = useWorkflowStore(s => s.rooms);
  const captures   = useWorkflowStore(s => s.captures);
  const tours      = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const [searchParams] = useSearchParams();

  const activeProjects = useMemo(
    () => projects.filter(p => !p.archived && getTowersByProject(towers, p.id).length > 0),
    [projects, towers],
  );

  const [projectId, setProjectId] = useState(() => {
    const pid = searchParams.get('project');
    if (pid && activeProjects.find(p => p.id === pid)) return pid;
    // Auto-select only when there's a single project (the picker is hidden then).
    // With multiple projects, require an explicit pick before showing floor plans.
    return activeProjects.length === 1 ? activeProjects[0].id : '';
  });
  const project = activeProjects.find(p => p.id === projectId);

  const projectTowers = useMemo(
    () => project
      ? [...getTowersByProject(towers, project.id)].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      : [],
    [towers, project],
  );

  const [towerId, setTowerId] = useState(() => {
    const tid = searchParams.get('tower');
    return tid || (projectTowers[0]?.id ?? '');
  });
  const tower = projectTowers.find(t => t.id === towerId) ?? projectTowers[0];

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

  const dataSlice = { flats, rooms, captures, tours, floorPlans };
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

  if (activeProjects.length === 0) {
    return (
      <EmptyState
        icon={<MapRounded />}
        title="No projects with floor plans"
        description="Create a project and add towers to start mapping floor plans."
        action={!isEngineer ? { label: 'Create project', onClick: () => window.location.href = '/projects/new' } : undefined}
      />
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6, width: '100%', minWidth: 0, overflow: 'hidden' }}>

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
      </Box>

      {/* ── Toolbar: project + tower pills ─────────────────────────────── */}
      <Box sx={{ ...toolbarLayout.row, mb: 3 }}>
        <Box sx={toolbarLayout.group}>
          <Box
            onClick={e => setProjectMenuAnchor(e.currentTarget)}
            sx={{
              ...toolbarLayout.pill,
              display: 'flex', alignItems: 'center', gap: 1,
              px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
              border: `1.5px solid ${projectMenuAnchor ? P.blue : P.border}`,
              backgroundColor: projectMenuAnchor ? P.blueSoft : P.white,
              transition: T, '&:hover': { borderColor: P.blue },
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden', minWidth: 0 }}>
              <Box sx={{ width: 18, height: 18, borderRadius: '5px', background: project?.gradient ?? `linear-gradient(135deg,${P.subtle},${P.muted})`, flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {project ? project.name : 'Select a project'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
              <Box sx={{ px: 0.75, py: 0.25, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted }}>
                {project ? projectTowers.length : activeProjects.length}
              </Box>
              <KeyboardArrowDownRounded sx={{ fontSize: 16, color: P.muted, transform: projectMenuAnchor ? 'rotate(180deg)' : 'none', transition: T }} />
            </Box>
          </Box>

          {project && projectTowers.length > 0 && (
            <Box
              onClick={e => setTowerMenuAnchor(e.currentTarget)}
              sx={{
                ...toolbarLayout.pill,
                display: 'flex', alignItems: 'center', gap: 1,
                px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
                border: `1.5px solid ${towerMenuAnchor ? P.blue : P.border}`,
                backgroundColor: towerMenuAnchor ? P.blueSoft : P.white,
                transition: T, '&:hover': { borderColor: P.blue },
                justifyContent: 'space-between',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden', minWidth: 0 }}>
                <BusinessRounded sx={{ fontSize: 18, color: P.subtle, flexShrink: 0 }} />
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {tower?.name ?? 'Select a tower'}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
                <Box sx={{ px: 0.75, py: 0.25, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted }}>
                  {visibleFloors.length}
                </Box>
                <KeyboardArrowDownRounded sx={{ fontSize: 16, color: P.muted, transform: towerMenuAnchor ? 'rotate(180deg)' : 'none', transition: T }} />
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      <Menu
        anchorEl={projectMenuAnchor}
        open={!!projectMenuAnchor}
        onClose={() => setProjectMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: locationFilterMenuPaperSx(280, P.border) } }}
      >
        {activeProjects.map(proj => {
          const isActive = projectId === proj.id;
          const pTowers = getTowersByProject(towers, proj.id).length;
          return (
            <MenuItem
              key={proj.id}
              onClick={() => { selectProject(proj.id); setProjectMenuAnchor(null); }}
              sx={{ borderRadius: '10px', py: 0.875, px: 1, gap: 1.25, '&:hover': { backgroundColor: P.bg }, backgroundColor: isActive ? P.blueSoft : 'transparent' }}
            >
              <Box sx={{ width: 22, height: 22, borderRadius: '7px', background: proj.gradient, flexShrink: 0 }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? P.blue : P.strong }}>
                {proj.name}
              </Typography>
              <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted }}>
                {pTowers}
              </Box>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: P.blue }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {project && (
        <Menu
          anchorEl={towerMenuAnchor}
          open={!!towerMenuAnchor}
          onClose={() => setTowerMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{ paper: { sx: locationFilterMenuPaperSx(260, P.border) } }}
        >
          {projectTowers.map(t => {
            const isActive = towerId === t.id;
            const tFloors = getFloorsByTower(floors, t.id);
            const tMapped = tFloors.filter(f => getFloorPlanByFloor(floorPlans, t.id, f.id)).length;
            const floorCount = isEngineer ? tMapped : tFloors.length;
            return (
              <MenuItem
                key={t.id}
                onClick={() => { setTowerId(t.id); setTowerMenuAnchor(null); setPage(1); }}
                sx={{ borderRadius: '10px', py: 0.875, px: 1, gap: 1.25, '&:hover': { backgroundColor: P.bg }, backgroundColor: isActive ? P.blueSoft : 'transparent' }}
              >
                <BusinessRounded sx={{ fontSize: 18, color: isActive ? P.blue : P.muted }} />
                <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? P.blue : P.strong }}>
                  {t.name}
                </Typography>
                <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted }}>
                  {floorCount}
                </Box>
                {isActive && <CheckRounded sx={{ fontSize: 17, color: P.blue }} />}
              </MenuItem>
            );
          })}
        </Menu>
      )}

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

            return href ? (
              <Box key={floor.id} component={Link} to={href} sx={{ textDecoration: 'none', minWidth: 0, width: '100%' }}>
                {card}
              </Box>
            ) : (
              <Box key={floor.id} sx={{ minWidth: 0, width: '100%' }}>{card}</Box>
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
    </Box>
  );
}
