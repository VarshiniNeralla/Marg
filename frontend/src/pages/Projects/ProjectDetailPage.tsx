import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Grid, Chip, LinearProgress, Tab, Tabs } from '@mui/material';
import {
  ArrowBackRounded, DomainRounded, LayersRounded, MeetingRoomRounded,
  CameraAltRounded, ViewInArRounded, PeopleRounded, AddRounded, ArrowForwardRounded,
  EditRounded, ArchiveRounded, AccessTimeRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  getProjectById, getTowersByProject, getCapturesByProject,
  getToursByProject, mockUsers, statusConfig,
} from '@/data/mockData';

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = getProjectById(projectId ?? '');
  const [tab, setTab] = useState(0);

  if (!project) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2 }}>
        <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: colors.borderLight }}>404</Typography>
        <Typography sx={{ color: colors.textMuted }}>Project not found</Typography>
        <Box component={Link} to="/projects" sx={{ color: colors.primary, textDecoration: 'none', fontSize: '0.875rem' }}>← Back to projects</Box>
      </Box>
    );
  }

  const towers = getTowersByProject(project.id);
  const captures = getCapturesByProject(project.id);
  const tours = getToursByProject(project.id);
  const teamMembers = mockUsers.filter(u => u.projectIds.includes(project.id));
  const st = statusConfig.project[project.status];
  const pendingReviews = captures.filter(c => c.status === 'review');

  return (
    <Box>
      {/* Back */}
      <Box sx={{ mb: 3 }}>
        <Box component={Link} to="/projects" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: colors.textMuted, textDecoration: 'none', fontSize: '0.875rem', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 16 }} /> All projects
        </Box>
      </Box>

      {/* Hero */}
      <Box sx={{ borderRadius: '20px', background: project.gradient, p: { xs: 3, md: 4 }, mb: 4, position: 'relative', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 80% at 10% 50%, rgba(255,255,255,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <Grid container spacing={3} sx={{ alignItems: 'flex-end' }}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Chip label={st.label} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, color: st.color, backgroundColor: st.bg, borderRadius: '6px', mb: 1.5 }} />
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: '#fff', letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.5 }}>
              {project.name}
            </Typography>
            <Typography sx={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.55)', mb: 2 }}>
              {project.location} · {project.client}
            </Typography>
            {project.description && (
              <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.45)', maxWidth: 520, lineHeight: 1.6 }}>
                {project.description}
              </Typography>
            )}
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
              <Box component={Link} to={`/projects/${project.id}/edit`}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.8)', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none', '&:hover': { backgroundColor: 'rgba(255,255,255,0.18)' }, transition: `background ${motion.durationFast}` }}>
                <EditRounded sx={{ fontSize: 15 }} /> Edit
              </Box>
            </Box>
          </Grid>
        </Grid>

        {/* Progress bar */}
        <Box sx={{ mt: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
            <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)' }}>Capture progress</Typography>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{project.progress}%</Typography>
          </Box>
          <LinearProgress variant="determinate" value={project.progress} sx={{ height: 4, borderRadius: '99px', backgroundColor: 'rgba(255,255,255,0.15)', '& .MuiLinearProgress-bar': { borderRadius: '99px', backgroundColor: 'rgba(255,255,255,0.8)' } }} />
        </Box>
      </Box>

      {/* Stat row */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {[
          { icon: <DomainRounded sx={{ fontSize: 18 }} />, label: 'Towers', value: project.towers, color: '#2563eb' },
          { icon: <LayersRounded sx={{ fontSize: 18 }} />, label: 'Floors', value: project.floors, color: '#0891b2' },
          { icon: <MeetingRoomRounded sx={{ fontSize: 18 }} />, label: 'Rooms', value: project.rooms, color: '#7c3aed' },
          { icon: <CameraAltRounded sx={{ fontSize: 18 }} />, label: 'Captures', value: project.captures, color: '#059669' },
          { icon: <ViewInArRounded sx={{ fontSize: 18 }} />, label: 'Tours', value: tours.length, color: '#d97706' },
          { icon: <PeopleRounded sx={{ fontSize: 18 }} />, label: 'Team', value: teamMembers.length, color: '#64748b' },
        ].map(({ icon, label, value, color }) => (
          <Grid key={label} size={{ xs: 6, sm: 4, md: 2 }}>
            <Box sx={{ p: 2, borderRadius: '14px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', textAlign: 'center' }}>
              <Box sx={{ color, mb: 0.5 }}>{icon}</Box>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>{label}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, borderBottom: `1px solid ${colors.borderLight}`, '& .MuiTab-root': { fontSize: '0.875rem', fontWeight: 500, textTransform: 'none', minWidth: 0, px: 2 }, '& .Mui-selected': { color: colors.primary }, '& .MuiTabs-indicator': { backgroundColor: colors.primary } }}>
        <Tab label="Towers" />
        <Tab label="Captures" />
        <Tab label="Tours" />
        <Tab label="Team" />
      </Tabs>

      {/* Towers tab */}
      {tab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Box component={Link} to={`/projects/${project.id}/towers`} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
              <AddRounded sx={{ fontSize: 16 }} /> Add Tower
            </Box>
          </Box>
          <Grid container spacing={2}>
            {towers.map(tower => (
              <Grid key={tower.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Box
                  component={Link}
                  to={`/projects/${project.id}/towers/${tower.id}`}
                  sx={{ display: 'block', p: 2.5, borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', textDecoration: 'none', transition: `all ${motion.durationNormal}`, '&:hover': { boxShadow: '0 8px 32px rgba(15,23,42,0.10)', transform: 'translateY(-2px)' } }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1.5 }}>
                    <Box sx={{ width: 36, height: 36, borderRadius: '9px', background: project.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <DomainRounded sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 18 }} />
                    </Box>
                    <Chip label={tower.status === 'complete' ? 'Complete' : tower.status === 'active' ? 'Active' : 'Pending'}
                      size="small" sx={{ height: 20, fontSize: '0.625rem', fontWeight: 600, color: tower.status === 'complete' ? '#16a34a' : tower.status === 'active' ? '#2563eb' : '#64748b', backgroundColor: tower.status === 'complete' ? 'rgba(22,163,74,0.08)' : tower.status === 'active' ? 'rgba(37,99,235,0.08)' : 'rgba(100,116,139,0.08)', borderRadius: '5px' }} />
                  </Box>
                  <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>{tower.name}</Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 1.5 }}>{tower.floors} floors · {tower.rooms} rooms</Typography>
                  <Box sx={{ mb: 0.75 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>Captured</Typography>
                      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: project.accent }}>{tower.progress}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={tower.progress} sx={{ height: 3, borderRadius: '99px', backgroundColor: `${project.accent}18`, '& .MuiLinearProgress-bar': { borderRadius: '99px', background: project.accent } }} />
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <Typography sx={{ fontSize: '0.75rem', color: project.accent, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 0.25 }}>
                      View floors <ArrowForwardRounded sx={{ fontSize: 13 }} />
                    </Typography>
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* Captures tab */}
      {tab === 1 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Box component={Link} to="/captures" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
              <CameraAltRounded sx={{ fontSize: 16 }} /> Upload Capture
            </Box>
          </Box>
          <Grid container spacing={2}>
            {captures.map(c => {
              const cs = statusConfig.capture[c.status];
              return (
                <Grid key={c.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Box component={Link} to={`/captures/${c.id}`} sx={{ display: 'block', borderRadius: '16px', backgroundColor: colors.card, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', textDecoration: 'none', transition: `all ${motion.durationNormal}`, '&:hover': { boxShadow: '0 8px 32px rgba(15,23,42,0.10)', transform: 'translateY(-2px)' } }}>
                    <Box sx={{ height: 96, background: c.gradient }} />
                    <Box sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{c.roomName}</Typography>
                        <Chip label={cs.label} size="small" sx={{ height: 18, fontSize: '0.5625rem', fontWeight: 700, color: cs.color, backgroundColor: cs.bg, borderRadius: '4px' }} />
                      </Box>
                      <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{c.floorLabel} · {c.towerName}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, color: colors.textSubdued }}>
                        <AccessTimeRounded sx={{ fontSize: 11 }} />
                        <Typography sx={{ fontSize: '0.6875rem', color: 'inherit' }}>{c.uploadedAt}</Typography>
                      </Box>
                    </Box>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}

      {/* Tours tab */}
      {tab === 2 && (
        <Grid container spacing={2}>
          {tours.map(tour => {
            const ts = statusConfig.tour[tour.status];
            return (
              <Grid key={tour.id} size={{ xs: 12, sm: 6, md: 4 }}>
                <Box component={Link} to={`/tours/${tour.id}`} sx={{ display: 'block', borderRadius: '16px', backgroundColor: colors.card, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', textDecoration: 'none', transition: `all ${motion.durationNormal}`, '&:hover': { boxShadow: '0 8px 32px rgba(15,23,42,0.10)', transform: 'translateY(-2px)' } }}>
                  <Box sx={{ height: 120, background: tour.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    <ViewInArRounded sx={{ color: 'rgba(255,255,255,0.3)', fontSize: 36 }} />
                    <Chip label={ts.label} size="small" sx={{ position: 'absolute', top: 8, right: 8, height: 18, fontSize: '0.5625rem', fontWeight: 700, color: ts.color, backgroundColor: ts.bg, borderRadius: '4px' }} />
                  </Box>
                  <Box sx={{ p: 2 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>{tour.roomName}</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{tour.floorLabel} · {tour.captures} captures</Typography>
                  </Box>
                </Box>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Team tab */}
      {tab === 3 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {teamMembers.map(user => (
            <Box key={user.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderRadius: '12px', backgroundColor: colors.card, boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
              <Box sx={{ width: 40, height: 40, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: '#fff' }}>{user.name[0]}</Typography>
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{user.name}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{user.designation}</Typography>
              </Box>
              <Chip label={user.role} size="small" sx={{ height: 20, fontSize: '0.625rem', fontWeight: 600, color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: '5px' }} />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
