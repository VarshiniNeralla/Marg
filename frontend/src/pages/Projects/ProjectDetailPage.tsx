import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Grid, Chip, Pagination } from '@mui/material';
import {
  ArrowBackRounded, DomainRounded, LayersRounded,
  CameraAltRounded, AddRounded,
  EditRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig } from '@store/workflowSelectors';
import {
  getProjectById, getTowersByProject,
} from '@store/workflowSelectors';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isAdmin } from '@store/authStore';

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projects    = useWorkflowStore(s => s.projects);
  const towers      = useWorkflowStore(s => s.towers);
  const floors      = useWorkflowStore(s => s.floors);
  const rooms       = useWorkflowStore(s => s.rooms);
  const captures    = useWorkflowStore(s => s.captures);
  const { user: currentUser } = useAuthStore();
  const hasAdminRole = isAdmin(currentUser);
  const [towerPage, setTowerPage] = useState(1);

  const project = getProjectById(projects, projectId ?? '');

  if (!project) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2 }}>
        <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: colors.borderLight }}>404</Typography>
        <Typography sx={{ color: colors.textMuted }}>Project not found</Typography>
        <Box component={Link} to="/projects" sx={{ color: colors.primary, textDecoration: 'none', fontSize: '0.875rem' }}>← Back to projects</Box>
      </Box>
    );
  }

  const projectTowers  = [...getTowersByProject(towers, project.id)].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
  const projectTowerIds  = new Set(projectTowers.map(t => t.id));
  const projectFloors    = floors.filter(f => projectTowerIds.has(f.towerId));
  const projectFloorIds  = new Set(projectFloors.map(f => f.id));
  const projectRooms     = rooms.filter(r => projectFloorIds.has(r.floorId));
  const projectRoomIds   = new Set(projectRooms.map(r => r.id));
  const projectCaptures  = captures.filter(c => projectRoomIds.has(c.roomId));
  const st = statusConfig.project[project.status];

  const TOWERS_PER_PAGE = 6; // 3 columns × 2 rows
  const towerTotalPages = Math.max(1, Math.ceil(projectTowers.length / TOWERS_PER_PAGE));
  const safeTowerPage = Math.min(towerPage, towerTotalPages);
  const pagedTowers = projectTowers.slice((safeTowerPage - 1) * TOWERS_PER_PAGE, safeTowerPage * TOWERS_PER_PAGE);

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {/* Back */}
      <Box sx={{ mb: 3 }}>
        <Box component={Link} to="/projects" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: colors.textMuted, textDecoration: 'none', fontSize: '0.875rem', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 16 }} /> All projects
        </Box>
      </Box>

      {/* Hero */}
      <Box sx={{ borderRadius: { xs: '16px', md: '20px' }, background: project.gradient, p: { xs: 2, md: 4 }, mb: { xs: 2.5, md: 4 }, position: 'relative', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 80% at 10% 50%, rgba(255,255,255,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <Grid container spacing={{ xs: 1.5, md: 3 }} sx={{ alignItems: 'flex-end' }}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Chip label={st.label} size="small" sx={{ height: { xs: 18, md: 22 }, fontSize: { xs: '0.625rem', md: '0.6875rem' }, fontWeight: 600, color: st.color, backgroundColor: st.bg, borderRadius: '6px', mb: { xs: 1, md: 1.5 } }} />
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.125rem', md: '2rem' }, fontWeight: 700, color: '#fff', letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.5 }}>
              {project.name}
            </Typography>
            <Typography sx={{ fontSize: { xs: '0.75rem', md: '0.9375rem' }, color: 'rgba(255,255,255,0.55)', mb: { xs: 0, md: 2 } }}>
              {project.location} · {project.client}
            </Typography>
            {project.description && (
              <Typography sx={{ display: { xs: 'none', md: 'block' }, fontSize: '0.875rem', color: 'rgba(255,255,255,0.45)', maxWidth: 520, lineHeight: 1.6 }}>
                {project.description}
              </Typography>
            )}
          </Grid>
          {hasAdminRole && (
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ display: 'flex', gap: 1, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
                <Box component={Link} to={`/projects/${project.id}/edit`}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: { xs: 1.25, md: 2 }, py: { xs: 0.5, md: 1 }, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.8)', fontSize: { xs: '0.75rem', md: '0.875rem' }, fontWeight: 500, textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(255,255,255,0.18)' }, transition: `background ${motion.durationFast}` }}>
                  <EditRounded sx={{ fontSize: 15 }} /> Edit
                </Box>
              </Box>
            </Grid>
          )}
        </Grid>
      </Box>

      {/* Stat row */}
      <Grid container spacing={{ xs: 1, sm: 2 }} sx={{ mb: { xs: 2.5, md: 4 } }}>
        {[
          { icon: <DomainRounded sx={{ fontSize: { xs: 16, sm: 20 } }} />,    label: 'Towers',   value: projectTowers.length,   color: '#2563eb' },
          { icon: <LayersRounded sx={{ fontSize: { xs: 16, sm: 20 } }} />,    label: 'Floors',   value: projectFloors.length,   color: '#0891b2' },
          { icon: <CameraAltRounded sx={{ fontSize: { xs: 16, sm: 20 } }} />, label: 'Captures', value: projectCaptures.length, color: '#059669' },
        ].map(({ icon, label, value, color }) => (
          <Grid key={label} size={4}>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 0.75, sm: 1.75 }, p: { xs: 1.25, sm: 2.25 }, borderRadius: { xs: '10px', sm: '14px' }, backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
              <Box sx={{ width: { xs: 30, sm: 44 }, height: { xs: 30, sm: 44 }, borderRadius: { xs: '8px', sm: '11px' }, display: 'flex', alignItems: 'center', justifyContent: 'center', color, backgroundColor: `${color}14`, flexShrink: 0 }}>
                {icon}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: { xs: '1rem', sm: '1.375rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</Typography>
                <Typography noWrap sx={{ fontSize: { xs: '0.625rem', sm: '0.75rem' }, color: colors.textMuted, mt: { xs: 0.125, sm: 0.375 } }}>{label}</Typography>
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* Towers */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>Towers</Typography>
          {hasAdminRole && (
            <Box component={Link} to={`/projects/${project.id}/towers`} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 0.75 }, px: { xs: 1.25, sm: 2 }, py: { xs: 0.625, sm: 0.875 }, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: { xs: '0.75rem', sm: '0.875rem' }, fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', whiteSpace: 'nowrap' }}>
              <AddRounded sx={{ fontSize: { xs: 14, sm: 16 } }} /> Add Tower
            </Box>
          )}
        </Box>
        <Box sx={{
          display: 'grid',
          width: '100%',
          gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
          gap: { xs: '10px', sm: '12px', md: '16px' },
        }}>
          {pagedTowers.map(tower => {
            const towerFloorCount = projectFloors.filter(f => f.towerId === tower.id).length;
            const towerFloorIds = new Set(projectFloors.filter(f => f.towerId === tower.id).map(f => f.id));
            const towerRoomIds = new Set(projectRooms.filter(r => towerFloorIds.has(r.floorId)).map(r => r.id));
            const towerCaptureCount = projectCaptures.filter(c => towerRoomIds.has(c.roomId)).length;
            return (
              <Box
                key={tower.id}
                {...(hasAdminRole ? { component: Link, to: `/projects/${project.id}/towers/${tower.id}` } : {})}
                sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', p: 1.25, borderRadius: '12px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', textDecoration: 'none', transition: `all ${motion.durationNormal}`, ...(hasAdminRole && { '&:hover': { boxShadow: '0 8px 32px rgba(15,23,42,0.10)', transform: 'translateY(-2px)' } }) }}
              >
                <Box sx={{ width: 40, height: 40, borderRadius: '10px', background: project.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1 }}>
                  <DomainRounded sx={{ color: '#fff', fontSize: 18 }} />
                </Box>
                <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em', maxWidth: '100%', mb: 0.375 }}>{tower.name}</Typography>
                <Typography sx={{ fontSize: '0.625rem', color: colors.textMuted, lineHeight: 1.4 }}>
                  {towerFloorCount} floor{towerFloorCount === 1 ? '' : 's'} · {towerCaptureCount} capture{towerCaptureCount === 1 ? '' : 's'}
                </Typography>
              </Box>
            );
          })}
          {projectTowers.length === 0 && (
            <Box sx={{ gridColumn: '1 / -1', textAlign: 'center', py: 6, color: colors.textMuted }}>
              <DomainRounded sx={{ fontSize: 40, mb: 1, opacity: 0.3 }} />
              <Typography sx={{ fontSize: '0.9rem' }}>No towers yet. Go to the Towers page to add one.</Typography>
            </Box>
          )}
        </Box>
        {towerTotalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2.5 }}>
            <Pagination
              count={towerTotalPages}
              page={safeTowerPage}
              onChange={(_, page) => setTowerPage(page)}
              shape="rounded"
              size="small"
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
