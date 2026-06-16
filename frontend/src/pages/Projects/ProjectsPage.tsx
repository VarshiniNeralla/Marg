import React from 'react';
import { Box, Typography, Grid, Chip, LinearProgress } from '@mui/material';
import {
  DomainRounded,
  LayersRounded,
  MeetingRoomRounded,
  CameraAltRounded,
  ArrowForwardRounded,
  AddRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  active:  { label: 'Active',      color: colors.success,   bg: colors.successBg },
  review:  { label: 'In Review',   color: colors.warning,   bg: colors.warningBg },
  draft:   { label: 'Draft',       color: colors.textMuted, bg: colors.bgDeep },
  done:    { label: 'Completed',   color: colors.primary,   bg: colors.primarySoft },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const allProjects = useWorkflowStore(s => s.projects);
  const mockProjects = allProjects.filter(p => !p.archived);
  return (
    <Box>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 5 }}>
        <Box>
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
            Projects
          </Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
            {mockProjects.length} project{mockProjects.length === 1 ? '' : 's'} · My Home Constructions
          </Typography>
        </Box>
        <Box
          component={Link}
          to="/projects/new"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            px: 2,
            py: 0.875,
            borderRadius: '10px',
            background: colors.primaryGradient,
            color: '#fff',
            fontSize: '0.875rem',
            fontWeight: 600,
            textDecoration: 'none',
            boxShadow: '0 4px 14px rgba(37,99,235,0.28)',
            flexShrink: 0,
            '&:hover': { opacity: 0.92 },
            transition: `opacity ${motion.durationFast}`,
          }}
        >
          <AddRounded sx={{ fontSize: 18 }} />
          New Project
        </Box>
      </Box>

      {/* Project cards — visual-first */}
      <Grid container spacing={2.5}>
        {mockProjects.map((project) => {
          const status = statusConfig[project.status] ?? statusConfig.draft;
          return (
            <Grid key={project.id} size={{ xs: 12, sm: 6 }}>
              <Box
                sx={{
                  borderRadius: '20px',
                  backgroundColor: colors.card,
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
                  transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}`,
                  '&:hover': {
                    boxShadow: '0 8px 32px rgba(15,23,42,0.10)',
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                {/* Cover image area */}
                <Box
                  sx={{
                    height: 180,
                    background: project.gradient,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    p: 2.5,
                  }}
                >
                  {/* Top: status chip */}
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Chip
                      label={status.label}
                      size="small"
                      sx={{
                        height: 22,
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        color: status.color,
                        backgroundColor: status.bg,
                        borderRadius: '7px',
                      }}
                    />
                  </Box>

                  {/* Bottom: project name overlay */}
                  <Box>
                    <Typography
                      sx={{
                        fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
                        fontSize: '1.25rem',
                        fontWeight: 700,
                        color: 'rgba(255,255,255,0.92)',
                        letterSpacing: '-0.025em',
                        lineHeight: 1.2,
                        mb: 0.25,
                      }}
                    >
                      {project.name}
                    </Typography>
                    <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>
                      {project.location}
                    </Typography>
                  </Box>
                </Box>

                {/* Card body */}
                <Box sx={{ px: 2.5, pt: 2.5, pb: 2 }}>
                  {/* Stats row */}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      mb: 2.5,
                    }}
                  >
                    {[
                      { icon: <DomainRounded sx={{ fontSize: 13 }} />,       val: project.towers,   label: 'Towers' },
                      { icon: <LayersRounded sx={{ fontSize: 13 }} />,       val: project.floors,   label: 'Floors' },
                      { icon: <MeetingRoomRounded sx={{ fontSize: 13 }} />,  val: project.rooms,    label: 'Rooms' },
                      { icon: <CameraAltRounded sx={{ fontSize: 13 }} />,    val: project.captures, label: 'Captures' },
                    ].map(({ icon, val, label }) => (
                      <Box key={label} sx={{ textAlign: 'center' }}>
                        <Typography sx={{ fontSize: '1.125rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em', lineHeight: 1 }}>
                          {val}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.25, mt: 0.375, color: colors.textSubdued }}>
                          {icon}
                          <Typography sx={{ fontSize: '0.625rem', color: 'inherit' }}>{label}</Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>

                  {/* Progress */}
                  <Box sx={{ mb: 2.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                      <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>Capture progress</Typography>
                      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: project.accent }}>
                        {project.progress}%
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={project.progress}
                      sx={{
                        height: 4,
                        borderRadius: '99px',
                        backgroundColor: `${project.accent}18`,
                        '& .MuiLinearProgress-bar': {
                          borderRadius: '99px',
                          background: project.accent,
                        },
                      }}
                    />
                  </Box>

                  {/* Footer */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>
                      Updated {project.lastUpdated}
                    </Typography>
                    <Box
                      component={Link}
                      to={`/projects/${project.id}`}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: project.accent,
                        textDecoration: 'none',
                        '&:hover': { opacity: 0.75 },
                      }}
                    >
                      Open project <ArrowForwardRounded sx={{ fontSize: 14 }} />
                    </Box>
                  </Box>
                </Box>
              </Box>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
