import React, { useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Box, Typography, LinearProgress } from '@mui/material';
import { UploadFileRounded, CheckCircleRounded, ArrowBackRounded, InsertDriveFileRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { getProjectById, mockTowers, getFloors, mockFloorPlans } from '@/data/mockData';

const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

export default function FloorPlanUploadPage() {
  const { projectId, towerId, floorId } = useParams<{ projectId: string; towerId: string; floorId: string }>();
  const navigate = useNavigate();
  const project = getProjectById(projectId ?? '');
  const tower = mockTowers.find(t => t.id === towerId);
  const floor = getFloors(towerId ?? '').find(f => f.id === floorId);
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!project || !tower || !floor) return <Box sx={{ p: 4, color: colors.textMuted }}>Floor not found.</Box>;

  function handleFile(f: File) {
    if (!ACCEPTED.includes(f.type)) { setError('Only PDF, PNG, JPG files are accepted.'); return; }
    if (f.size > 50 * 1024 * 1024) { setError('File must be under 50 MB.'); return; }
    setError('');
    setFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }

  function handleUpload() {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setUploading(false);
          setDone(true);
          // Push to mock store
          const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
          mockFloorPlans.push({
            id: `fp-${towerId}-${floorId}-new`,
            projectId: projectId ?? '',
            towerId: towerId ?? '',
            floorId: floorId ?? '',
            floorLabel: floor?.label ?? '',
            uploadedBy: 'Ravi Kumar',
            uploadedAt: 'Just now',
            fileType: ext as 'pdf' | 'png' | 'jpg',
            fileName: file.name,
            fileSizeMb: +(file.size / 1024 / 1024).toFixed(1),
            rooms: [],
          });
          setTimeout(() => navigate(`/floor-plans/${projectId}/${towerId}/${floorId}`), 1200);
          return 100;
        }
        return p + 8;
      });
    }, 150);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <Box component={Link} to={`/floor-plans/${projectId}/${towerId}/${floorId}`} sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 0.25 }}>{project.name} · {tower.name} · {floor.label}</Typography>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em' }}>Upload Floor Plan</Typography>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 600, mx: 'auto' }}>
        {/* Drop zone */}
        {!done && (
          <>
            <Box
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              sx={{
                borderRadius: '20px', border: `2px dashed ${dragging ? colors.primary : file ? '#16a34a' : colors.border}`,
                backgroundColor: dragging ? colors.primarySoft : file ? 'rgba(22,163,74,0.05)' : colors.card,
                p: 6, textAlign: 'center', cursor: 'pointer', transition: `all ${motion.durationFast}`,
                '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
              }}
            >
              <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              {file ? (
                <>
                  <InsertDriveFileRounded sx={{ fontSize: 48, color: '#16a34a', mb: 1.5 }} />
                  <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: colors.textStrong, mb: 0.5 }}>{file.name}</Typography>
                  <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>{(file.size / 1024 / 1024).toFixed(1)} MB · {file.type.split('/')[1].toUpperCase()}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.primary, mt: 1, fontWeight: 500 }}>Click to replace file</Typography>
                </>
              ) : (
                <>
                  <UploadFileRounded sx={{ fontSize: 48, color: colors.textSubdued, mb: 1.5 }} />
                  <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: colors.textStrong, mb: 0.5 }}>Drop your floor plan here</Typography>
                  <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 1.5 }}>or click to browse</Typography>
                  <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {['PDF', 'PNG', 'JPG'].map(t => (
                      <Box key={t} sx={{ px: 1.5, py: 0.25, borderRadius: '6px', backgroundColor: colors.bgDeep, fontSize: '0.75rem', fontWeight: 600, color: colors.textSecondary }}>{t}</Box>
                    ))}
                  </Box>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued, mt: 1 }}>Max 50 MB</Typography>
                </>
              )}
            </Box>

            {error && (
              <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', backgroundColor: 'rgba(220,38,38,0.08)', color: '#dc2626', fontSize: '0.875rem', fontWeight: 500 }}>{error}</Box>
            )}

            {uploading && (
              <Box sx={{ mt: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography sx={{ fontSize: '0.875rem', color: colors.textSecondary }}>Uploading…</Typography>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.primary }}>{progress}%</Typography>
                </Box>
                <LinearProgress variant="determinate" value={progress} sx={{ borderRadius: '99px', height: 6, backgroundColor: colors.primarySoft, '& .MuiLinearProgress-bar': { background: colors.primaryGradient, borderRadius: '99px' } }} />
              </Box>
            )}

            {file && !uploading && (
              <Box sx={{ mt: 3, display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
                <Box onClick={() => setFile(null)} sx={{ px: 2.5, py: 1, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', '&:hover': { borderColor: colors.border, color: colors.textStrong } }}>
                  Remove
                </Box>
                <Box onClick={handleUpload} sx={{ px: 2.5, py: 1, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
                  Upload Floor Plan
                </Box>
              </Box>
            )}
          </>
        )}

        {done && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CheckCircleRounded sx={{ fontSize: 56, color: '#16a34a', mb: 2 }} />
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: colors.textStrong, mb: 0.5 }}>Upload Complete</Typography>
            <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>Redirecting to floor plan viewer…</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
