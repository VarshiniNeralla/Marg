import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Grid, TextField, MenuItem, Alert } from '@mui/material';
import { ArrowBackRounded, AddRounded } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';

const STATES = ['Telangana','Andhra Pradesh','Karnataka','Maharashtra','Tamil Nadu','Gujarat','Rajasthan','Delhi'];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'draft',  label: 'Draft' },
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

export default function NewProjectPage() {
  const navigate = useNavigate();
  const createProject = useWorkflowStore(s => s.createProject);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    name: '', client: 'My Home Constructions', address: '',
    city: 'Hyderabad', state: 'Telangana', description: '',
    status: 'active', startDate: '', endDate: '',
  });

  function handleChange(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const newId = createProject({
      name: form.name,
      location: form.address ? `${form.address}, ${form.city}` : `${form.city}, ${form.state}`,
      city: form.city,
      state: form.state,
      client: form.client,
      description: form.description,
      status: form.status as 'active' | 'draft',
      startDate: form.startDate,
      endDate: form.endDate,
    });
    setSaved(true);
    setTimeout(() => navigate(`/projects/${newId}`), 1200);
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 5 }}>
        <Box component={Link} to="/projects" sx={{ display: 'flex', alignItems: 'center', color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>
            New Project
          </Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Fill in the project details to get started</Typography>
        </Box>
      </Box>

      {saved && <Alert severity="success" sx={{ mb: 3, borderRadius: '10px' }}>Project created! Redirecting…</Alert>}

      <Box component="form" onSubmit={handleSubmit}>
        <Grid container spacing={3}>
          {/* Left column */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

              <SectionCard title="Basic Information">
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12 }}>
                    <TextField fullWidth label="Project Name" required value={form.name}
                      onChange={e => handleChange('name', e.target.value)} sx={fieldSx}
                      placeholder="e.g. My Home Vyoma Phase 2" />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField fullWidth label="Client Name" value={form.client}
                      onChange={e => handleChange('client', e.target.value)} sx={fieldSx} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField fullWidth label="Description" multiline rows={3} value={form.description}
                      onChange={e => handleChange('description', e.target.value)} sx={fieldSx}
                      placeholder="Brief description of the project scope…" />
                  </Grid>
                </Grid>
              </SectionCard>

              <SectionCard title="Location">
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12 }}>
                    <TextField fullWidth label="Address / Area" value={form.address}
                      onChange={e => handleChange('address', e.target.value)} sx={fieldSx}
                      placeholder="e.g. Kokapet Road, Nanakramguda" />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField fullWidth label="City" value={form.city}
                      onChange={e => handleChange('city', e.target.value)} sx={fieldSx} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField select fullWidth label="State" value={form.state}
                      onChange={e => handleChange('state', e.target.value)} sx={fieldSx}>
                      {STATES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </TextField>
                  </Grid>
                </Grid>
              </SectionCard>

              <SectionCard title="Timeline">
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField fullWidth label="Start Date" type="date" value={form.startDate}
                      onChange={e => handleChange('startDate', e.target.value)} sx={fieldSx}
                      slotProps={{ inputLabel: { shrink: true } }} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField fullWidth label="End Date" type="date" value={form.endDate}
                      onChange={e => handleChange('endDate', e.target.value)} sx={fieldSx}
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
                  onChange={e => handleChange('status', e.target.value)} sx={fieldSx}>
                  {STATUSES.map(s => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
                </TextField>
              </SectionCard>

              {/* Thumbnail placeholder */}
              <SectionCard title="Cover Image">
                <Box
                  sx={{
                    height: 140,
                    borderRadius: '10px',
                    border: '2px dashed #e5e7eb',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    cursor: 'pointer',
                    '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
                    transition: `all ${motion.durationFast}`,
                  }}
                >
                  <AddRounded sx={{ color: colors.textSubdued, fontSize: 28 }} />
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>Upload thumbnail</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>PNG, JPG up to 5MB</Typography>
                </Box>
              </SectionCard>

              {/* Submit */}
              <Box
                component="button"
                type="submit"
                sx={{
                  width: '100%',
                  height: '48px',
                  borderRadius: '10px',
                  background: colors.primaryGradient,
                  color: '#fff',
                  fontSize: '1rem',
                  fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(37,99,235,0.28)',
                  '&:hover': { opacity: 0.92 },
                  transition: `opacity ${motion.durationFast}`,
                }}
              >
                Create Project
              </Box>
              <Box
                component={Link}
                to="/projects"
                sx={{
                  display: 'block',
                  textAlign: 'center',
                  fontSize: '0.875rem',
                  color: colors.textMuted,
                  textDecoration: 'none',
                  '&:hover': { color: colors.textStrong },
                }}
              >
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
