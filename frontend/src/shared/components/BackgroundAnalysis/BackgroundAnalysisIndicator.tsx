import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Chip, CircularProgress, IconButton, LinearProgress, Popover, Typography,
} from '@mui/material';
import {
  CheckCircleRounded, CloseRounded, ErrorOutlineRounded, OpenInNewRounded,
} from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { useAuthStore, isManagerOrAdmin } from '@store/authStore';
import { useBackgroundAnalysisStore } from '@store/backgroundAnalysis';
import type { BackgroundAnalysisJob } from '@/services/constructionProgressService';
import {
  analysisStageLabel, formatElapsed, jobElapsedSec, jobProgressPct, splitBackgroundJobs,
} from '@/utils/analysisProgress';
import { formatNotificationTime } from '@/utils/notificationTime';

const NAV_OFFSET = 56;
const FAILED = '#dc2626';

function jobTitle(job: BackgroundAnalysisJob): string {
  return job.floorLabel || 'Floor analysis';
}

/**
 * App-wide "something is running" indicator for floor analyses started with Run in Background.
 *
 *  - a thin bar across the very top of every page while any analysis is running;
 *  - a small pill under the navbar: what is running, an estimated progress, "View status";
 *  - once a run finishes, the pill offers "Open" until the user dismisses it.
 *
 * Progress is an ESTIMATE from elapsed time (the server only reports a status) and is labelled so.
 */
export default function BackgroundAnalysisIndicator() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const allowed = isManagerOrAdmin(user);
  const jobs = useBackgroundAnalysisStore(s => s.jobs);
  const dismissedIds = useBackgroundAnalysisStore(s => s.dismissed);
  const dismiss = useBackgroundAnalysisStore(s => s.dismiss);
  const [panelAnchor, setPanelAnchor] = useState<HTMLElement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const { active, finished } = useMemo(
    () => splitBackgroundJobs(jobs, new Set(dismissedIds)),
    [jobs, dismissedIds],
  );
  const hasActive = active.length > 0;

  // Re-render every second only while something is running, to move the estimate and the clock.
  useEffect(() => {
    if (!hasActive) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasActive]);

  // Nothing left to show: make sure a stale open panel does not linger.
  const nothingToShow = !hasActive && finished.length === 0;
  useEffect(() => {
    if (nothingToShow) setPanelAnchor(null);
  }, [nothingToShow]);

  if (!allowed || nothingToShow) return null;

  const openJob = (job: BackgroundAnalysisJob) => {
    dismiss(job.jobId);
    setPanelAnchor(null);
    navigate(`/construction-progress/${job.floorId}`);
  };

  const avgPct = hasActive
    ? Math.round(active.reduce((sum, j) => sum + jobProgressPct(j, now), 0) / active.length)
    : 0;
  const lead = hasActive ? active[0] : finished[0];
  const leadFailed = !hasActive && lead.status === 'failed';
  const extra = (hasActive ? active.length : finished.length) - 1;
  const panelOpen = Boolean(panelAnchor);

  const rows = [...active, ...finished];

  return (
    <>
      {hasActive && (
        <LinearProgress
          variant="determinate"
          value={avgPct}
          aria-label="Background analysis progress (estimated)"
          sx={{
            position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 1400,
            backgroundColor: 'transparent',
            '& .MuiLinearProgress-bar': { background: colors.primaryGradient, transition: 'transform 1s linear' },
          }}
        />
      )}

      <Box
        role="status"
        aria-live="polite"
        sx={{
          position: 'fixed', top: NAV_OFFSET + 8, right: { xs: 12, md: 24 }, left: { xs: 12, sm: 'auto' },
          zIndex: 1190, display: 'flex', alignItems: 'center', gap: 1.25,
          maxWidth: { xs: 'none', sm: 460 }, px: 1.5, py: 1, borderRadius: '12px',
          backgroundColor: '#fff', border: `1px solid ${leadFailed ? FAILED : colors.border}`,
          boxShadow: '0 6px 24px rgba(15, 23, 42, 0.12)',
        }}
      >
        {hasActive ? (
          <CircularProgress size={18} thickness={5} sx={{ color: colors.primary, flexShrink: 0 }} />
        ) : leadFailed ? (
          <ErrorOutlineRounded sx={{ fontSize: 20, color: FAILED, flexShrink: 0 }} />
        ) : (
          <CheckCircleRounded sx={{ fontSize: 20, color: colors.success, flexShrink: 0 }} />
        )}

        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.ink }}>
            {hasActive
              ? (active.length === 1 ? `Analyzing ${jobTitle(lead)}` : `${active.length} analyses running`)
              : leadFailed
                ? `Analysis failed · ${jobTitle(lead)}`
                : `Ready for review · ${jobTitle(lead)}`}
            {!hasActive && extra > 0 ? ` (+${extra} more)` : ''}
          </Typography>
          <Typography noWrap sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>
            {hasActive
              ? `est. ${avgPct}% · ${formatElapsed(jobElapsedSec(active[0], now))} elapsed · you can keep working`
              : formatNotificationTime(lead.completedAt ?? '') || 'Just now'}
          </Typography>
        </Box>

        {!hasActive && (
          <Button
            size="small"
            onClick={() => openJob(lead)}
            startIcon={<OpenInNewRounded sx={{ fontSize: 15 }} />}
            sx={{
              textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', borderRadius: '8px', px: 1.25,
              color: '#fff', background: leadFailed ? FAILED : colors.primaryGradient,
              '&:hover': { opacity: 0.92 },
            }}
          >
            {leadFailed ? 'Open floor' : 'Open'}
          </Button>
        )}
        <Button
          size="small"
          onClick={e => setPanelAnchor(e.currentTarget.closest('[role="status"]') as HTMLElement)}
          sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.75rem', borderRadius: '8px', px: 1, color: colors.primary, flexShrink: 0 }}
        >
          View status
        </Button>
        {!hasActive && (
          <IconButton
            size="small"
            aria-label="Dismiss"
            onClick={() => finished.forEach(j => dismiss(j.jobId))}
            sx={{ p: 0.5, color: colors.textMuted }}
          >
            <CloseRounded sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>

      <Popover
        open={panelOpen}
        anchorEl={panelAnchor}
        onClose={() => setPanelAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, width: { xs: 'calc(100vw - 24px)', sm: 400 }, maxWidth: 420, borderRadius: '14px', p: 0 } } }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${colors.border}` }}>
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 800, color: colors.ink }}>
            Background analyses
          </Typography>
          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>
            Progress is an estimate · most floors take 2–5 minutes
          </Typography>
        </Box>

        <Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
          {rows.map(job => {
            const running = job.status === 'pending' || job.status === 'processing';
            const failedJob = job.status === 'failed';
            const elapsed = jobElapsedSec(job, now);
            const pct = jobProgressPct(job, now);
            return (
              <Box key={job.jobId} sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${colors.borderLight}` }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography noWrap sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 700, color: colors.ink }}>
                    {jobTitle(job)}
                  </Typography>
                  <Chip
                    size="small"
                    label={running ? 'Running' : failedJob ? 'Failed' : 'Ready'}
                    sx={{
                      height: 20, fontSize: '0.6875rem', fontWeight: 700,
                      color: running ? colors.primary : failedJob ? FAILED : colors.success,
                      backgroundColor: running ? colors.primarySoft : failedJob ? 'rgba(220,38,38,0.08)' : 'rgba(22,163,74,0.1)',
                    }}
                  />
                </Box>

                {job.startedByName && (
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mb: 0.75 }}>
                    Started by {job.startedByName}
                  </Typography>
                )}

                {running ? (
                  <>
                    <LinearProgress
                      variant="determinate"
                      value={pct}
                      sx={{
                        height: 6, borderRadius: '99px', backgroundColor: colors.primarySoft,
                        '& .MuiLinearProgress-bar': { borderRadius: '99px', background: colors.primaryGradient },
                      }}
                    />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5, gap: 1 }}>
                      <Typography noWrap sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>
                        {analysisStageLabel(elapsed)}
                      </Typography>
                      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textMuted, flexShrink: 0 }}>
                        est. {pct}% · {formatElapsed(elapsed)}
                      </Typography>
                    </Box>
                  </>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ flex: 1, fontSize: '0.75rem', color: colors.textMuted }}>
                      {failedJob
                        ? (job.error ? `Failed: ${job.error}` : 'The analysis could not be completed.')
                        : `Completed ${formatNotificationTime(job.completedAt ?? '') || 'just now'}`}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => openJob(job)}
                      sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', borderRadius: '8px', color: failedJob ? FAILED : colors.primary }}
                    >
                      {failedJob ? 'Open floor' : 'Open'}
                    </Button>
                    <IconButton size="small" aria-label="Dismiss" onClick={() => dismiss(job.jobId)} sx={{ p: 0.5, color: colors.textMuted }}>
                      <CloseRounded sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Popover>
    </>
  );
}
