import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid, Chip } from '@mui/material';
import {
  LayersRounded, MeetingRoomRounded, ViewInArRounded, ArrowForwardRounded,
  UploadFileRounded, MapRounded, CheckCircleRounded, AddRounded, CameraAltRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import PageHeader from '@shared/components/PageHeader/PageHeader';
import EmptyState from '@shared/components/EmptyState/EmptyState';
import { useWorkflowStore } from '@store/workflowStore';
import { getTowersByProject, getFloorsByTower, getFloorPlanByFloor, enrichFloorStats } from '@store/workflowSelectors';

export default function FloorPlansPage() {
  const projects = useWorkflowStore(s => s.projects);
  const towers = useWorkflowStore(s => s.towers);
  const floors = useWorkflowStore(s => s.floors);
  const rooms = useWorkflowStore(s => s.rooms);
  const captures = useWorkflowStore(s => s.captures);
  const tours = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);

  const activeProjects = useMemo(
    () => projects.filter(p => !p.archived && getTowersByProject(towers, p.id).length > 0),
    [projects, towers],
  );

  const [projectId, setProjectId] = useState(activeProjects[0]?.id ?? '');
  const project = activeProjects.find(p => p.id === projectId) ?? activeProjects[0];
  const projectTowers = useMemo(() => project ? getTowersByProject(towers, project.id) : [], [towers, project]);
  const [towerId, setTowerId] = useState(projectTowers[0]?.id ?? '');
  const tower = projectTowers.find(t => t.id === towerId) ?? projectTowers[0];

  const towerFloors = useMemo(() => tower ? getFloorsByTower(floors, tower.id) : [], [floors, tower]);

  function selectProject(id: string) {
    setProjectId(id);
    const tw = getTowersByProject(towers, id)[0];
    setTowerId(tw?.id ?? '');
  }

  const dataSlice = { rooms, captures, tours, floorPlans };
  const nextUploadFloor = towerFloors.find(f => !getFloorPlanByFloor(floorPlans, tower?.id ?? '', f.id));
  const headerUploadHref = nextUploadFloor
    ? `/floor-plans/${project?.id}/${tower?.id}/${nextUploadFloor.id}/upload`
    : towerFloors[0]
      ? `/floor-plans/${project?.id}/${tower?.id}/${towerFloors[0].id}/upload`
      : '/floor-plans';

  if (!project) {
    return (
      <EmptyState
        icon={<MapRounded />}
        title="No projects with floor plans"
        description="Create a project and add towers to start mapping floor plans."
        action={{ label: 'Create project', onClick: () => window.location.href = '/projects/new' }}
      />
    );
  }

  const mappedCount = towerFloors.filter(f => getFloorPlanByFloor(floorPlans, tower?.id ?? '', f.id)).length;

  return (
    <Box>
      <PageHeader
        title="Floor Plans"
        subtitle="Architectural blueprint view — map rooms, captures, and tours"
        breadcrumbs={[{ label: 'Floor Plans' }]}
        actions={
          <Box component={Link} to={headerUploadHref} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.875, px: 2.25, py: 1.125, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', '&:hover': { opacity: 0.92 }, transition: `opacity ${motion.durationFast}` }}>
            <UploadFileRounded sx={{ fontSize: 17 }} /> Upload Floor Plan
          </Box>
        }
      />

      <Grid container spacing={3}>
        {/* Project selector — minimal sidebar */}
        <Grid size={{ xs: 12, md: 3 }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1.25 }}>Project</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {activeProjects.map(proj => {
              const isActive = project.id === proj.id;
              return (
                <Box key={proj.id} onClick={() => selectProject(proj.id)} sx={{
                  px: 1.5, py: 1.25, borderRadius: '10px', cursor: 'pointer',
                  border: `1.5px solid ${isActive ? colors.primary : colors.borderLight}`,
                  backgroundColor: isActive ? colors.primarySoft : colors.card,
                  transition: `all ${motion.durationFast}`,
                  '&:hover': { borderColor: colors.primary },
                }}>
                  <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>{proj.name}</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.25 }}>{getTowersByProject(towers, proj.id).length} towers</Typography>
                </Box>
              );
            })}
          </Box>

          {projectTowers.length > 1 && (
            <Box sx={{ mt: 2.5 }}>
              <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1 }}>Tower</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {projectTowers.map(t => (
                  <Box key={t.id} onClick={() => setTowerId(t.id)} sx={{
                    px: 1.25, py: 0.5, borderRadius: '7px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                    backgroundColor: tower?.id === t.id ? colors.ink : colors.bgDeep,
                    color: tower?.id === t.id ? colors.white : colors.textSecondary,
                  }}>{t.name}</Box>
                ))}
              </Box>
            </Box>
          )}
        </Grid>

        {/* Blueprint canvas area */}
        <Grid size={{ xs: 12, md: 9 }}>
          <Box sx={{
            borderRadius: '16px', overflow: 'hidden',
            border: `1px solid ${colors.borderLight}`,
            background: 'linear-gradient(180deg, #0c1929 0%, #0a1420 100%)',
            minHeight: 520,
            position: 'relative',
          }}>
            {/* Blueprint grid overlay */}
            <Box sx={{
              position: 'absolute', inset: 0, opacity: 0.08, pointerEvents: 'none',
              backgroundImage: `
                linear-gradient(rgba(100,180,255,0.5) 1px, transparent 1px),
                linear-gradient(90deg, rgba(100,180,255,0.5) 1px, transparent 1px)
              `,
              backgroundSize: '24px 24px',
            }} />

            {/* Header bar */}
            <Box sx={{ position: 'relative', px: 3, py: 2, borderBottom: '1px solid rgba(100,180,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.02em' }}>{tower?.name}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: 'rgba(148,163,184,0.8)' }}>{project.name} · {towerFloors.length} floors · {mappedCount} mapped</Typography>
              </Box>
              <Chip label={`${mappedCount}/${towerFloors.length} plans`} size="small" sx={{ height: 24, fontSize: '0.6875rem', fontWeight: 600, color: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.25)' }} />
            </Box>

            {/* Floor cards — architectural preview tiles */}
            <Box sx={{ position: 'relative', p: 2.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 1.5 }}>
              {towerFloors.map(floor => {
                const stats = enrichFloorStats(floor, dataSlice);
                const hasPlan = !!stats.plan;
                const pct = stats.roomCount > 0 ? Math.round((stats.mapped / stats.roomCount) * 100) : 0;
                const isComplete = hasPlan && stats.mapped === stats.roomCount && stats.roomCount > 0;
                const href = hasPlan
                  ? `/floor-plans/${project.id}/${tower?.id}/${floor.id}`
                  : `/floor-plans/${project.id}/${tower?.id}/${floor.id}/upload`;
                const captureCount = stats.capturesOnFloor.length;

                return (
                  <Box key={floor.id} component={Link} to={href} sx={{
                    textDecoration: 'none', borderRadius: '12px', overflow: 'hidden',
                    border: `1px solid ${hasPlan ? 'rgba(96,165,250,0.25)' : 'rgba(100,116,139,0.2)'}`,
                    backgroundColor: 'rgba(15,30,50,0.6)',
                    transition: `all ${motion.durationFast}`,
                    '&:hover': { borderColor: '#60a5fa', transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' },
                  }}>
                    {/* Mini floor preview */}
                    <Box sx={{ height: 100, position: 'relative', background: hasPlan ? 'rgba(37,99,235,0.15)' : 'rgba(30,41,59,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <LayersRounded sx={{ fontSize: 28, color: hasPlan ? 'rgba(96,165,250,0.5)' : 'rgba(100,116,139,0.4)' }} />
                      {hasPlan && stats.plan?.rooms.slice(0, 6).map((room, i) => (
                        <Box key={room.id} sx={{
                          position: 'absolute',
                          left: `${room.x}%`, top: `${room.y}%`,
                          width: `${Math.min(room.width * 0.5, 20)}%`, height: `${Math.min(room.height * 0.5, 18)}%`,
                          borderRadius: '2px',
                          border: `1px solid ${room.tourId ? '#16a34a' : room.captureId ? '#d97706' : '#64748b'}`,
                          backgroundColor: room.tourId ? 'rgba(22,163,74,0.2)' : room.captureId ? 'rgba(217,119,6,0.15)' : 'rgba(100,116,139,0.1)',
                        }} />
                      ))}
                    </Box>
                    <Box sx={{ p: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                        <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{floor.label}</Typography>
                        {isComplete && <CheckCircleRounded sx={{ fontSize: 14, color: '#16a34a' }} />}
                        {!hasPlan && <Typography sx={{ fontSize: '0.625rem', fontWeight: 700, color: '#64748b' }}>NO PLAN</Typography>}
                      </Box>
                      {hasPlan ? (
                        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: 'rgba(148,163,184,0.8)' }}>
                            <MeetingRoomRounded sx={{ fontSize: 11 }} />
                            <Typography sx={{ fontSize: '0.6875rem' }}>{stats.mapped}/{stats.roomCount}</Typography>
                          </Box>
                          {captureCount > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: 'rgba(148,163,184,0.8)' }}>
                              <CameraAltRounded sx={{ fontSize: 11 }} />
                              <Typography sx={{ fontSize: '0.6875rem' }}>{captureCount}</Typography>
                            </Box>
                          )}
                          {stats.tourCount > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: 'rgba(148,163,184,0.8)' }}>
                              <ViewInArRounded sx={{ fontSize: 11 }} />
                              <Typography sx={{ fontSize: '0.6875rem' }}>{stats.tourCount}</Typography>
                            </Box>
                          )}
                        </Box>
                      ) : (
                        <Typography sx={{ fontSize: '0.75rem', color: '#60a5fa', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.375 }}>
                          <AddRounded sx={{ fontSize: 12 }} /> Upload plan
                        </Typography>
                      )}
                      {hasPlan && (
                        <Box sx={{ mt: 1, height: 3, borderRadius: '99px', backgroundColor: 'rgba(100,116,139,0.2)' }}>
                          <Box sx={{ height: '100%', width: `${pct}%`, borderRadius: '99px', backgroundColor: isComplete ? '#16a34a' : '#60a5fa' }} />
                        </Box>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
