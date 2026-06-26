import React, { useState } from 'react';
import { Box, Typography, Grid, Chip, LinearProgress, Dialog, DialogTitle, DialogContent, DialogActions, Button as MuiButton, Tooltip, IconButton } from '@mui/material';
import {
  DomainRounded, LayersRounded, MeetingRoomRounded, CameraAltRounded,
  ArrowForwardRounded, AddRounded, DeleteRounded, EditRounded, ArrowBackRounded
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isAdmin , getRoleLandingPath } from '@store/authStore';
import { useSettingsStore } from '@store/settingsStore';

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  active:  { label: 'Active',      color: colors.success,   bg: colors.successBg },
  review:  { label: 'In Review',   color: colors.warning,   bg: colors.warningBg },
  draft:   { label: 'Draft',       color: colors.textMuted, bg: colors.bgDeep },
  done:    { label: 'Completed',   color: colors.primary,   bg: colors.primarySoft },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const allProjects = useWorkflowStore(s => s.projects);
  const archiveProject = useWorkflowStore(s => s.archiveProject);
  const { user } = useAuthStore();
  const orgName = useSettingsStore(s => s.organization.name);
  const hasAdminRole = isAdmin(user);
  const activeProjects = allProjects.filter(p => !p.archived);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const projectToDelete = activeProjects.find(p => p.id === deleteTarget);

  function handleDelete() {
    if (deleteTarget) archiveProject(deleteTarget);
    setDeleteTarget(null);
  }

  return (
    <Box>
      {/* Back to overview */}
      <Box component={Link} to={getRoleLandingPath(user?.role)} sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
        fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
        transition: `all ${motion.durationFast}`, '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
      }}>
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
      </Box>

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
            {activeProjects.length} project{activeProjects.length === 1 ? '' : 's'} · {orgName}
          </Typography>
        </Box>
        {hasAdminRole && (
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
        )}
      </Box>

      {/* Project cards — visual-first */}
      <Grid container spacing={2.5}>
        {activeProjects.map((project) => {
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
                    background: project.thumbnail ? `url(${project.thumbnail}) center/cover no-repeat` : project.gradient,
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    p: 2.5,
                  }}
                >
                  {/* dark overlay so text stays readable over photos */}
                  {project.thumbnail && (
                    <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.55) 100%)' }} />
                  )}
                  {/* Top: status chip + admin delete — position:relative to sit above overlay */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
                    <Box />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                      {hasAdminRole && (
                        <Tooltip title="Delete project">
                          <IconButton
                            size="small"
                            onClick={(e) => { e.preventDefault(); setDeleteTarget(project.id); }}
                            sx={{
                              width: 26, height: 26,
                              backgroundColor: 'rgba(239,68,68,0.15)',
                              color: '#ef4444',
                              '&:hover': { backgroundColor: 'rgba(239,68,68,0.28)' },
                            }}
                          >
                            <DeleteRounded sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>

                  {/* Bottom: project name overlay — position:relative to sit above overlay */}
                  <Box sx={{ position: 'relative' }}>
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

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        slotProps={{ paper: { sx: { borderRadius: '16px', minWidth: 360 } } }}
      >
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>
          Delete Project
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.9rem', color: colors.textMuted }}>
            Are you sure you want to delete <strong style={{ color: colors.textStrong }}>{projectToDelete?.name}</strong>?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <MuiButton onClick={() => setDeleteTarget(null)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>
            Cancel
          </MuiButton>
          <MuiButton
            onClick={handleDelete}
            variant="contained"
            sx={{ borderRadius: '8px', textTransform: 'none', backgroundColor: '#ef4444', boxShadow: 'none', '&:hover': { backgroundColor: '#dc2626' } }}
          >
            Delete
          </MuiButton>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
