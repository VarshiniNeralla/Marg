import React, { useState, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Box, Typography, Grid, TextField, MenuItem, Alert, InputAdornment, Tooltip, CircularProgress } from '@mui/material';
import { ArrowBackRounded, ApartmentRounded, LayersRounded, AddPhotoAlternateRounded, DeleteRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { getProjectById, getCapturesByProjectScope } from '@store/workflowSelectors';
import { uploadImage } from '@services/uploadService';

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
] as const;

type StructureKey = typeof STRUCTURE_FIELDS[number]['key'];

export default function EditProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projects = useWorkflowStore(s => s.projects);
  const towers = useWorkflowStore(s => s.towers);
  const floors = useWorkflowStore(s => s.floors);
  const rooms = useWorkflowStore(s => s.rooms);
  const captures = useWorkflowStore(s => s.captures);
  const capturePins = useWorkflowStore(s => s.capturePins);
  const updateProject = useWorkflowStore(s => s.updateProject);
  const project = getProjectById(projects, projectId ?? '');

  const projectTowerIds = new Set(towers.filter(t => t.projectId === projectId).map(t => t.id));
  const projectFloors = floors.filter(f => projectTowerIds.has(f.towerId));
  const projectFloorIds = new Set(projectFloors.map(f => f.id));
  const projectRooms = rooms.filter(r => projectFloorIds.has(r.floorId));
  const projectCaptures = getCapturesByProjectScope({ rooms, captures, capturePins }, projectId ?? '');

  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(() => ({
    name: project?.name ?? '',
    city: project?.city ?? '',
    state: project?.state ?? 'Telangana',
    status: project?.status ?? 'active',
    startDate: project?.startDate ?? '',
    endDate: project?.endDate ?? '',
    towers: projectTowerIds.size,
    floors: projectFloors.length,
  }));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(() => project?.thumbnail ?? null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => project?.thumbnail ?? null);
  const [thumbUploading, setThumbUploading] = useState(false);
  const [thumbError, setThumbError] = useState('');

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

  async function handleThumbnailPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbPreview(URL.createObjectURL(file));
    setThumbError('');
    setThumbUploading(true);
    try {
      const res = await uploadImage(file, 'thumbnails');
      setThumbUrl(res.url);
    } catch (err) {
      const message =
        (err as { message?: string })?.message
        || 'Upload failed. The thumbnail will not be saved.';
      setThumbError(message);
      setThumbUrl(project.thumbnail ?? null);
      setThumbPreview(project.thumbnail ?? null);
    } finally {
      setThumbUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeThumbnail() {
    setThumbPreview(null);
    setThumbUrl(null);
    setThumbError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !project || thumbUploading) return;

    updateProject(project.id, {
      name: form.name,
      city: form.city,
      state: form.state,
      location: `${form.city}, ${form.state}`,
      status: form.status as typeof project.status,
      startDate: form.startDate,
      endDate: form.endDate,
      towers: form.towers,
      floors: form.floors,
      thumbnail: thumbUrl,
      lastUpdated: 'Just now',
    });
    setSaved(true);
    setTimeout(() => navigate(`/projects/${project.id}`), 1000);
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      {/* Back to project */}
      <Box component={Link} to={`/projects/${project.id}`} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> {project.name}
        </Box>

      {/* Heading */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: colors.textStrong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>
          Edit Project
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          {project.name}
        </Typography>
      </Box>

      {saved && <Alert severity="success" sx={{ mb: 3, borderRadius: '10px' }}>Changes saved! Redirecting…</Alert>}

      <Box component="form" onSubmit={handleSubmit}>
        <Grid container spacing={{ xs: 2, md: 3 }}>
          {/* Left column */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, md: 2.5 } }}>

              <SectionCard title="Basic Information">
                <TextField fullWidth label="Project Name" required value={form.name}
                  onChange={e => setText('name', e.target.value)} sx={fieldSx} />
              </SectionCard>

              {/* ── Structure (editable counts) ──────────────────────────────── */}
              <SectionCard title="Structure">
                <Box sx={{
                  display: 'grid',
                  width: '100%',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: { xs: '10px', sm: '12px', md: '16px' },
                }}>
                  {STRUCTURE_FIELDS.map(f => (
                    <Tooltip key={f.key} title={f.helper} placement="top">
                      <TextField
                        fullWidth
                        type="number"
                        label={f.label}
                        value={form[f.key]}
                        onChange={e => setNum(f.key, e.target.value)}
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
                    </Tooltip>
                  ))}
                </Box>
              </SectionCard>

              <SectionCard title="Location & Timeline" dense>
                <Box sx={{
                  display: 'grid',
                  width: '100%',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: { xs: '10px', sm: '12px', md: '16px' },
                }}>
                  <TextField fullWidth size="small" label="City" value={form.city}
                    onChange={e => setText('city', e.target.value)} sx={fieldSx} />
                  <TextField select fullWidth size="small" label="State" value={form.state}
                    onChange={e => setText('state', e.target.value)} sx={fieldSx}>
                    {STATES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </TextField>
                  <TextField fullWidth size="small" label="Start Date" type="date" value={form.startDate}
                    onChange={e => setText('startDate', e.target.value)} sx={fieldSx}
                    slotProps={{ inputLabel: { shrink: true } }} />
                  <TextField fullWidth size="small" label="End Date" type="date" value={form.endDate}
                    onChange={e => setText('endDate', e.target.value)} sx={fieldSx}
                    slotProps={{ inputLabel: { shrink: true } }} />
                </Box>
              </SectionCard>
            </Box>
          </Grid>

          {/* Right column */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, md: 2.5 } }}>
              <SectionCard title="Project Settings" dense>
                <TextField select fullWidth size="small" label="Status" value={form.status}
                  onChange={e => setText('status', e.target.value)} sx={fieldSx}>
                  {STATUSES.map(s => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
                </TextField>
              </SectionCard>

              <SectionCard title="Cover Image">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleThumbnailPick}
                />

                {thumbPreview ? (
                  <Box sx={{ position: 'relative', borderRadius: '10px', overflow: 'hidden', height: 160 }}>
                    <Box
                      component="img"
                      src={thumbPreview}
                      alt="Cover preview"
                      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    {thumbUploading && (
                      <Box sx={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
                        <CircularProgress size={28} sx={{ color: '#fff' }} />
                        <Typography sx={{ fontSize: '0.75rem', color: '#fff' }}>Compressing & uploading…</Typography>
                      </Box>
                    )}
                    {!thumbUploading && thumbUrl && (
                      <Box sx={{ position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(22,163,74,0.85)', borderRadius: '6px', px: 1, py: 0.25 }}>
                        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: '#fff' }}>
                          {thumbUrl === project.thumbnail ? 'Current' : 'Uploaded ✓'}
                        </Typography>
                      </Box>
                    )}
                    <Box
                      onClick={removeThumbnail}
                      sx={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(220,38,38,0.8)' }, transition: 'background 150ms' }}
                    >
                      <DeleteRounded sx={{ fontSize: 15, color: '#fff' }} />
                    </Box>
                    {!thumbUploading && (
                      <Box
                        onClick={() => fileInputRef.current?.click()}
                        sx={{ position: 'absolute', bottom: 8, left: 8, right: 8, py: 0.625, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.75rem', fontWeight: 600, textAlign: 'center', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' } }}
                      >
                        Replace photo
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Box
                    onClick={() => fileInputRef.current?.click()}
                    sx={{
                      height: 140, borderRadius: '10px', border: `2px dashed ${colors.border}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                      cursor: 'pointer',
                      '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
                      transition: `all ${motion.durationFast}`,
                    }}
                  >
                    <AddPhotoAlternateRounded sx={{ color: colors.textSubdued, fontSize: 32 }} />
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textMuted }}>Click to upload thumbnail</Typography>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>PNG, JPG, WebP · large photos are auto-compressed</Typography>
                  </Box>
                )}

                {thumbError && (
                  <Typography sx={{ fontSize: '0.75rem', color: '#dc2626', mt: 1 }}>{thumbError}</Typography>
                )}
                {thumbUploading && (
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 1 }}>Wait for upload to finish before saving.</Typography>
                )}
              </SectionCard>

              {/* Live summary */}
              <SectionCard title="Summary" dense>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.875 }}>
                  {[
                    ['Towers', form.towers],
                    ['Floors', form.floors],
                    ['Captures', projectCaptures.length],
                  ].map(([label, value]) => (
                    <Box key={label as string} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{label}</Typography>
                      <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong }}>{value}</Typography>
                    </Box>
                  ))}
                </Box>
              </SectionCard>

              <Box component="button" type="submit" disabled={thumbUploading} sx={{
                width: '100%', height: '38px', borderRadius: '10px',
                background: colors.primaryGradient, color: '#fff',
                fontSize: '0.875rem', fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontWeight: 600,
                border: 'none', cursor: thumbUploading ? 'not-allowed' : 'pointer',
                opacity: thumbUploading ? 0.65 : 1,
                boxShadow: '0 4px 14px rgba(37,99,235,0.28)',
                '&:hover': { opacity: thumbUploading ? 0.65 : 0.92 }, transition: `opacity ${motion.durationFast}`,
              }}>
                {thumbUploading ? 'Uploading…' : 'Save Changes'}
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

function SectionCard({ title, children, dense = false }: { title: string; children: React.ReactNode; dense?: boolean }) {
  return (
    <Box sx={{ borderRadius: { xs: '12px', md: '16px' }, backgroundColor: colors.card, p: dense ? { xs: 1.5, md: 1.75 } : { xs: 1.75, md: 2.5 }, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', mb: dense ? 1 : { xs: 1.5, md: 2 } }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
