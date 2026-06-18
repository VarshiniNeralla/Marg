import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, LinearProgress, Select, MenuItem, Grid } from '@mui/material';
import { CloudUploadRounded, CheckCircleRounded, ArrowBackRounded, CameraAltRounded, CloseRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { uploadCaptureFiles } from '@/services/uploadService';

const statuses = [
  { key: 'queued',     label: 'Queued',     color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
  { key: 'uploading',  label: 'Uploading',  color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  { key: 'processing', label: 'Processing', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  { key: 'converting', label: 'Converting', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  { key: 'ready',      label: 'Ready',      color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
];

const RAW_EXTENSIONS = ['.dng', '.insp', '.insv'];
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', ...RAW_EXTENSIONS];

function getFileExtension(name: string) {
  return name.slice(name.lastIndexOf('.')).toLowerCase();
}

function isRawFormat(name: string) {
  return RAW_EXTENSIONS.includes(getFileExtension(name));
}

function getFileTypeBadge(name: string) {
  const ext = getFileExtension(name);
  const map: Record<string, { label: string; color: string; bg: string }> = {
    '.jpg':  { label: 'JPEG', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
    '.jpeg': { label: 'JPEG', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
    '.png':  { label: 'PNG',  color: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
    '.dng':  { label: 'RAW',  color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
    '.insp': { label: 'INSP', color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
    '.insv': { label: 'INSV', color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
  };
  return map[ext] ?? { label: ext.toUpperCase().replace('.', ''), color: '#64748b', bg: 'rgba(100,116,139,0.1)' };
}

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '10px', fontSize: '0.9375rem',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: 1.5 },
  },
};

interface FileState { file: File; id: string; status: string; progress: number; preview: string | null; }

export default function CaptureUploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const projects = useWorkflowStore(s => s.projects);
  const allTowers = useWorkflowStore(s => s.towers);
  const allFloors = useWorkflowStore(s => s.floors);
  const allFlats = useWorkflowStore(s => s.flats);
  const rooms = useWorkflowStore(s => s.rooms);
  const createRoom = useWorkflowStore(s => s.createRoom);
  const uploadCapture = useWorkflowStore(s => s.uploadCapture);
  const [files, setFiles] = useState<FileState[]>([]);
  const [dragging, setDragging] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [towerId, setTowerId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [flatId, setFlatId] = useState('');
  const [roomName, setRoomName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const towers = allTowers.filter(t => t.projectId === projectId);
  const floors = allFloors.filter(f => f.towerId === towerId);
  const flats = allFlats.filter(f => f.floorId === floorId);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);

  useEffect(() => {
    if (!towerId && towers[0]) setTowerId(towers[0].id);
  }, [towerId, towers]);

  useEffect(() => {
    if (!flatId && flats[0]) setFlatId(flats[0].id);
  }, [flatId, flats]);

  function addFiles(fileList: FileList) {
    const newFiles: FileState[] = Array.from(fileList)
      .filter(f => {
        const ext = getFileExtension(f.name);
        return f.type.startsWith('image/') || ACCEPTED_EXTENSIONS.includes(ext);
      })
      .map(f => ({
        file: f,
        id: `${f.name}-${f.size}`,
        status: 'queued',
        progress: 0,
        preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      }));
    setFiles(prev => [...prev, ...newFiles]);
  }

  function removeFile(id: string) {
    setFiles(prev => prev.filter(f => f.id !== id));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  async function handleUpload() {
    if (!files.length || !flatId || !roomName || isUploading) return;
    setUploadError('');
    setIsUploading(true);
    setFiles(prev => prev.map(f => ({ ...f, status: 'uploading', progress: 0 })));

    try {
      const uploadResult = await uploadCaptureFiles(files.map(f => f.file), percent => {
        setOverallProgress(percent);
        setFiles(prev => prev.map(f => ({ ...f, status: percent >= 100 ? 'processing' : 'uploading', progress: percent })));
      });

      const existingRoom = rooms.find(r => r.flatId === flatId && r.name.toLowerCase() === roomName.toLowerCase());
      const roomId = existingRoom?.id ?? createRoom(flatId, roomName, 'living');
      uploadCapture(roomId, uploadResult.count || files.length, uploadResult.files);
      setFiles(prev => prev.map(f => ({ ...f, status: 'ready', progress: 100 })));
      setOverallProgress(100);
      setSubmitted(true);
    } catch (error) {
      console.error('[capture-upload]', error);
      setUploadError('Upload failed. Please check your connection and try again.');
      setFiles(prev => prev.map(f => ({ ...f, status: 'queued', progress: 0 })));
    } finally {
      setIsUploading(false);
    }
  }

  if (submitted) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', textAlign: 'center', py: 8 }}>
        <CheckCircleRounded sx={{ fontSize: 64, color: '#16a34a', mb: 2 }} />
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, mb: 1 }}>Upload Complete</Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, mb: 4 }}>{files.length} files uploaded. Capture is now pending review.</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center' }}>
          <Box component={Link} to="/captures" sx={{ px: 2.5, py: 1, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
            View Captures
          </Box>
          <Box onClick={() => { setFiles([]); setSubmitted(false); setOverallProgress(0); }} sx={{ px: 2.5, py: 1, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
            Upload More
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <Box component={Link} to="/captures" sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em' }}>Upload Capture</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>Upload 360° panoramic images for review</Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Left: drop zone + file list */}
        <Grid size={{ xs: 12, md: 7 }}>
          {/* Drop zone */}
          <Box
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            sx={{ borderRadius: '20px', border: `2px dashed ${dragging ? colors.primary : colors.border}`, backgroundColor: dragging ? colors.primarySoft : colors.card, p: 4, textAlign: 'center', cursor: 'pointer', mb: 3, transition: `all ${motion.durationFast}`, '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft } }}
          >
            <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.dng,.insp,.insv,image/*" multiple style={{ display: 'none' }} onChange={e => e.target.files && addFiles(e.target.files)} />
            <CloudUploadRounded sx={{ fontSize: 40, color: dragging ? colors.primary : colors.textSubdued, mb: 1 }} />
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>Drop panoramic images here</Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1 }}>or click to browse</Typography>
            <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'center', flexWrap: 'wrap' }}>
              {[{ label: 'JPG', c: '#2563eb' }, { label: 'PNG', c: '#0891b2' }, { label: 'DNG', c: '#7c3aed' }, { label: 'INSP', c: '#d97706' }, { label: 'INSV', c: '#d97706' }].map(b => (
                <Box key={b.label} sx={{ px: 0.875, py: 0.25, borderRadius: '4px', backgroundColor: `${b.c}15`, fontSize: '0.625rem', fontWeight: 700, color: b.c }}>{b.label}</Box>
              ))}
            </Box>
          </Box>

          {/* File list */}
          {files.length > 0 && (
            <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
              <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{files.length} file{files.length !== 1 ? 's' : ''} selected</Typography>
                {overallProgress > 0 && (
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.primary }}>{overallProgress}%</Typography>
                )}
              </Box>
              {overallProgress > 0 && (
                <LinearProgress variant="determinate" value={overallProgress} sx={{ height: 3, backgroundColor: colors.primarySoft, '& .MuiLinearProgress-bar': { background: colors.primaryGradient } }} />
              )}
              <Box sx={{ maxHeight: 340, overflowY: 'auto' }}>
                {files.map(f => {
                  const st = statuses.find(s => s.key === f.status) ?? statuses[0];
                  return (
                    <Box key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 1.5, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
                      {f.preview ? (
                        <Box sx={{ width: 40, height: 40, borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                          <img src={f.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </Box>
                      ) : (
                        <Box sx={{ width: 40, height: 40, borderRadius: '8px', backgroundColor: colors.bgDeep, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <CameraAltRounded sx={{ fontSize: 18, color: colors.textSubdued }} />
                        </Box>
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                          <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong, flex: 1, minWidth: 0 }}>{f.file.name}</Typography>
                          {(() => { const badge = getFileTypeBadge(f.file.name); return <Box sx={{ px: 0.875, py: 0.125, borderRadius: '4px', fontSize: '0.5625rem', fontWeight: 700, color: badge.color, backgroundColor: badge.bg, flexShrink: 0 }}>{badge.label}</Box>; })()}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0 }}>
                          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>{(f.file.size / 1024 / 1024).toFixed(1)} MB</Typography>
                          <Box sx={{ px: 1, py: 0.125, borderRadius: '4px', fontSize: '0.625rem', fontWeight: 700, color: st.color, backgroundColor: st.bg }}>{st.label}</Box>
                          {isRawFormat(f.file.name) && f.status === 'queued' && (
                            <Box sx={{ px: 1, py: 0.125, borderRadius: '4px', fontSize: '0.5625rem', fontWeight: 600, color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.08)' }}>Pipeline required</Box>
                          )}
                        </Box>
                        {f.status === 'uploading' && (
                          <LinearProgress variant="determinate" value={f.progress} sx={{ mt: 0.5, height: 2, borderRadius: '99px', backgroundColor: colors.primarySoft, '& .MuiLinearProgress-bar': { backgroundColor: colors.primary } }} />
                        )}
                      </Box>
                      {f.status === 'queued' && (
                        <Box onClick={e => { e.stopPropagation(); removeFile(f.id); }} sx={{ color: colors.textSubdued, cursor: 'pointer', display: 'flex', '&:hover': { color: '#dc2626' } }}>
                          <CloseRounded sx={{ fontSize: 16 }} />
                        </Box>
                      )}
                      {f.status === 'ready' && <CheckCircleRounded sx={{ fontSize: 16, color: '#16a34a' }} />}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </Grid>

        {/* Right: metadata form */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, p: 3, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 2.5 }}>Capture Details</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Project */}
              <Box>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Project *</Typography>
                <Select fullWidth size="small" value={projectId} onChange={e => { setProjectId(e.target.value); setTowerId(''); setFloorId(''); setFlatId(''); }} sx={{ ...fieldSx['& .MuiOutlinedInput-root'], borderRadius: '10px', fontSize: '0.9375rem' }}>
                  {projects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                </Select>
              </Box>
              {/* Tower */}
              <Box>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Tower *</Typography>
                <Select fullWidth size="small" value={towerId} onChange={e => { setTowerId(e.target.value); setFloorId(''); setFlatId(''); }} sx={{ borderRadius: '10px', fontSize: '0.9375rem' }}>
                  {towers.map(t => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                </Select>
              </Box>
              {/* Floor */}
              <Box>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Floor *</Typography>
                <Select fullWidth size="small" value={floorId} onChange={e => { setFloorId(e.target.value); setFlatId(''); }} sx={{ borderRadius: '10px', fontSize: '0.9375rem' }} displayEmpty>
                  <MenuItem value=""><em>Select floor</em></MenuItem>
                  {floors.map(f => <MenuItem key={f.id} value={f.id}>{f.label}</MenuItem>)}
                </Select>
              </Box>
              {/* Flat */}
              <Box>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Flat / Unit *</Typography>
                <Select fullWidth size="small" value={flatId} onChange={e => setFlatId(e.target.value)} sx={{ borderRadius: '10px', fontSize: '0.9375rem' }} displayEmpty>
                  <MenuItem value=""><em>Select flat</em></MenuItem>
                  {flats.map(f => <MenuItem key={f.id} value={f.id}>{f.number} ({f.type})</MenuItem>)}
                </Select>
              </Box>
              {/* Room name */}
              <Box>
                <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Room Name *</Typography>
                <Box component="input" value={roomName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoomName(e.target.value)} placeholder="e.g. Living Room 1401"
                  sx={{ width: '100%', height: 40, px: 1.5, borderRadius: '10px', border: `1px solid #e5e7eb`, fontSize: '0.9375rem', color: colors.textStrong, backgroundColor: '#fff', outline: 'none', boxSizing: 'border-box', '&:focus': { borderColor: colors.primary, boxShadow: `0 0 0 3px ${colors.primarySoft}` } }}
                />
              </Box>
            </Box>

            {/* Upload button */}
            {uploadError && <Typography sx={{ mt: 2, fontSize: '0.8125rem', color: colors.danger }}>{uploadError}</Typography>}
            <Box onClick={handleUpload} sx={{ mt: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 1.25, borderRadius: '10px', background: files.length && roomName && flatId && !isUploading ? colors.primaryGradient : colors.bgDeep, color: files.length && roomName && flatId && !isUploading ? '#fff' : colors.textSubdued, fontSize: '0.9375rem', fontWeight: 600, cursor: files.length && roomName && flatId && !isUploading ? 'pointer' : 'not-allowed', boxShadow: files.length && roomName && flatId && !isUploading ? '0 4px 14px rgba(37,99,235,0.28)' : 'none', transition: `all ${motion.durationFast}` }}>
              <CloudUploadRounded sx={{ fontSize: 18 }} />
              {isUploading ? 'Uploading...' : `Upload ${files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'Capture'}`}
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
