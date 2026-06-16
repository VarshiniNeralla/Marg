import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid, Chip } from '@mui/material';
import {
  LayersRounded, MeetingRoomRounded, ViewInArRounded, ArrowForwardRounded,
  UploadFileRounded, MapRounded, CheckCircleRounded, AddRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  mockProjects, getTowersByProject, getFloors, getFloorPlanByFloor,
  mockTours, type MockProject, type MockTower,
} from '@/data/mockData';

// Only show projects that actually have towers/floors to map.
const PROJECTS = mockProjects.filter(p => getTowersByProject(p.id).length > 0);

export default function FloorPlansPage() {
  const [projectId, setProjectId] = useState(PROJECTS[0]?.id ?? '');
  const project = PROJECTS.find(p => p.id === projectId) ?? PROJECTS[0];

  const towers = useMemo(() => getTowersByProject(project.id), [project.id]);
  const [towerId, setTowerId] = useState(towers[0]?.id ?? '');
  const tower = towers.find(t => t.id === towerId) ?? towers[0];

  function selectProject(p: MockProject) {
    setProjectId(p.id);
    const firstTower = getTowersByProject(p.id)[0];
    setTowerId(firstTower?.id ?? '');
  }

  // Show the upper floors (most recently worked) — those are where plans exist.
  const floors = useMemo(() => (tower ? getFloors(tower.id).slice(0, 8) : []), [tower]);

  const uploadBase = (floorId: string) => `/floor-plans/${project.id}/${tower?.id}/${floorId}/upload`;
  const viewBase = (floorId: string) => `/floor-plans/${project.id}/${tower?.id}/${floorId}`;

  // First floor without a plan = the natural "upload next" target for the header CTA.
  const nextUploadFloor = floors.find(f => !getFloorPlanByFloor(tower?.id ?? '', f.id));
  const headerUploadHref = nextUploadFloor ? uploadBase(nextUploadFloor.id) : (floors[0] ? uploadBase(floors[0].id) : '#');

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 4 }}>
        <Box>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>
            Floor Plans
          </Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
            Browse floors, map rooms, and upload floor plans
          </Typography>
        </Box>
        <Box component={Link} to={headerUploadHref} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.875, px: 2.25, py: 1.125, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', '&:hover': { opacity: 0.92 }, transition: `opacity ${motion.durationFast}` }}>
          <UploadFileRounded sx={{ fontSize: 17 }} /> Upload Floor Plan
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* ── Left: project + tower selector ──────────────────────────────── */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.25 }}>
              Projects
            </Typography>
            {PROJECTS.map((proj) => {
              const isActive = project.id === proj.id;
              const tw = getTowersByProject(proj.id);
              return (
                <Box
                  key={proj.id}
                  onClick={() => selectProject(proj)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.75, p: 1.5, borderRadius: '14px', cursor: 'pointer',
                    backgroundColor: colors.card,
                    border: `1.5px solid ${isActive ? colors.primary : 'transparent'}`,
                    boxShadow: isActive ? `0 0 0 3px ${colors.primaryRing}, 0 2px 8px rgba(15,23,42,0.05)` : '0 2px 8px rgba(15,23,42,0.05)',
                    transition: `all ${motion.durationFast} ${motion.easeOut}`,
                    '&:hover': { borderColor: isActive ? colors.primary : colors.border },
                  }}
                >
                  <Box sx={{ width: 42, height: 42, borderRadius: '11px', background: proj.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MapRounded sx={{ fontSize: 19, color: 'rgba(255,255,255,0.65)' }} />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong }}>{proj.name}</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
                      {tw.length} {tw.length === 1 ? 'tower' : 'towers'} · {proj.floors} floors
                    </Typography>
                  </Box>
                </Box>
              );
            })}

            {/* Tower selector */}
            {towers.length > 1 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1 }}>
                  Towers
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {towers.map((t: MockTower) => {
                    const isActive = tower?.id === t.id;
                    return (
                      <Box
                        key={t.id}
                        onClick={() => setTowerId(t.id)}
                        sx={{ px: 1.5, py: 0.625, borderRadius: '8px', cursor: 'pointer', backgroundColor: isActive ? colors.ink : colors.card, color: isActive ? colors.white : colors.textSecondary, fontSize: '0.8125rem', fontWeight: isActive ? 600 : 500, boxShadow: isActive ? 'none' : '0 1px 3px rgba(15,23,42,0.06)', transition: `all ${motion.durationFast}`, '&:hover': { color: isActive ? colors.white : colors.textStrong } }}
                      >
                        {t.name}
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}
          </Box>
        </Grid>

        {/* ── Right: floor list ──────────────────────────────────────────── */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
            {/* Tower header */}
            <Box sx={{ px: 3, pt: 2.5, pb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${colors.borderLight}` }}>
              <Box>
                <Typography sx={{ fontSize: '1.0625rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>{tower?.name}</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{project.name} · showing {floors.length} floors</Typography>
              </Box>
              <Chip
                icon={<MapRounded sx={{ fontSize: 14 }} />}
                label={`${floors.filter(f => getFloorPlanByFloor(tower?.id ?? '', f.id)).length} mapped`}
                size="small"
                sx={{ height: 26, fontSize: '0.6875rem', fontWeight: 600, color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: '7px', '& .MuiChip-icon': { color: colors.primary } }}
              />
            </Box>

            {/* Floors */}
            <Box sx={{ p: 1.5 }}>
              {floors.map((floor) => {
                const plan = getFloorPlanByFloor(tower?.id ?? '', floor.id);
                const hasPlan = !!plan;
                const roomCount = plan ? plan.rooms.length : floor.rooms;
                const mapped = plan ? plan.rooms.filter(r => r.status !== 'not_started').length : 0;
                const tourCount = plan ? plan.rooms.filter(r => r.tourId).length : 0;
                const pct = roomCount > 0 ? Math.round((mapped / roomCount) * 100) : 0;
                const isComplete = hasPlan && mapped === roomCount && roomCount > 0;

                // Floors WITHOUT a plan link to upload; floors WITH a plan link to the viewer.
                const href = hasPlan ? viewBase(floor.id) : uploadBase(floor.id);

                return (
                  <Box
                    key={floor.id}
                    component={Link}
                    to={href}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 2, p: 1.5, borderRadius: '12px', textDecoration: 'none',
                      transition: `background ${motion.durationFast}`,
                      '&:hover': { backgroundColor: colors.bg },
                      '&:hover .fp-arrow': { opacity: 1, transform: 'translateX(3px)' },
                    }}
                  >
                    {/* Thumbnail */}
                    <Box sx={{ width: 64, height: 48, borderRadius: '8px', background: hasPlan ? project.gradient : colors.bgDeep, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                      <LayersRounded sx={{ color: hasPlan ? 'rgba(255,255,255,0.6)' : colors.textSubdued, fontSize: 20 }} />
                    </Box>

                    {/* Info */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong }}>{floor.label}</Typography>
                        {isComplete && (
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.375, px: 0.75, py: 0.125, borderRadius: '5px', backgroundColor: colors.successBg }}>
                            <CheckCircleRounded sx={{ fontSize: 11, color: colors.success }} />
                            <Typography sx={{ fontSize: '0.625rem', fontWeight: 700, color: colors.success }}>Complete</Typography>
                          </Box>
                        )}
                        {!hasPlan && (
                          <Box sx={{ px: 0.75, py: 0.125, borderRadius: '5px', backgroundColor: colors.bgDeep, fontSize: '0.625rem', fontWeight: 700, color: colors.textSubdued }}>No plan</Box>
                        )}
                      </Box>
                      {hasPlan ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textMuted }}>
                            <MeetingRoomRounded sx={{ fontSize: 12 }} />
                            <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>{mapped}/{roomCount} rooms</Typography>
                          </Box>
                          {tourCount > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textMuted }}>
                              <ViewInArRounded sx={{ fontSize: 12 }} />
                              <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>{tourCount} {tourCount === 1 ? 'tour' : 'tours'}</Typography>
                            </Box>
                          )}
                        </Box>
                      ) : (
                        <Typography sx={{ fontSize: '0.75rem', color: colors.primary, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 0.375 }}>
                          <AddRounded sx={{ fontSize: 13 }} /> Upload a floor plan
                        </Typography>
                      )}
                    </Box>

                    {/* Progress (only when mapped) */}
                    {hasPlan && (
                      <Box sx={{ width: 80, flexShrink: 0 }}>
                        <Box sx={{ height: 4, borderRadius: '99px', backgroundColor: colors.bgDeep, mb: 0.5 }}>
                          <Box sx={{ height: '100%', width: `${pct}%`, borderRadius: '99px', backgroundColor: isComplete ? colors.success : colors.primary }} />
                        </Box>
                        <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, textAlign: 'right' }}>{pct}%</Typography>
                      </Box>
                    )}

                    {/* Trailing action */}
                    {hasPlan ? (
                      <ArrowForwardRounded className="fp-arrow" sx={{ fontSize: 15, color: colors.textSubdued, opacity: 0, transition: `opacity ${motion.durationFast}, transform ${motion.durationFast}`, flexShrink: 0 }} />
                    ) : (
                      <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.625, borderRadius: '8px', border: `1px dashed ${colors.border}`, color: colors.textMuted, fontSize: '0.75rem', fontWeight: 600 }}>
                        <UploadFileRounded sx={{ fontSize: 13 }} /> Upload
                      </Box>
                    )}
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
