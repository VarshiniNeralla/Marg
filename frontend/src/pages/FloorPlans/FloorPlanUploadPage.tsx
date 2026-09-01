import React, { useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Box, Typography, LinearProgress, Button } from '@mui/material';
import { UploadFileRounded, CheckCircleRounded, ArrowBackRounded, InsertDriveFileRounded, EditLocationAltRounded, ContentCopyRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { uploadFloorPlanFiles } from '@/services/uploadService';

const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

const P = {
  border: '#e4e7ec',
  muted:  '#6b7280',
  strong: '#111827',
  blue:   '#2563eb',
  blueSoft: 'rgba(37,99,235,0.08)',
};
const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

export default function FloorPlanUploadPage() {
  const { projectId, towerId, floorId } = useParams<{ projectId: string; towerId: string; floorId: string }>();
  const navigate = useNavigate();
  const project = useWorkflowStore(s => s.projects.find(p => p.id === projectId));
  const tower = useWorkflowStore(s => s.towers.find(t => t.id === towerId));
  const floor = useWorkflowStore(s => s.floors.find(f => f.id === floorId));
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const allPins = useWorkflowStore(s => s.capturePins);
  const towers = useWorkflowStore(s => s.towers);
  const uploadFloorPlan = useWorkflowStore(s => s.uploadFloorPlan);
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [wasReplace, setWasReplace] = useState(false);
  const [canCopyFromSibling, setCanCopyFromSibling] = useState(false);

  const backUrl = `/floor-plans?project=${projectId ?? ''}&tower=${towerId ?? ''}`;
  const viewerUrl = `/floor-plans/${projectId}/${towerId}/${floorId}`;

  const existingPlanForFloor = floorPlans.some(
    fp => fp.towerId === towerId && fp.floorId === floorId,
  );
  // Any other floor in this project with labeled Flat · Room points can be imported.
  const projectTowerIds = new Set(
    towers.filter(t => t.projectId === projectId).map(t => t.id),
  );
  const siblingHasLabeledPins = allPins.some(p => {
    if (!(p.flatName && p.roomName)) return false;
    if (p.floorId === floorId) return false;
    if (p.towerId && projectTowerIds.has(p.towerId)) return true;
    const plan = floorPlans.find(fp => fp.id === p.floorPlanId);
    return !!plan && projectTowerIds.has(plan.towerId) && plan.floorId !== floorId;
  });

  if (!project || !tower || !floor) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', p: 1 }}>
        <Box component={Link} to={backUrl} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: T,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Floor Plans
        </Box>
        <Typography sx={{ color: colors.textMuted }}>Floor not found.</Typography>
      </Box>
    );
  }

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

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setError('');
    const replacing = existingPlanForFloor;
    // Offer import whenever another annotated floor exists in the project —
    // including after a plan replace (coords may need remapping, but import is still useful).
    const offerCopy = siblingHasLabeledPins;
    try {
      const result = await uploadFloorPlanFiles([file], setProgress, `fp-${towerId}-${floorId}`);
      const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
      uploadFloorPlan({
        projectId: projectId ?? '',
        towerId: towerId ?? '',
        floorId: floorId ?? '',
        floorLabel: floor?.label ?? '',
        fileType: ext as 'pdf' | 'png' | 'jpg',
        fileName: file.name,
        fileSizeMb: +(file.size / 1024 / 1024).toFixed(1),
        rooms: [],
        mediaAssets: result.files,
      });
      setWasReplace(replacing);
      setCanCopyFromSibling(offerCopy);
      setUploading(false);
      setDone(true);
    } catch (err) {
      console.error('[floor-plan-upload]', err);
      setUploading(false);
      setError('Upload failed. Please check your connection and try again.');
    }
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6, width: '100%', minWidth: 0 }}>
      <Box component={Link} to={backUrl} sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${P.border}`, color: P.muted,
        fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
        transition: T,
        '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
      }}>
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Floor Plans
      </Box>

      <Box sx={{ mb: 4 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>
          Upload Floor Plan
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
          {project.name} · {tower.name} · {floor.label}
        </Typography>
        {existingPlanForFloor && !done && (
          <Typography sx={{ mt: 1.25, fontSize: '0.8125rem', color: '#b45309', fontWeight: 600 }}>
            Replacing the drawing requires re-annotating capture points — previous X/Y positions may not match the new image.
          </Typography>
        )}
        {!existingPlanForFloor && siblingHasLabeledPins && !done && (
          <Typography sx={{ mt: 1.25, fontSize: '0.8125rem', color: P.muted }}>
            After upload you can copy labeled capture points from another floor in this tower.
          </Typography>
        )}
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
            <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 3, maxWidth: 360, mx: 'auto' }}>
              {wasReplace
                ? 'Re-annotate labeled capture points on the new drawing before field capture.'
                : canCopyFromSibling
                  ? 'Annotate points on this plan, or import annotations (coordinates + names) from another floor in this project.'
                  : 'Next: annotate labeled capture points (Flat + Room) on the plan.'}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, alignItems: 'center' }}>
              <Button
                variant="contained"
                startIcon={<EditLocationAltRounded />}
                onClick={() => navigate(`${viewerUrl}?annotate=1`)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', px: 2.5 }}
              >
                Annotate capture points
              </Button>
              {canCopyFromSibling && (
                <Button
                  variant="outlined"
                  startIcon={<ContentCopyRounded />}
                  onClick={() => navigate(`${viewerUrl}?annotate=1&copy=1`)}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '10px', px: 2.5 }}
                >
                  Import annotations
                </Button>
              )}
              <Button
                variant="text"
                onClick={() => navigate(viewerUrl)}
                sx={{ textTransform: 'none', color: P.muted }}
              >
                Open floor plan
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
