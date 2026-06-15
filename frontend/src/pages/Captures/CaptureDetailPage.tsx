import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Chip, Grid, TextField, Alert } from '@mui/material';
import { ArrowBackRounded, CheckRounded, CloseRounded, ReplayRounded, AccessTimeRounded, CameraAltRounded, FolderRounded, LayersRounded, PersonRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { getCaptureById, statusConfig, mockCaptures, mockAuditLogs } from '@/data/mockData';
import ActivityFeed from '@shared/components/ActivityFeed/ActivityFeed';

export default function CaptureDetailPage() {
  const { captureId } = useParams<{ captureId: string }>();
  const capture = getCaptureById(captureId ?? '');
  const [action, setAction] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);

  if (!capture) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2 }}>
      <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: colors.borderLight }}>404</Typography>
      <Typography sx={{ color: colors.textMuted }}>Capture not found</Typography>
      <Box component={Link} to="/captures" sx={{ color: colors.primary, textDecoration: 'none', fontSize: '0.875rem' }}>← All captures</Box>
    </Box>
  );

  const st = statusConfig.capture[capture.status];

  function handleAction(a: 'approved' | 'rejected' | 'reupload') {
    const idx = mockCaptures.findIndex(c => c.id === capture!.id);
    if (idx !== -1) {
      mockCaptures[idx] = { ...mockCaptures[idx], status: a === 'approved' ? 'processed' : a === 'rejected' ? 'rejected' : 'review', reviewNotes: notes || null };
    }
    setAction(a);
    setDone(true);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
        <Box component={Link} to="/captures" sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.25rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em' }}>{capture.roomName}</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{capture.projectName} · {capture.towerName} · {capture.floorLabel}</Typography>
        </Box>
        <Chip label={st.label} size="small" sx={{ height: 24, fontSize: '0.75rem', fontWeight: 600, color: st.color, backgroundColor: st.bg, borderRadius: '6px' }} />
      </Box>

      {done && <Alert severity="success" sx={{ mb: 3, borderRadius: '10px' }}>Review submitted successfully.</Alert>}

      <Grid container spacing={3}>
        {/* Left: preview */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', mb: 2 }}>
            <Box sx={{ height: 320, background: capture.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Box sx={{ textAlign: 'center' }}>
                <CameraAltRounded sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 64, display: 'block', mx: 'auto', mb: 1 }} />
                <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.875rem' }}>360° Preview</Typography>
                <Box component={Link} to={`/tours/${captureId}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, mt: 2, px: 2.5, py: 1, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.25)', '&:hover': { backgroundColor: 'rgba(255,255,255,0.22)' } }}>
                  Open 360° Viewer →
                </Box>
              </Box>
            </Box>
          </Box>

          {/* File grid placeholder */}
          <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, p: 2.5, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', mb: 2 }}>
              Uploaded Files ({capture.fileCount})
            </Typography>
            <Grid container spacing={1}>
              {Array.from({ length: Math.min(capture.fileCount, 9) }).map((_, i) => (
                <Grid key={i} size={{ xs: 4 }}>
                  <Box sx={{ aspectRatio: '1', borderRadius: '8px', background: capture.gradient, opacity: 0.6 + (i * 0.04), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CameraAltRounded sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }} />
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        </Grid>

        {/* Right: metadata + review */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Metadata */}
            <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, p: 2.5, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', mb: 2 }}>Details</Typography>
              {[
                { icon: <FolderRounded sx={{ fontSize: 15 }} />, label: 'Project', value: capture.projectName },
                { icon: <LayersRounded sx={{ fontSize: 15 }} />, label: 'Location', value: `${capture.towerName} · ${capture.floorLabel}` },
                { icon: <PersonRounded sx={{ fontSize: 15 }} />, label: 'Uploaded by', value: capture.uploadedBy },
                { icon: <AccessTimeRounded sx={{ fontSize: 15 }} />, label: 'Uploaded', value: capture.uploadedAt },
                { icon: <CameraAltRounded sx={{ fontSize: 15 }} />, label: 'Files', value: `${capture.fileCount} images · ${capture.sizeMb} MB` },
              ].map(({ icon, label, value }) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
                  <Box sx={{ color: colors.textSubdued, mt: 0.25, flexShrink: 0 }}>{icon}</Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</Typography>
                    <Typography sx={{ fontSize: '0.875rem', color: colors.textStrong, fontWeight: 500 }}>{value}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>

            {/* Review panel */}
            {capture.status === 'review' && !done && (
              <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, p: 2.5, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', mb: 2 }}>Review</Typography>
                <TextField fullWidth multiline rows={3} placeholder="Add review notes (optional)…" value={notes} onChange={e => setNotes(e.target.value)}
                  sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: '10px', fontSize: '0.875rem' } }} />
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Box onClick={() => handleAction('approved')} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, py: 1.125, borderRadius: '10px', backgroundColor: 'rgba(22,163,74,0.1)', color: '#16a34a', fontWeight: 600, fontSize: '0.9375rem', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(22,163,74,0.18)' }, transition: `background ${motion.durationFast}` }}>
                    <CheckRounded sx={{ fontSize: 18 }} /> Approve
                  </Box>
                  <Box onClick={() => handleAction('reupload')} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, py: 1, borderRadius: '10px', backgroundColor: 'rgba(217,119,6,0.08)', color: '#d97706', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(217,119,6,0.15)' }, transition: `background ${motion.durationFast}` }}>
                    <ReplayRounded sx={{ fontSize: 16 }} /> Request Re-upload
                  </Box>
                  <Box onClick={() => handleAction('rejected')} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, py: 1, borderRadius: '10px', backgroundColor: 'rgba(220,38,38,0.06)', color: '#dc2626', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(220,38,38,0.12)' }, transition: `background ${motion.durationFast}` }}>
                    <CloseRounded sx={{ fontSize: 16 }} /> Reject
                  </Box>
                </Box>
              </Box>
            )}

            {/* Review notes if already reviewed */}
            {capture.reviewNotes && (
              <Box sx={{ borderRadius: '16px', backgroundColor: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.15)', p: 2.5 }}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626', mb: 0.75 }}>Reviewer Notes</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: colors.textSecondary, lineHeight: 1.6 }}>{capture.reviewNotes}</Typography>
              </Box>
            )}

            {/* Audit history for this capture */}
            <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, p: 2.5, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', mb: 2 }}>Activity History</Typography>
              <ActivityFeed
                logs={mockAuditLogs.filter(l => l.entityId === captureId || (l.entityType === 'capture' && l.projectId === capture.projectId)).slice(0, 5)}
                compact
              />
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
