import React, { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Box, Typography, Grid, TextField, MenuItem, Alert, InputAdornment } from '@mui/material';
import { ArrowBackRounded, ApartmentRounded, LayersRounded, MeetingRoomRounded, HomeWorkRounded, GridViewRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { getProjectById } from '@store/workflowSelectors';

const STATES = ['Telangana', 'Andhra Pradesh', 'Karnataka', 'Maharashtra', 'Tamil Nadu', 'Gujarat', 'Rajasthan', 'Delhi'];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'review', label: 'In Review' },
  { value: 'done', label: 'Completed' },
  { value: 'draft', label: 'Draft' },
];

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px',
    backgroundColor: '#fff',
    fontSize: '0.9375rem',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#d1d5db' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: '1.5px' },
    '&.Mui-focused': { boxShadow: `0 0 0 3px ${colors.primaryRing}` },
  },
  '& .MuiInputLabel-root.Mui-focused': { color: colors.primary },
};

// Structure fields the user can edit, with icons.
const STRUCTURE_FIELDS = [
  { key: 'towers', label: 'Towers', icon: <ApartmentRounded sx={{ fontSize: 17 }} />, helper: 'Number of towers' },
  { key: 'floors', label: 'Floors', icon: <LayersRounded sx={{ fontSize: 17 }} />, helper: 'Total floors across towers' },
  { key: 'flats', label: 'Flats / floor', icon: <HomeWorkRounded sx={{ fontSize: 17 }} />, helper: 'Units per floor' },
  { key: 'rooms', label: 'Rooms', icon: <MeetingRoomRounded sx={{ fontSize: 17 }} />, helper: 'Rooms captured so far' },
  { key: 'totalRooms', label: 'Total rooms', icon: <GridViewRounded sx={{ fontSize: 17 }} />, helper: 'Planned room count' },
] as const;

type StructureKey = typeof STRUCTURE_FIELDS[number]['key'];

export default function EditProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projects = useWorkflowStore(s => s.projects);
  const updateProject = useWorkflowStore(s => s.updateProject);
  const project = getProjectById(projects, projectId ?? '');

  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(() => ({
    name: project?.name ?? '',
    client: project?.client ?? '',
    description: project?.description ?? '',
    city: project?.city ?? '',
    state: project?.state ?? 'Telangana',
    status: project?.status ?? 'active',
    startDate: project?.startDate ?? '',
    endDate: project?.endDate ?? '',
    towers: project?.towers ?? 0,
    floors: project?.floors ?? 0,
    flats: project?.flats ?? 0,
    rooms: project?.rooms ?? 0,
    totalRooms: project?.totalRooms ?? 0,
  }));

  if (!project) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2 }}>
        <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: colors.borderLight }}>404</Typography>
        <Typography sx={{ color: colors.textMuted }}>Project not found</Typography>
        <Box component={Link} to="/projects" sx={{ color: colors.primary, textDecoration: 'none', fontSize: '0.875rem' }}>← All projects</Box>
      </Box>
    );
  }

  function setText(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }
  function setNum(field: StructureKey, value: string) {
    const n = Math.max(0, parseInt(value, 10) || 0);
    setForm(f => ({ ...f, [field]: n }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !project) return;

    const progress = form.totalRooms > 0 ? Math.min(100, Math.round((form.rooms / form.totalRooms) * 100)) : project.progress;
    updateProject(project.id, {
      name: form.name,
      client: form.client,
      description: form.description,
      city: form.city,
      state: form.state,
      location: `${form.city}, ${form.state}`,
      status: form.status as typeof project.status,
      startDate: form.startDate,
      endDate: form.endDate,
      towers: form.towers,
      floors: form.floors,
      flats: form.flats,
      rooms: form.rooms,
      totalRooms: form.totalRooms,
      progress,
      lastUpdated: 'Just now',
    });
    setSaved(true);
    setTimeout(() => navigate(`/projects/${project.id}`), 1000);
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 5 }}>
        <Box component={Link} to={`/projects/${project.id}`} sx={{ display: 'flex', alignItems: 'center', color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>
            Edit Project
          </Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>{project.name}</Typography>
        </Box>
      </Box>

      {saved && <Alert severity="success" sx={{ mb: 3, borderRadius: '10px' }}>Changes saved! Redirecting…</Alert>}

      <Box component="form" onSubmit={handleSubmit}>
        <Grid container spacing={3}>
          {/* Left column */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

              <SectionCard title="Basic Information">
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12 }}>
                    <TextField fullWidth label="Project Name" required value={form.name}
                      onChange={e => setText('name', e.target.value)} sx={fieldSx} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField fullWidth label="Client Name" value={form.client}
                      onChange={e => setText('client', e.target.value)} sx={fieldSx} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField fullWidth label="Description" multiline rows={3} value={form.description}
                      onChange={e => setText('description', e.target.value)} sx={fieldSx} />
                  </Grid>
                </Grid>
              </SectionCard>

              {/* ── Structure (editable counts) ──────────────────────────────── */}
              <SectionCard title="Structure">
                <Grid container spacing={2}>
                  {STRUCTURE_FIELDS.map(f => (
                    <Grid key={f.key} size={{ xs: 6, sm: 4 }}>
                      <TextField
                        fullWidth
                        type="number"
                        label={f.label}
                        value={form[f.key]}
                        onChange={e => setNum(f.key, e.target.value)}
                        helperText={f.helper}
                        sx={fieldSx}
                        slotProps={{
                          htmlInput: { min: 0 },
                          input: {
                            startAdornment: (
                              <InputAdornment position="start" sx={{ color: colors.textSubdued }}>
                                {f.icon}
                              </InputAdornment>
                            ),
                          },
                        }}
                      />
                    </Grid>
                  ))}
                </Grid>
                <Box sx={{ mt: 1, p: 1.5, borderRadius: '10px', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>
                    Mapping progress recalculates from <b>{form.rooms}</b> of <b>{form.totalRooms}</b> rooms ·
                  </Typography>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.primary }}>
                    {form.totalRooms > 0 ? Math.min(100, Math.round((form.rooms / form.totalRooms) * 100)) : project.progress}%
                  </Typography>
                </Box>
              </SectionCard>

              <SectionCard title="Location & Timeline">
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField fullWidth label="City" value={form.city}
                      onChange={e => setText('city', e.target.value)} sx={fieldSx} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField select fullWidth label="State" value={form.state}
                      onChange={e => setText('state', e.target.value)} sx={fieldSx}>
                      {STATES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField fullWidth label="Start Date" type="date" value={form.startDate}
                      onChange={e => setText('startDate', e.target.value)} sx={fieldSx}
                      slotProps={{ inputLabel: { shrink: true } }} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField fullWidth label="End Date" type="date" value={form.endDate}
                      onChange={e => setText('endDate', e.target.value)} sx={fieldSx}
                      slotProps={{ inputLabel: { shrink: true } }} />
                  </Grid>
                </Grid>
              </SectionCard>
            </Box>
          </Grid>

          {/* Right column */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <SectionCard title="Project Settings">
                <TextField select fullWidth label="Status" value={form.status}
                  onChange={e => setText('status', e.target.value)} sx={fieldSx}>
                  {STATUSES.map(s => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
                </TextField>
              </SectionCard>

              {/* Live summary */}
              <SectionCard title="Summary">
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                  {[
                    ['Towers', form.towers],
                    ['Floors', form.floors],
                    ['Flats / floor', form.flats],
                    ['Rooms captured', form.rooms],
                    ['Total rooms', form.totalRooms],
                  ].map(([label, value]) => (
                    <Box key={label as string} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{label}</Typography>
                      <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong }}>{value}</Typography>
                    </Box>
                  ))}
                </Box>
              </SectionCard>

              <Box component="button" type="submit" sx={{
                width: '100%', height: '48px', borderRadius: '10px',
                background: colors.primaryGradient, color: '#fff',
                fontSize: '1rem', fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontWeight: 600,
                border: 'none', cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)',
                '&:hover': { opacity: 0.92 }, transition: `opacity ${motion.durationFast}`,
              }}>
                Save Changes
              </Box>
              <Box component={Link} to={`/projects/${project.id}`} sx={{
                display: 'block', textAlign: 'center', fontSize: '0.875rem', color: colors.textMuted,
                textDecoration: 'none', '&:hover': { color: colors.textStrong },
              }}>
                Cancel
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, p: 2.5, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
