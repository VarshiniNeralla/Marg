import React, { useRef, useState } from 'react';
import { Dialog, Box, Typography, LinearProgress, IconButton } from '@mui/material';
import {
  CloudUploadRounded, CheckCircleRounded, CloseRounded, CameraAltRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';

const RAW_EXTENSIONS = ['.dng', '.insp', '.insv'];
const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', ...RAW_EXTENSIONS];

function ext(name: string) {
  return name.slice(name.lastIndexOf('.')).toLowerCase();
}

interface PinUploadDialogProps {
  open: boolean;
  pinLabel: string;
  /** Receives the selected files and performs the upload. Resolve to close. */
  onUpload: (files: File[]) => Promise<void>;
  onClose: () => void;
}

/**
 * Desktop counterpart to CameraCaptureDialog. A lightweight drag-drop / file
 * picker that hands the chosen panoramic files to onUpload, which routes them
 * through the existing uploadCaptureFiles → uploadCapture pipeline. No separate
 * upload system — identical contract to the camera flow (select → onUpload).
 */
export default function PinUploadDialog({ open, pinLabel, onUpload, onClose }: PinUploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setFiles([]); setProgress(0); setUploading(false); setError(''); setDragging(false);
  }

  function close() {
    if (uploading) return;
    reset();
    onClose();
  }

  function addFiles(list: FileList) {
    const accepted = Array.from(list).filter(f => f.type.startsWith('image/') || ACCEPTED_EXTENSIONS.includes(ext(f.name)));
    setFiles(prev => [...prev, ...accepted]);
  }

  async function handleUpload() {
    if (!files.length || uploading) return;
    setUploading(true);
    setError('');
    setProgress(15);
    try {
      // Indeterminate-ish progress; the real percent comes from the service in
      // the viewer's onUpload wiring, but we keep a visual cue here too.
      await onUpload(files);
      setProgress(100);
      reset();
      onClose();
    } catch {
      setError('Upload failed. Please check your connection and try again.');
      setUploading(false);
      setProgress(0);
    }
  }

  return (
    <Dialog open={open} onClose={close} slotProps={{ paper: { sx: { borderRadius: '18px', width: 440, maxWidth: '92vw' } } }}>
      <Box sx={{ px: 3, pt: 2.5, pb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${colors.borderLight}` }}>
        <Box>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Attach capture</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{pinLabel}</Typography>
        </Box>
        <IconButton onClick={close} size="small" disabled={uploading} sx={{ color: colors.textMuted }}>
          <CloseRounded sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      <Box sx={{ p: 3 }}>
        <Box
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          onClick={() => !uploading && inputRef.current?.click()}
          sx={{ borderRadius: '14px', border: `2px dashed ${dragging ? colors.primary : colors.border}`, backgroundColor: dragging ? colors.primarySoft : colors.bg, p: 3.5, textAlign: 'center', cursor: uploading ? 'default' : 'pointer', transition: `all ${motion.durationFast}`, '&:hover': { borderColor: uploading ? colors.border : colors.primary } }}
        >
          <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.dng,.insp,.insv,image/*" multiple style={{ display: 'none' }} onChange={e => e.target.files && addFiles(e.target.files)} />
          <CloudUploadRounded sx={{ fontSize: 36, color: dragging ? colors.primary : colors.textSubdued, mb: 1 }} />
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>Drop panoramic images here</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1 }}>or click to browse</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[{ l: 'JPG', c: '#2563eb' }, { l: 'PNG', c: '#0891b2' }, { l: 'DNG', c: '#7c3aed' }, { l: 'INSP', c: '#d97706' }, { l: 'INSV', c: '#d97706' }].map(b => (
              <Box key={b.l} sx={{ px: 0.875, py: 0.25, borderRadius: '4px', backgroundColor: `${b.c}15`, fontSize: '0.625rem', fontWeight: 700, color: b.c }}>{b.l}</Box>
            ))}
          </Box>
        </Box>

        {files.length > 0 && (
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0.75, maxHeight: 180, overflowY: 'auto' }}>
            {files.map((f, i) => (
              <Box key={`${f.name}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, borderRadius: '10px', backgroundColor: colors.bg }}>
                <CameraAltRounded sx={{ fontSize: 18, color: colors.textSubdued, flexShrink: 0 }} />
                <Typography noWrap sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 500, color: colors.textStrong }}>{f.name}</Typography>
                <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, flexShrink: 0 }}>{(f.size / 1024 / 1024).toFixed(1)} MB</Typography>
                {!uploading && (
                  <Box onClick={e => { e.stopPropagation(); setFiles(prev => prev.filter((_, idx) => idx !== i)); }} sx={{ display: 'flex', color: colors.textSubdued, cursor: 'pointer', '&:hover': { color: '#dc2626' } }}>
                    <CloseRounded sx={{ fontSize: 15 }} />
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}

        {uploading && <LinearProgress variant="determinate" value={progress} sx={{ mt: 2, height: 4, borderRadius: '99px', backgroundColor: colors.primarySoft, '& .MuiLinearProgress-bar': { background: colors.primaryGradient } }} />}
        {error && <Typography sx={{ mt: 1.5, fontSize: '0.8125rem', color: colors.danger }}>{error}</Typography>}

        <Box
          onClick={handleUpload}
          sx={{ mt: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 1.25, borderRadius: '10px',
            background: files.length && !uploading ? colors.primaryGradient : colors.bgDeep,
            color: files.length && !uploading ? '#fff' : colors.textSubdued,
            fontSize: '0.9375rem', fontWeight: 600, cursor: files.length && !uploading ? 'pointer' : 'not-allowed',
            boxShadow: files.length && !uploading ? '0 4px 14px rgba(37,99,235,0.28)' : 'none', transition: `all ${motion.durationFast}` }}
        >
          {uploading ? <CheckCircleRounded sx={{ fontSize: 18 }} /> : <CloudUploadRounded sx={{ fontSize: 18 }} />}
          {uploading ? 'Uploading…' : `Attach ${files.length || ''} ${files.length === 1 ? 'image' : 'images'}`.trim()}
        </Box>
      </Box>
    </Dialog>
  );
}
