import React, { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Box, Typography, useMediaQuery, useTheme, Drawer } from '@mui/material';
import {
  LayersRounded, MapRounded, CheckCircleRounded, AddRounded,
  CameraAltRounded, ViewInArRounded, UploadFileRounded, ArrowBackRounded,
  DomainRounded, KeyboardArrowDownRounded,
} from '@mui/icons-material';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isFieldEngineer } from '@store/authStore';
import { getTowersByProject, getFloorsByTower, getFloorPlanByFloor, enrichFloorStats } from '@store/workflowSelectors';
import EmptyState from '@shared/components/EmptyState/EmptyState';
import { motion as m } from 'framer-motion';

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

  const [towerSheetOpen, setTowerSheetOpen] = useState(false);

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
    return pid && activeProjects.find(p => p.id === pid) ? pid : (activeProjects[0]?.id ?? '');
  });
  const project = activeProjects.find(p => p.id === projectId) ?? activeProjects[0];

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
  }

  const dataSlice = { flats, rooms, captures, tours, floorPlans };
  const mappedCount = towerFloors.filter(f => getFloorPlanByFloor(floorPlans, tower?.id ?? '', f.id)).length;

  if (!project) {
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
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>

      {/* ── Back to overview (all roles) ──────────────────────────────── */}
      <Box
        component={Link}
        to={`/dashboard/${user?.role === 'field_engineer' ? 'engineer' : user?.role ?? 'admin'}`}
        sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
            px: 1.25, py: 0.625, borderRadius: '20px',
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
          {isEngineer
            ? 'View uploaded floor plans for your project sites'
            : 'Architectural blueprint view — map rooms, captures, and tours'}
        </Typography>
      </Box>

      {/* ── Project selector (if multiple) ───────────────────────────────── */}
      {activeProjects.length > 1 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{
            fontSize: '0.625rem', fontWeight: 700, color: P.subtle,
            letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1,
          }}>
            Project
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {activeProjects.map(proj => {
              const isActive = project.id === proj.id;
              return (
                <Box
                  key={proj.id}
                  onClick={() => selectProject(proj.id)}
                  sx={{
                    px: 1.5, py: 0.875, borderRadius: '20px', cursor: 'pointer',
                    border: `1.5px solid ${isActive ? P.blue : P.border}`,
                    backgroundColor: isActive ? P.blueSoft : P.white,
                    transition: T,
                    '&:hover': { borderColor: P.blue },
                  }}
                >
                  <Typography sx={{
                    fontSize: '0.8125rem',
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? P.blue : P.strong,
                  }}>
                    {proj.name}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* ── Tower selector ────────────────────────────────────────────────── */}
      {projectTowers.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{
            fontSize: '0.5625rem', fontWeight: 700, color: P.subtle,
            letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1.5,
          }}>
            Select Tower
          </Typography>

          {/* Mobile: compact dropdown trigger → bottom sheet */}
          {isMobile ? (
            <>
              <Box
                onClick={() => setTowerSheetOpen(true)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.25,
                  px: 1.5, py: 1.25, borderRadius: '12px',
                  border: `1.5px solid ${towerSheetOpen ? P.blue : P.border}`,
                  backgroundColor: P.white, cursor: 'pointer', transition: T,
                  '&:hover': { borderColor: P.blue },
                }}
              >
                <Box sx={{
                  width: 32, height: 32, borderRadius: '8px',
                  backgroundColor: P.ink,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <DomainRounded sx={{ fontSize: 16, color: P.white }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong, lineHeight: 1.2 }}>
                    {tower?.name ?? 'Select tower'}
                  </Typography>
                  {tower && (() => {
                    const tFloors = getFloorsByTower(floors, tower.id);
                    const tMapped = tFloors.filter(f => getFloorPlanByFloor(floorPlans, tower.id, f.id)).length;
                    return (
                      <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
                        {tFloors.length} floor{tFloors.length !== 1 ? 's' : ''}{tMapped > 0 ? ` · ${tMapped} plan${tMapped !== 1 ? 's' : ''}` : ''}
                      </Typography>
                    );
                  })()}
                </Box>
                <KeyboardArrowDownRounded sx={{
                  fontSize: 18, color: P.muted, flexShrink: 0,
                  transform: towerSheetOpen ? 'rotate(180deg)' : 'none', transition: T,
                }} />
              </Box>
              <Drawer
                anchor="bottom"
                open={towerSheetOpen}
                onClose={() => setTowerSheetOpen(false)}
                slotProps={{ paper: { sx: { borderRadius: '20px 20px 0 0', px: 0, pt: 0, pb: 'env(safe-area-inset-bottom, 16px)', maxHeight: '75vh' } } }}
              >
                <Box sx={{ width: 36, height: 4, borderRadius: '99px', backgroundColor: '#e4e7ec', mx: 'auto', mt: 1.5, mb: 2 }} />
                <Typography sx={{ px: 2.5, pb: 1.5, fontSize: '0.6875rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Select Tower
                </Typography>
                <Box sx={{ overflowY: 'auto', px: 1.5, pb: 2 }}>
                  {projectTowers.map(t => {
                    const isActive = tower?.id === t.id;
                    const tFloors = getFloorsByTower(floors, t.id);
                    const tMapped = tFloors.filter(f => getFloorPlanByFloor(floorPlans, t.id, f.id)).length;
                    return (
                      <Box
                        key={t.id}
                        onClick={() => { setTowerId(t.id); setTowerSheetOpen(false); }}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 1, borderRadius: '9px', cursor: 'pointer', backgroundColor: isActive ? P.blueSoft : 'transparent', '&:hover': { backgroundColor: isActive ? P.blueSoft : P.bg } }}
                      >
                        <Box sx={{ width: 28, height: 28, borderRadius: '7px', backgroundColor: isActive ? P.ink : P.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <DomainRounded sx={{ fontSize: 15, color: isActive ? P.white : P.blue }} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography sx={{ fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? P.blue : P.strong }}>
                            {t.name}
                          </Typography>
                          <Typography sx={{ fontSize: '0.6875rem', color: P.muted }}>
                            {tFloors.length} floor{tFloors.length !== 1 ? 's' : ''}{tMapped > 0 ? ` · ${tMapped} plan${tMapped !== 1 ? 's' : ''}` : ''}
                          </Typography>
                        </Box>
                        {isActive && <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: P.blue, flexShrink: 0 }} />}
                      </Box>
                    );
                  })}
                </Box>
              </Drawer>
            </>
          ) : (
            /* Desktop: horizontal scrollable cards */
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
              gap: 1.5, pt: 0.5, pb: 1.5,
            }}>
              {projectTowers.map(t => {
                const isActive = tower?.id === t.id;
                const tFloors = getFloorsByTower(floors, t.id);
                const tMapped = tFloors.filter(f => getFloorPlanByFloor(floorPlans, t.id, f.id)).length;
                return (
                  <Box
                    key={t.id}
                    onClick={() => setTowerId(t.id)}
                    sx={{
                      minWidth: 110, flexShrink: 0, borderRadius: '14px',
                      position: 'relative',
                      border: `1.5px solid ${isActive ? 'transparent' : P.border}`,
                      backgroundColor: P.white,
                      cursor: 'pointer', 
                      transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s, box-shadow 0.2s',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      px: 1.5, py: 1.75, gap: 0.5,
                      transform: 'translateY(0) scale(1)',
                      '&:hover': isActive ? {} : { borderColor: P.blue, transform: 'translateY(-2px)', boxShadow: '0 4px 16px rgba(37,99,235,0.10)' },
                      '&:active': { transform: 'scale(0.96)' },
                    }}
                  >
                    {isActive && (
                      <Box
                        component={m.div}
                        layoutId="activeTowerFloorPlan"
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                        sx={{ position: 'absolute', inset: 0, backgroundColor: P.ink, borderRadius: '14px', zIndex: 0 }}
                      />
                    )}
                    <Box sx={{ position: 'relative', zIndex: 1, width: 44, height: 44, borderRadius: '10px', backgroundColor: isActive ? 'rgba(255,255,255,0.12)' : P.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 0.25, transition: 'background-color 0.3s' }}>
                      <DomainRounded sx={{ fontSize: 22, color: isActive ? P.white : P.blue, transition: 'color 0.3s' }} />
                    </Box>
                    <Typography sx={{ position: 'relative', zIndex: 1, fontSize: '0.8125rem', fontWeight: 700, lineHeight: 1.2, color: isActive ? P.white : P.strong, textAlign: 'center', transition: 'color 0.3s' }}>
                      {t.name}
                    </Typography>
                    <Typography sx={{ position: 'relative', zIndex: 1, fontSize: '0.6875rem', color: isActive ? 'rgba(255,255,255,0.55)' : P.subtle, textAlign: 'center', transition: 'color 0.3s' }}>
                      {tFloors.length} floor{tFloors.length !== 1 ? 's' : ''}{tMapped > 0 ? ` · ${tMapped} plan${tMapped !== 1 ? 's' : ''}` : ''}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      )}

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      {tower && (
        <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography sx={{ fontSize: '0.8125rem', color: P.muted, flexShrink: 0 }}>
            <Box component="span" sx={{ fontWeight: 700, color: P.strong }}>{towerFloors.length}</Box>
            {' floors · '}
            <Box component="span" sx={{ fontWeight: 700, color: mappedCount > 0 ? P.blue : P.muted }}>{mappedCount}</Box>
            {' uploaded'}
          </Typography>
          {towerFloors.length > 0 && (
            <Box sx={{ flex: 1, height: 4, borderRadius: '99px', backgroundColor: P.border, overflow: 'hidden' }}>
              <Box sx={{
                height: '100%',
                width: `${Math.round((mappedCount / towerFloors.length) * 100)}%`,
                borderRadius: '99px',
                backgroundColor: mappedCount === towerFloors.length && towerFloors.length > 0 ? P.success : P.blue,
                transition: T,
              }} />
            </Box>
          )}
        </Box>
      )}

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
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(4,1fr)' },
          gap: 1.25,
        }}>
          {visibleFloors.map(floor => {
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
                borderRadius: '14px',
                overflow: 'hidden',
                border: `1.5px solid ${hasPlan ? P.blueRing : P.border}`,
                backgroundColor: P.white,
                transition: T,
                ...(href ? {
                  cursor: 'pointer',
                  '&:hover': {
                    borderColor: P.blue,
                    transform: 'translateY(-2px)',
                    boxShadow: `0 6px 20px rgba(37,99,235,0.10)`,
                  },
                } : { opacity: 0.5 }),
              }}>
                {/* Thumbnail */}
                <Box sx={{
                  height: 120, position: 'relative', overflow: 'hidden',
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
                    px: 1.5, py: 0.875,
                    background: 'linear-gradient(0deg,rgba(0,0,0,0.62) 0%,transparent 100%)',
                    display: 'flex', alignItems: 'center', gap: 0.75,
                  }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.white }}>
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
              </Box>
            );

            return href ? (
              <Box key={floor.id} component={Link} to={href} sx={{ textDecoration: 'none' }}>
                {card}
              </Box>
            ) : (
              <Box key={floor.id}>{card}</Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
