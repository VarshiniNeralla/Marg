import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Grid, Chip, LinearProgress, Tab, Tabs, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, InputAdornment } from '@mui/material';
import {
  ArrowBackRounded, DomainRounded, LayersRounded, MeetingRoomRounded,
  CameraAltRounded, PeopleRounded, AddRounded, ArrowForwardRounded,
  EditRounded, SearchRounded, PersonRemoveRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig } from '@store/workflowSelectors';
import {
  getProjectById, getTowersByProject,
} from '@store/workflowSelectors';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isAdmin } from '@store/authStore';
import ActivityFeed from '@shared/components/ActivityFeed/ActivityFeed';

const ROLE_COLORS: Record<string, { color: string; bg: string }> = {
  admin:          { color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  manager:        { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  field_engineer: { color: '#059669', bg: 'rgba(5,150,105,0.08)' },
};
const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', manager: 'Manager', field_engineer: 'Field Engineer',
};
const AVATAR_COLORS = ['#2563eb','#7c3aed','#059669','#d97706','#dc2626','#0891b2'];

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projects    = useWorkflowStore(s => s.projects);
  const towers      = useWorkflowStore(s => s.towers);
  const floors      = useWorkflowStore(s => s.floors);
  const rooms       = useWorkflowStore(s => s.rooms);
  const captures    = useWorkflowStore(s => s.captures);
  const users       = useWorkflowStore(s => s.users);
  const auditLogs   = useWorkflowStore(s => s.auditLogs);
  const addUserToProject    = useWorkflowStore(s => s.addUserToProject);
  const removeUserFromProject = useWorkflowStore(s => s.removeUserFromProject);
  const { user: currentUser } = useAuthStore();
  const hasAdminRole = isAdmin(currentUser);

  const project = getProjectById(projects, projectId ?? '');
  const [tab, setTab] = useState(0);

  // Add member dialog
  const [addOpen, setAddOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

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
  const teamMembers    = users.filter(u => u.projectIds?.includes(project.id));
  const nonMembers     = users.filter(u => !u.projectIds?.includes(project.id) &&
    (u.name.toLowerCase().includes(memberSearch.toLowerCase()) || u.email?.toLowerCase().includes(memberSearch.toLowerCase()))
  );
  const st = statusConfig.project[project.status];

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
          { icon: <DomainRounded sx={{ fontSize: 18 }} />,      label: 'Towers',   value: projectTowers.length,   color: '#2563eb' },
          { icon: <LayersRounded sx={{ fontSize: 18 }} />,      label: 'Floors',   value: projectFloors.length,   color: '#0891b2' },
          { icon: <MeetingRoomRounded sx={{ fontSize: 18 }} />, label: 'Rooms',    value: projectRooms.length,    color: '#7c3aed' },
          { icon: <CameraAltRounded sx={{ fontSize: 18 }} />,   label: 'Captures', value: projectCaptures.length, color: '#059669' },
          { icon: <PeopleRounded sx={{ fontSize: 18 }} />,      label: 'Team',     value: teamMembers.length,     color: '#64748b' },
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
        <Tab label="Team" />
        <Tab label="Activity" />
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
            {projectTowers.map(tower => (
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
            {projectTowers.length === 0 && (
              <Grid size={{ xs: 12 }}>
                <Box sx={{ textAlign: 'center', py: 6, color: colors.textMuted }}>
                  <DomainRounded sx={{ fontSize: 40, mb: 1, opacity: 0.3 }} />
                  <Typography sx={{ fontSize: '0.9rem' }}>No towers yet. Go to the Towers page to add one.</Typography>
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      )}

      {/* Team tab */}
      {tab === 1 && (
        <Box>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
            <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>
              {teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''} assigned to this project
            </Typography>
            {hasAdminRole && (
              <Box
                onClick={() => { setMemberSearch(''); setAddOpen(true); }}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', userSelect: 'none' }}
              >
                <AddRounded sx={{ fontSize: 16 }} /> Add Member
              </Box>
            )}
          </Box>

          {/* Member list */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {teamMembers.map((u, i) => {
              const rc = ROLE_COLORS[u.role] ?? ROLE_COLORS.field_engineer;
              const avatarColor = AVATAR_COLORS[i % AVATAR_COLORS.length];
              return (
                <Box key={u.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderRadius: '12px', backgroundColor: colors.card, boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
                  <Box sx={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff' }}>{u.name[0].toUpperCase()}</Typography>
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{u.name}</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{u.designation || u.email || '—'}</Typography>
                  </Box>
                  <Chip label={ROLE_LABELS[u.role] ?? u.role} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, color: rc.color, backgroundColor: rc.bg, borderRadius: '6px' }} />
                  {hasAdminRole && (
                    <Box
                      onClick={() => removeUserFromProject(u.id, project.id)}
                      title="Remove from project"
                      sx={{ width: 28, height: 28, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: colors.textSubdued, '&:hover': { backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444' }, transition: 'all 150ms' }}
                    >
                      <PersonRemoveRounded sx={{ fontSize: 16 }} />
                    </Box>
                  )}
                </Box>
              );
            })}
            {teamMembers.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 6, color: colors.textMuted }}>
                <PeopleRounded sx={{ fontSize: 40, mb: 1, opacity: 0.3 }} />
                <Typography sx={{ fontSize: '0.9rem' }}>No members assigned yet.</Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Activity tab */}
      {tab === 2 && (
        <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', p: 3 }}>
          <ActivityFeed logs={auditLogs.filter(l => l.projectId === projectId)} />
        </Box>
      )}

      {/* Add Member dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: '20px' } } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '1rem', pb: 1 }}>Add Member to Project</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            fullWidth
            placeholder="Search by name or email…"
            value={memberSearch}
            onChange={e => setMemberSearch(e.target.value)}
            size="small"
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: 18, color: colors.textMuted }} /></InputAdornment> } }}
            sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, maxHeight: 340, overflowY: 'auto' }}>
            {nonMembers.length === 0 && (
              <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, textAlign: 'center', py: 3 }}>
                {memberSearch ? 'No users match your search.' : 'All users are already members of this project.'}
              </Typography>
            )}
            {nonMembers.map((u, i) => {
              const rc = ROLE_COLORS[u.role] ?? ROLE_COLORS.field_engineer;
              const avatarColor = AVATAR_COLORS[i % AVATAR_COLORS.length];
              return (
                <Box
                  key={u.id}
                  onClick={() => { addUserToProject(u.id, project.id); }}
                  sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 1.75, borderRadius: '10px', cursor: 'pointer', '&:hover': { backgroundColor: colors.bg }, transition: 'background 140ms' }}
                >
                  <Box sx={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: '#fff' }}>{u.name[0].toUpperCase()}</Typography>
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{u.name}</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email || u.designation || '—'}</Typography>
                  </Box>
                  <Chip label={ROLE_LABELS[u.role] ?? u.role} size="small" sx={{ height: 20, fontSize: '0.625rem', fontWeight: 600, color: rc.color, backgroundColor: rc.bg, borderRadius: '5px' }} />
                  <Box sx={{ fontSize: '0.75rem', color: colors.primary, fontWeight: 600, whiteSpace: 'nowrap' }}>+ Add</Box>
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ borderRadius: '8px', textTransform: 'none', color: colors.textMuted }}>Done</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
