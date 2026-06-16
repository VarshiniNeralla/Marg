import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid, Chip, Menu, MenuItem } from '@mui/material';
import {
  ViewInArRounded,
  PlayArrowRounded,
  CameraAltRounded,
  AccessTimeRounded,
  KeyboardArrowDownRounded,
  CheckRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig } from '@/data/mockData';
import { useWorkflowStore } from '@store/workflowStore';

// ── Component ──────────────────────────────────────────────────────────────────

export default function ToursPage() {
  const [projectId, setProjectId] = useState<string>('all');
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  // Reactive: live data from the workflow store.
  const mockTours = useWorkflowStore(s => s.tours);
  const mockProjects = useWorkflowStore(s => s.projects);
  const PROJECTS_WITH_TOURS = useMemo(
    () => mockProjects.filter(p => !p.archived && mockTours.some(t => t.projectId === p.id)),
    [mockProjects, mockTours],
  );

  const tours = useMemo(
    () => (projectId === 'all' ? mockTours : mockTours.filter(t => t.projectId === projectId)),
    [mockTours, projectId],
  );

  const selectedProject = PROJECTS_WITH_TOURS.find(p => p.id === projectId);
  const selectedCount = projectId === 'all' ? mockTours.length : tours.length;

  return (
    <Box>
      {/* Heading */}
      <Box sx={{ mb: 3 }}>
        <Typography
          sx={{
            fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
            fontSize: { xs: '1.5rem', md: '2rem' },
            fontWeight: 700,
            color: colors.textStrong,
            letterSpacing: '-0.04em',
            lineHeight: 1.1,
            mb: 0.75,
          }}
        >
          Virtual Tours
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          {mockTours.length} tours · across {PROJECTS_WITH_TOURS.length} {PROJECTS_WITH_TOURS.length === 1 ? 'project' : 'projects'}
        </Typography>
      </Box>

      {/* ── Project selector — single pill dropdown ─────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Box
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 1.25,
            pl: 1.5, pr: 1.25, py: 1, borderRadius: '999px', cursor: 'pointer',
            border: `1px solid ${menuAnchor ? colors.textStrong : colors.border}`,
            backgroundColor: colors.card,
            boxShadow: menuAnchor ? `0 0 0 3px ${colors.primaryRing}` : '0 1px 2px rgba(15,23,42,0.05)',
            transition: `all ${motion.durationFast} ${motion.easeOut}`,
            '&:hover': { borderColor: colors.textSubdued },
          }}
        >
          <Box sx={{ width: 22, height: 22, borderRadius: '7px', background: selectedProject ? selectedProject.gradient : `linear-gradient(135deg, ${colors.textSubdued} 0%, ${colors.textMuted} 100%)`, flexShrink: 0 }} />
          <Box sx={{ lineHeight: 1.1 }}>
            <Typography sx={{ fontSize: '0.625rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Project</Typography>
            <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em', maxWidth: 200 }}>
              {selectedProject ? selectedProject.name : 'All projects'}
            </Typography>
          </Box>
          <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted, ml: 0.5 }}>
            {selectedCount}
          </Box>
          <KeyboardArrowDownRounded sx={{ fontSize: 20, color: colors.textMuted, transform: menuAnchor ? 'rotate(180deg)' : 'none', transition: `transform ${motion.durationFast}` }} />
        </Box>

        <Menu
          anchorEl={menuAnchor}
          open={!!menuAnchor}
          onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{ paper: { sx: { mt: 1, minWidth: 280, borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
        >
          {[{ id: 'all', name: 'All projects', gradient: `linear-gradient(135deg, ${colors.textSubdued} 0%, ${colors.textMuted} 100%)`, count: mockTours.length },
            ...PROJECTS_WITH_TOURS.map(p => ({ id: p.id, name: p.name, gradient: p.gradient, count: mockTours.filter(t => t.projectId === p.id).length }))]
            .map(opt => {
              const isActive = projectId === opt.id;
              return (
                <MenuItem
                  key={opt.id}
                  onClick={() => { setProjectId(opt.id); setMenuAnchor(null); }}
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
      </Box>

      {tours.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 12 }}>
          <Box sx={{ width: 56, height: 56, borderRadius: '16px', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
            <ViewInArRounded sx={{ fontSize: 26, color: colors.textSubdued }} />
          </Box>
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 600, color: colors.textSecondary, mb: 0.5 }}>No tours in this project yet</Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Pick another project to view its virtual tours.</Typography>
        </Box>
      ) : (
      <Grid container spacing={2}>
        {tours.map((tour) => {
          const st = (statusConfig.tour as Record<string, { label: string; color: string; bg: string }>)[tour.status] ?? statusConfig.tour.draft;
          const project = mockProjects.find(p => p.id === tour.projectId);
          return (
            <Grid key={tour.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Box
                component={Link}
                to={`/tours/${tour.id}`}
                sx={{
                  display: 'block',
                  textDecoration: 'none',
                  borderRadius: '18px',
                  backgroundColor: colors.card,
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
                  cursor: 'pointer',
                  transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}`,
                  '&:hover': {
                    boxShadow: '0 8px 32px rgba(15,23,42,0.10)',
                    transform: 'translateY(-2px)',
                  },
                  '&:hover .tour-play': { opacity: 1, transform: 'scale(1)' },
                }}
              >
                {/* Thumbnail */}
                <Box
                  sx={{
                    height: 160,
                    background: tour.gradient,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Box
                    className="tour-play"
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      backgroundColor: 'rgba(255,255,255,0.18)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255,255,255,0.28)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      transform: 'scale(0.85)',
                      transition: `opacity ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}`,
                    }}
                  >
                    <PlayArrowRounded sx={{ color: colors.white, fontSize: 26 }} />
                  </Box>

                  {/* 360 badge */}
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 12,
                      left: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      px: 1,
                      py: 0.375,
                      borderRadius: '6px',
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      backdropFilter: 'blur(6px)',
                    }}
                  >
                    <ViewInArRounded sx={{ color: colors.white, fontSize: 12 }} />
                    <Typography sx={{ fontSize: '0.625rem', fontWeight: 700, color: colors.white, letterSpacing: '0.05em' }}>
                      360°
                    </Typography>
                  </Box>

                  {/* Status chip */}
                  <Box sx={{ position: 'absolute', top: 12, right: 12 }}>
                    <Chip
                      label={st.label}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.625rem',
                        fontWeight: 600,
                        color: st.color,
                        backgroundColor: st.bg,
                        borderRadius: '5px',
                      }}
                    />
                  </Box>
                </Box>

                {/* Body */}
                <Box sx={{ px: 2, pt: 2, pb: 2 }}>
                  <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>
                    {tour.roomName}
                  </Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1.5 }}>
                    {project?.name ?? tour.projectName} · {tour.floorLabel}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: colors.textSubdued }}>
                      <CameraAltRounded sx={{ fontSize: 12 }} />
                      <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>{tour.captures} captures</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textSubdued }}>
                      <AccessTimeRounded sx={{ fontSize: 11 }} />
                      <Typography sx={{ fontSize: '0.6875rem', color: 'inherit' }}>{tour.lastCapture}</Typography>
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Grid>
          );
        })}
      </Grid>
      )}
    </Box>
  );
}
