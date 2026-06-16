import React, { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Chip, Grid, TextField, Alert } from '@mui/material';
import {
  ArrowBackRounded, CheckRounded, CloseRounded, ReplayRounded, AccessTimeRounded,
  CameraAltRounded, FolderRounded, LayersRounded, PersonRounded, NavigateNextRounded,
  ViewInArRounded, BugReportRounded, CompareArrowsRounded, TimelineRounded, HomeRounded,
  MapRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  getCaptureById, statusConfig, mockCaptures, mockAuditLogs, mockDefects, mockTours,
  getCaptureSeriesForCapture, getRoomHistory, type CaptureSnapshot,
} from '@/data/mockData';
import ActivityFeed from '@shared/components/ActivityFeed/ActivityFeed';
import ProcessingPipeline, { type PipelineStage } from '@shared/components/ProcessingPipeline/ProcessingPipeline';
import CaptureTimeline from '@shared/components/CaptureTimeline/CaptureTimeline';
import CompareView from '@shared/components/CompareView/CompareView';
import RoomHistoryPanel from '@shared/components/RoomHistoryPanel/RoomHistoryPanel';

const reviewStatusToPipeline: Record<string, PipelineStage> = {
  uploaded: 'uploaded',
  assigned: 'queued',
  reviewing: 'processing',
  changes_requested: 'processing',
  approved: 'reviewed',
  published: 'published',
};

// ── Small building blocks ───────────────────────────────────────────────────────

function Panel({ title, icon, action, children, accent }: {
  title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; accent?: string;
}) {
  return (
    <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 1.75, borderBottom: `1px solid ${colors.borderLight}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {icon && <Box sx={{ color: accent ?? colors.textMuted, display: 'flex' }}>{icon}</Box>}
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em' }}>{title}</Typography>
        </Box>
        {action}
      </Box>
      <Box sx={{ p: 2.5 }}>{children}</Box>
    </Box>
  );
}

function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <NavigateNextRounded sx={{ fontSize: 14, color: colors.textSubdued }} />}
          {it.to ? (
            <Box component={Link} to={it.to} sx={{ fontSize: '0.75rem', fontWeight: 500, color: colors.textMuted, textDecoration: 'none', '&:hover': { color: colors.primary } }}>{it.label}</Box>
          ) : (
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textStrong }}>{it.label}</Typography>
          )}
        </React.Fragment>
      ))}
    </Box>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function CaptureDetailPage() {
  const { captureId } = useParams<{ captureId: string }>();
  const capture = getCaptureById(captureId ?? '');

  const series = useMemo(() => (captureId ? getCaptureSeriesForCapture(captureId) : []), [captureId]);
  const roomHistory = useMemo(() => (captureId ? getRoomHistory(captureId) : null), [captureId]);

  // The active snapshot drives the preview. Default to the latest.
  const [activeSnap, setActiveSnap] = useState<CaptureSnapshot | null>(series[series.length - 1] ?? null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<[string | null, string | null]>([
    series[0]?.id ?? null,
    series[series.length - 1]?.id ?? null,
  ]);

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

  // Keep the active snapshot valid for the current room's series (handles
  // navigating between captures without remounting).
  const current = (activeSnap && series.some(s => s.id === activeSnap.id))
    ? activeSnap
    : series[series.length - 1];
  const st = statusConfig.capture[capture.status];
  const linkedTour = mockTours.find(t => t.captureId === capture.id);
  const roomDefects = mockDefects.filter(d => d.captureId === capture.id || d.roomName === capture.roomName);

  function handleAction(a: 'approved' | 'rejected' | 'reupload') {
    const idx = mockCaptures.findIndex(c => c.id === capture!.id);
    if (idx !== -1) {
      mockCaptures[idx] = { ...mockCaptures[idx], status: a === 'approved' ? 'processed' : a === 'rejected' ? 'rejected' : 'review', reviewNotes: notes || null };
    }
    setAction(a);
    setDone(true);
  }

  function handleTimelineSelect(snap: CaptureSnapshot) {
    if (compareMode) {
      // Toggle the snapshot into the A/B selection (FIFO).
      setCompareIds(([, b]) => [b, snap.id]);
    } else {
      setActiveSnap(snap);
    }
  }

  const compareA = series.find(s => s.id === compareIds[0]) ?? series[0];
  const compareB = series.find(s => s.id === compareIds[1]) ?? series[series.length - 1];

  return (
    <Box>
      {/* ── Header: breadcrumb + title + status ──────────────────────────────── */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <Box component={Link} to="/captures" sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', width: 30, height: 30, borderRadius: '8px', justifyContent: 'center', backgroundColor: colors.card, boxShadow: '0 1px 3px rgba(15,23,42,0.06)', '&:hover': { color: colors.textStrong } }}>
            <ArrowBackRounded sx={{ fontSize: 18 }} />
          </Box>
          <Breadcrumb items={[
            { label: 'Home', to: '/dashboard' },
            { label: capture.projectName, to: `/projects/${capture.projectId}` },
            { label: capture.towerName, to: `/projects/${capture.projectId}/towers/${capture.towerId}` },
            { label: capture.floorLabel },
            { label: capture.roomName },
          ]} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.75rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>{capture.roomName}</Typography>
            <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mt: 0.25 }}>
              {roomHistory?.captureCount ?? 1} captures over time · last updated {current?.dateLabel ?? capture.uploadedAt}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {linkedTour && (
              <Box component={Link} to={`/tours/${linkedTour.id}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', '&:hover': { opacity: 0.92 } }}>
                <ViewInArRounded sx={{ fontSize: 16 }} /> Open Tour
              </Box>
            )}
            <Chip label={st.label} size="small" sx={{ height: 28, fontSize: '0.75rem', fontWeight: 600, color: st.color, backgroundColor: st.bg, borderRadius: '8px' }} />
          </Box>
        </Box>
      </Box>

      {done && <Alert severity="success" sx={{ mb: 3, borderRadius: '10px' }}>Review submitted successfully.</Alert>}

      <Grid container spacing={3}>
        {/* ── LEFT: preview + timeline + comparison ──────────────────────────── */}
        <Grid size={{ xs: 12, md: 8 }}>
          {/* Big preview OR comparison */}
          {compareMode && compareA && compareB ? (
            <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, p: 2.5, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', mb: 2.5 }}>
              <CompareView a={compareA} b={compareB} />
            </Box>
          ) : (
            <Box sx={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)', mb: 2.5, position: 'relative' }}>
              <Box sx={{ height: 380, background: current?.gradient ?? capture.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                <Box sx={{ textAlign: 'center' }}>
                  <CameraAltRounded sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 72, display: 'block', mx: 'auto', mb: 1 }} />
                  <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.875rem' }}>360° Panorama Preview</Typography>
                  {linkedTour && (
                    <Box component={Link} to={`/tours/${linkedTour.id}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, mt: 2, px: 2.5, py: 1, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.25)', '&:hover': { backgroundColor: 'rgba(255,255,255,0.22)' } }}>
                      Open 360° Viewer →
                    </Box>
                  )}
                </Box>
                {/* Active snapshot date badge */}
                {current && (
                  <Box sx={{ position: 'absolute', top: 14, left: 14, px: 1.5, py: 0.75, borderRadius: '10px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 0.875 }}>
                    <AccessTimeRounded sx={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }} />
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: '#fff' }}>{current.dateLabel}</Typography>
                    <Box sx={{ width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.25)' }} />
                    <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.85)' }}>{current.progress}% complete</Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Timeline + comparison toggle */}
          <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, p: 2.5, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', mb: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mb: 1 }}>
              <Box
                onClick={() => setCompareMode(v => !v)}
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, px: 1.5, py: 0.625, borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: compareMode ? colors.primary : colors.textMuted, backgroundColor: compareMode ? colors.primarySoft : colors.bgDeep, transition: `all ${motion.durationFast}`, '&:hover': { color: colors.primary } }}
              >
                <CompareArrowsRounded sx={{ fontSize: 15 }} /> {compareMode ? 'Exit compare' : 'Compare captures'}
              </Box>
            </Box>
            <CaptureTimeline
              series={series}
              activeId={compareMode ? '' : (current?.id ?? '')}
              onSelect={handleTimelineSelect}
              compareIds={compareMode ? compareIds : undefined}
            />
            {compareMode && (
              <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued, textAlign: 'center', mt: 1.5 }}>
                Click two captures on the timeline to set <b>A</b> and <b>B</b> for comparison.
              </Typography>
            )}
          </Box>

          {/* Uploaded files for the active snapshot */}
          {current && !compareMode && (
            <Panel title={`Uploaded Files (${current.fileCount})`} icon={<CameraAltRounded sx={{ fontSize: 16 }} />}>
              <Grid container spacing={1}>
                {Array.from({ length: Math.min(current.fileCount, 8) }).map((_, i) => (
                  <Grid key={i} size={{ xs: 3 }}>
                    <Box sx={{ aspectRatio: '1', borderRadius: '8px', background: current.gradient, opacity: 0.55 + (i * 0.05), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CameraAltRounded sx={{ color: 'rgba(255,255,255,0.4)', fontSize: 16 }} />
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Panel>
          )}
        </Grid>

        {/* ── RIGHT: context, room progress, review, defects, activity ───────── */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>

            {/* Project context */}
            <Panel title="Location" icon={<MapRounded sx={{ fontSize: 16 }} />}>
              {[
                { icon: <FolderRounded sx={{ fontSize: 15 }} />, label: 'Project', value: capture.projectName, to: `/projects/${capture.projectId}` },
                { icon: <HomeRounded sx={{ fontSize: 15 }} />, label: 'Tower', value: capture.towerName, to: `/projects/${capture.projectId}/towers/${capture.towerId}` },
                { icon: <LayersRounded sx={{ fontSize: 15 }} />, label: 'Floor', value: capture.floorLabel },
                { icon: <CameraAltRounded sx={{ fontSize: 15 }} />, label: 'Room', value: capture.roomName },
              ].map(({ icon, label, value, to }) => (
                <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.875, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
                  <Box sx={{ color: colors.textSubdued, flexShrink: 0, display: 'flex' }}>{icon}</Box>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.06em', width: 56, flexShrink: 0 }}>{label}</Typography>
                  {to ? (
                    <Box component={Link} to={to} sx={{ fontSize: '0.8125rem', color: colors.textStrong, fontWeight: 600, textDecoration: 'none', '&:hover': { color: colors.primary } }}>{value}</Box>
                  ) : (
                    <Typography sx={{ fontSize: '0.8125rem', color: colors.textStrong, fontWeight: 500 }}>{value}</Typography>
                  )}
                </Box>
              ))}
            </Panel>

            {/* Room History (7E) */}
            {roomHistory && <RoomHistoryPanel history={roomHistory} />}

            {/* Processing pipeline */}
            <Panel title="Processing Pipeline" icon={<TimelineRounded sx={{ fontSize: 16 }} />}>
              <ProcessingPipeline currentStage={reviewStatusToPipeline[capture.reviewStatus] ?? 'uploaded'} />
            </Panel>

            {/* Review */}
            {capture.status === 'review' && !done && (
              <Panel title="Review" icon={<CheckRounded sx={{ fontSize: 16 }} />} accent={colors.warning}>
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
              </Panel>
            )}

            {capture.reviewNotes && (
              <Box sx={{ borderRadius: '16px', backgroundColor: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.15)', p: 2.5 }}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626', mb: 0.75 }}>Reviewer Notes</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: colors.textSecondary, lineHeight: 1.6 }}>{capture.reviewNotes}</Typography>
              </Box>
            )}

            {/* Defects */}
            <Panel
              title={`Defects (${roomDefects.length})`}
              icon={<BugReportRounded sx={{ fontSize: 16 }} />}
              accent={roomDefects.length ? colors.danger : colors.textMuted}
              action={<Box component={Link} to="/defects" sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.primary, textDecoration: 'none' }}>View all</Box>}
            >
              {roomDefects.length === 0 ? (
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>No defects logged for this room. 🎉</Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                  {roomDefects.slice(0, 3).map(d => {
                    const sev = statusConfig.severity[d.severity];
                    return (
                      <Box key={d.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: sev.color, mt: 0.625, flexShrink: 0 }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong, lineHeight: 1.4 }}>{d.title}</Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.375 }}>
                            <Chip label={sev.label} size="small" sx={{ height: 18, fontSize: '0.625rem', fontWeight: 700, color: sev.color, backgroundColor: sev.bg, borderRadius: '4px' }} />
                            <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{statusConfig.defect[d.status].label}</Typography>
                          </Box>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Panel>

            {/* Activity history */}
            <Panel title="Activity History" icon={<AccessTimeRounded sx={{ fontSize: 16 }} />}>
              <ActivityFeed
                logs={mockAuditLogs.filter(l => l.entityId === captureId || (l.entityType === 'capture' && l.projectId === capture.projectId)).slice(0, 5)}
                compact
              />
            </Panel>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
