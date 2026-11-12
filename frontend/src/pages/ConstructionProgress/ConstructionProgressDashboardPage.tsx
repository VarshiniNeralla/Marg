import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography, CircularProgress, Button, LinearProgress, Snackbar, Alert } from '@mui/material';
import { ArrowBackRounded, RefreshRounded, AutoAwesomeRounded, NotificationsActiveRounded } from '@mui/icons-material';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { colors, shadows } from '@theme/tokens';
import { useBackgroundAnalysisStore } from '@store/backgroundAnalysis';
import { analysisStageLabel, formatElapsed, softProgressPct } from '@/utils/analysisProgress';
import {
  constructionProgressService,
  type FloorProgressSnapshot,
} from '@/services/constructionProgressService';
import FloorActionToolbar from '@/components/ConstructionProgress/FloorActionToolbar';
import ProgressRing from '@/components/ConstructionProgress/ProgressRing';
import SummaryCardsRow from '@/components/ConstructionProgress/SummaryCardsRow';
import ExecutiveSummaryPanel from '@/components/ConstructionProgress/ExecutiveSummaryPanel';
import ActivitySection from '@/components/ConstructionProgress/ActivitySection';
import FloorPlanHeatmapOverlay from '@/components/ConstructionProgress/FloorPlanHeatmapOverlay';
import ProgressTimelineChart from '@/components/ConstructionProgress/ProgressTimelineChart';
import ProgressComparisonView from '@/components/ConstructionProgress/ProgressComparisonView';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { exportConstructionProgressPdf } from '@/utils/constructionProgressPdf';
import { exportConstructionProgressExcel } from '@/utils/constructionProgressExcel';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff', bg: '#f7f8fa' };

export default function ConstructionProgressDashboardPage() {
  const { floorId } = useParams<{ floorId: string }>();
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeElapsedSec, setAnalyzeElapsedSec] = useState(0);
  const [analyzeIsReanalysis, setAnalyzeIsReanalysis] = useState(false);
  const [confirmReanalyzeOpen, setConfirmReanalyzeOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<FloorProgressSnapshot | null>(null);
  const [notAnalyzed, setNotAnalyzed] = useState(false);
  const analyzingRef = useRef(false);
  const pollGenerationRef = useRef(0);
  // "Run in background": the analysis runs on the server and the user is notified when it is done.
  const [backgroundRunning, setBackgroundRunning] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [bgNotice, setBgNotice] = useState<{ text: string; severity: 'success' | 'error' } | null>(null);
  const [reanalyzeInBackground, setReanalyzeInBackground] = useState(false);
  // Ask the server for the background list right away so the app-wide indicator appears at once.
  const refreshBackgroundAnalyses = useBackgroundAnalysisStore(s => s.refresh);

  const finishAnalyze = useCallback((ok: boolean, isReanalysis: boolean, error?: string | null) => {
    analyzingRef.current = false;
    setAnalyzing(false);
    setActiveJobId(null);
    if (ok) {
      toast.success(isReanalysis ? 'Re-analysis complete' : 'Progress analysis complete');
    } else {
      toast.error(error || (isReanalysis ? 'Failed to re-analyze floor' : 'Failed to analyze floor'));
    }
  }, []);

  const pollAnalyzeJob = useCallback(async (
    id: string,
    jobId: string,
    isReanalysis: boolean,
    opts: { silent?: boolean } = {},
  ) => {
    const generation = ++pollGenerationRef.current;
    // Silent = a background analysis: no overlay. The server sends the notification, so this
    // poll only refreshes the report on screen if the user is still on this page.
    const silent = !!opts.silent;
    const maxAttempts = 180; // 180 × 5s ≈ 15 min
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5_000));
      if (pollGenerationRef.current !== generation) return;
      try {
        const job = await constructionProgressService.getAnalyzeJob(id, jobId);
        if (pollGenerationRef.current !== generation) return;
        if (job.status === 'completed') {
          const detail = await constructionProgressService.getFloorDetail(id);
          if (pollGenerationRef.current !== generation) return;
          if (detail) {
            setSnapshot(detail);
            setNotAnalyzed(false);
          }
          if (silent) { setBackgroundRunning(false); setActiveJobId(null); }
          else finishAnalyze(true, isReanalysis);
          return;
        }
        if (job.status === 'failed') {
          if (silent) { setBackgroundRunning(false); setActiveJobId(null); }
          else finishAnalyze(false, isReanalysis, job.error);
          return;
        }
      } catch {
        /* keep polling — brief network blips during a long analyze are expected */
      }
    }
    if (silent) {
      if (pollGenerationRef.current === generation) { setBackgroundRunning(false); setActiveJobId(null); }
      return;
    }
    if (pollGenerationRef.current === generation) {
      finishAnalyze(
        false,
        isReanalysis,
        isReanalysis ? 'Re-analysis timed out — check again shortly' : 'Analysis timed out — check again shortly',
      );
    }
  }, [finishAnalyze]);

  const load = useCallback(async () => {
    if (!floorId) return;
    setLoading(true);
    setNotAnalyzed(false);
    try {
      const [detail, activeJob] = await Promise.all([
        constructionProgressService.getFloorDetail(floorId),
        constructionProgressService.getActiveAnalyzeJob(floorId).catch(() => null),
      ]);
      if (!detail) {
        setSnapshot(null);
        setNotAnalyzed(true);
      } else {
        setSnapshot(detail);
        setNotAnalyzed(false);
      }
      // Resume if a job is still running (page refresh / reconnect / came back later).
      if (
        activeJob
        && (activeJob.status === 'pending' || activeJob.status === 'processing')
        && !analyzingRef.current
      ) {
        setActiveJobId(activeJob.jobId);
        if (activeJob.runInBackground) {
          // Started with "Run in background": no overlay, just a quiet banner.
          setBackgroundRunning(true);
          void pollAnalyzeJob(floorId, activeJob.jobId, !!detail, { silent: true });
        } else {
          analyzingRef.current = true;
          setAnalyzeIsReanalysis(!!detail);
          setAnalyzing(true);
          void pollAnalyzeJob(floorId, activeJob.jobId, !!detail);
        }
      }
    } catch (err: unknown) {
      const status = (err as { status?: number; response?: { status?: number } })?.status
        ?? (err as { response?: { status?: number } })?.response?.status;
      // Legacy servers still return 404 for "not analyzed".
      if (status === 404) {
        setSnapshot(null);
        setNotAnalyzed(true);
      } else if (status === 401) {
        toast.error('Your session has expired. Please log in again.');
      } else {
        toast.error('Failed to load progress data');
      }
    } finally {
      setLoading(false);
    }
  }, [floorId, pollAnalyzeJob]);

  useEffect(() => {
    load();
    return () => {
      // Invalidate any in-flight poll when leaving the page.
      pollGenerationRef.current += 1;
    };
  }, [load]);

  // Tick the overlay clock while analyze is in flight.
  useEffect(() => {
    if (!analyzing) {
      setAnalyzeElapsedSec(0);
      return;
    }
    const started = Date.now();
    setAnalyzeElapsedSec(0);
    const id = window.setInterval(() => {
      setAnalyzeElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [analyzing]);

  const handleAnalyze = async () => {
    if (!floorId || analyzingRef.current) return;
    const isReanalysis = !!snapshot;
    analyzingRef.current = true;
    setAnalyzeIsReanalysis(isReanalysis);
    setAnalyzing(true);
    try {
      const job = await constructionProgressService.analyzeFloor(floorId);
      setActiveJobId(job.jobId);
      if (job.status === 'completed' && job.snapshotId) {
        const detail = await constructionProgressService.getFloorDetail(floorId);
        if (detail) {
          setSnapshot(detail);
          setNotAnalyzed(false);
        }
        finishAnalyze(true, isReanalysis);
        return;
      }
      if (job.status === 'failed') {
        finishAnalyze(false, isReanalysis, job.error);
        return;
      }
      await pollAnalyzeJob(floorId, job.jobId, isReanalysis);
    } catch {
      finishAnalyze(false, isReanalysis, isReanalysis ? 'Failed to start re-analysis' : 'Failed to start analysis');
    }
  };

  const BACKGROUND_STARTED_TEXT =
    'Analysis is running in the background. You can keep working — we will notify you as soon as it is ready for review.';

  /** "Run in Background": start the analysis without the blocking overlay. */
  const handleRunInBackground = async () => {
    if (!floorId || analyzingRef.current || backgroundRunning) return;
    const isReanalysis = !!snapshot;
    setBackgroundRunning(true);
    try {
      const job = await constructionProgressService.analyzeFloor(floorId, { background: true });
      if (job.status === 'failed') {
        setBackgroundRunning(false);
        setBgNotice({ text: job.error || 'The analysis could not be started.', severity: 'error' });
        return;
      }
      setActiveJobId(job.jobId);
      void refreshBackgroundAnalyses();
      setBgNotice({ text: BACKGROUND_STARTED_TEXT, severity: 'success' });
      void pollAnalyzeJob(floorId, job.jobId, isReanalysis, { silent: true });
    } catch {
      setBackgroundRunning(false);
      setBgNotice({ text: 'Could not start the analysis in the background. Please try again.', severity: 'error' });
    }
  };

  /** "Continue in background" from the overlay: hand a running analysis over to the server. */
  const handleContinueInBackground = async () => {
    if (!floorId || !activeJobId) return;
    const jobId = activeJobId;
    const isReanalysis = analyzeIsReanalysis;
    try {
      await constructionProgressService.continueAnalyzeInBackground(floorId, jobId);
    } catch {
      setBgNotice({ text: 'Could not switch to the background. Please keep this screen open.', severity: 'error' });
      return;
    }
    // Stop the blocking wait and hand over to the quiet poll.
    pollGenerationRef.current += 1;
    analyzingRef.current = false;
    setAnalyzing(false);
    setBackgroundRunning(true);
    void refreshBackgroundAnalyses();
    setBgNotice({ text: BACKGROUND_STARTED_TEXT, severity: 'success' });
    void pollAnalyzeJob(floorId, jobId, isReanalysis, { silent: true });
  };

  const handleExportPdf = async () => {
    if (!snapshot) return;
    try {
      await exportConstructionProgressPdf(snapshot);
    } catch {
      toast.error('Failed to generate PDF');
    }
  };

  const handleExportExcel = async () => {
    if (!snapshot || !floorId) return;
    try {
      const timeline = await constructionProgressService.getTimeline(floorId);
      await exportConstructionProgressExcel(snapshot, timeline);
    } catch {
      toast.error('Failed to generate Excel report');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress size={28} sx={{ color: colors.primary }} />
      </Box>
    );
  }

  const progressPct = softProgressPct(analyzeElapsedSec);

  return (
    <>
      {analyzing && (
        <Box
          sx={{
            position: 'fixed', inset: 0, zIndex: 1300,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 2, backgroundColor: 'rgba(17, 24, 39, 0.55)', backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          <Box
            sx={{
              display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1.75,
              px: 4, py: 4, borderRadius: '16px', backgroundColor: P.white, boxShadow: shadows.btn,
              width: '100%', maxWidth: 380, textAlign: 'center',
            }}
          >
            <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
              <CircularProgress size={48} thickness={3} sx={{ color: colors.primary }} />
              <AutoAwesomeRounded sx={{ position: 'absolute', fontSize: 20, color: colors.primary }} />
            </Box>
            <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong }}>
              {analyzeIsReanalysis ? 'Re-analyzing floor…' : 'Analyzing floor…'}
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>
              {analysisStageLabel(analyzeElapsedSec)}
            </Typography>
            <Box sx={{ width: '100%', mt: 0.5 }}>
              <LinearProgress
                variant="determinate"
                value={progressPct}
                sx={{
                  height: 8, borderRadius: '99px', backgroundColor: colors.primarySoft,
                  '& .MuiLinearProgress-bar': { borderRadius: '99px', background: colors.primaryGradient },
                }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.75 }}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: P.muted }}>
                  {progressPct}%
                </Typography>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: P.muted }}>
                  {formatElapsed(analyzeElapsedSec)} elapsed
                </Typography>
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.75rem', color: P.muted, lineHeight: 1.45 }}>
              This often takes 2–5 minutes on large floors. Keep this screen open until the report appears, or continue in the background and we will notify you when it is ready for review.
            </Typography>
            <Button
              onClick={() => void handleContinueInBackground()}
              disabled={!activeJobId}
              startIcon={<NotificationsActiveRounded sx={{ fontSize: 18 }} />}
              sx={{
                border: `1.5px solid ${P.border}`, color: P.strong, px: 2, py: 0.75, borderRadius: '10px',
                fontWeight: 700, textTransform: 'none', fontSize: '0.8125rem',
                '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
              }}
            >
              Continue in background
            </Button>
          </Box>
        </Box>
      )}
      <Box sx={{ maxWidth: 1080, mx: 'auto', px: { xs: 2, sm: 3 }, py: 4 }}>
      <Box
        component={Link}
        to="/construction-progress"
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 2,
          fontSize: '0.8125rem', fontWeight: 600, color: P.muted, textDecoration: 'none',
          '&:hover': { color: colors.primary },
        }}
      >
        <ArrowBackRounded sx={{ fontSize: 16 }} /> All floors
      </Box>

      {notAnalyzed || !snapshot ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography sx={{ fontSize: '1.125rem', fontWeight: 700, color: P.strong, mb: 1 }}>
            This floor hasn't been analyzed yet
          </Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: P.muted, mb: 3 }}>
            Run the AI progress assessment against every uploaded capture for this floor.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'stretch', maxWidth: 520, mx: 'auto' }}>
            <Button
              onClick={handleAnalyze}
              disabled={analyzing || backgroundRunning}
              startIcon={analyzing ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <RefreshRounded />}
              sx={{
                background: colors.primaryGradient, color: '#fff', px: 3, minHeight: 44, flex: 1, borderRadius: '10px',
                fontWeight: 700, textTransform: 'none', boxShadow: shadows.btn,
                '&:hover': { opacity: 0.92 },
                '&.Mui-disabled': { color: 'rgba(255,255,255,0.8)', opacity: 0.6 },
              }}
            >
              {analyzing ? 'Analyzing…' : 'Analyze Now'}
            </Button>
            <Button
              onClick={() => void handleRunInBackground()}
              disabled={analyzing || backgroundRunning}
              startIcon={backgroundRunning
                ? <CircularProgress size={14} sx={{ color: colors.primary }} />
                : <NotificationsActiveRounded sx={{ fontSize: 18 }} />}
              sx={{
                border: `1.5px solid ${P.border}`, color: P.strong, px: 3, minHeight: 44, flex: 1, borderRadius: '10px',
                fontWeight: 700, textTransform: 'none',
                '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
              }}
            >
              {backgroundRunning ? 'Running in background…' : 'Run in Background'}
            </Button>
          </Box>
        </Box>
      ) : (
        <>
          <Box sx={{ mb: 3 }}>
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>
                {snapshot.floorName}
              </Typography>
              <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
                {[snapshot.projectName, snapshot.towerName].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
            <FloorActionToolbar
              floorId={floorId}
              analyzing={analyzing}
              backgroundRunning={backgroundRunning}
              onPdf={handleExportPdf}
              onExcel={handleExportExcel}
              onReanalyze={() => { setReanalyzeInBackground(false); setConfirmReanalyzeOpen(true); }}
              onRunInBackground={() => { setReanalyzeInBackground(true); setConfirmReanalyzeOpen(true); }}
            />
          </Box>

          <Box
            sx={{
              display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap',
              p: 3, borderRadius: '16px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, mb: 3,
            }}
          >
            <ProgressRing percentage={snapshot.overallProgressPct} label="Complete" />
            <Box sx={{ flex: 1, minWidth: 240 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Overall Floor Progress
                </Typography>
                <Box
                  sx={{
                    px: 1, py: 0.125, borderRadius: '6px',
                    backgroundColor: snapshot.overallStatus === 'completed' ? colors.successBg : colors.warningBg,
                  }}
                >
                  <Typography sx={{
                    fontSize: '0.6875rem', fontWeight: 700,
                    color: snapshot.overallStatus === 'completed' ? colors.success : colors.warning,
                  }}>
                    {snapshot.overallStatus === 'completed' ? 'Completed' : 'Work in Progress'}
                  </Typography>
                </Box>
              </Box>
              <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: P.strong, lineHeight: 1.1 }}>
                {Math.round(snapshot.overallProgressPct)}%
              </Typography>
              <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mt: 1 }}>
                {snapshot.imagesAnalyzedCount} image{snapshot.imagesAnalyzedCount === 1 ? '' : 's'} analyzed
              </Typography>
              {[
                { label: 'Flat finishing', unit: 'flats', s: snapshot.flatFinishing },
                { label: 'Common area', unit: 'regions', s: snapshot.commonFinishing },
              ].filter(x => (x.s?.total ?? 0) > 0).length > 0 && (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1, mt: 1.5 }}>
                  {[
                    { label: 'Flat finishing', unit: 'flats', s: snapshot.flatFinishing },
                    { label: 'Common area', unit: 'regions', s: snapshot.commonFinishing },
                  ].filter(x => (x.s?.total ?? 0) > 0).map(x => (
                    <Box key={x.label} sx={{ px: 1.5, py: 1, borderRadius: '10px', backgroundColor: P.bg, border: `1px solid ${P.border}` }}>
                      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {x.label}
                      </Typography>
                      <Typography sx={{ fontSize: '1.125rem', fontWeight: 800, color: P.strong, lineHeight: 1.2 }}>
                        {Math.round(x.s?.progressPct ?? 0)}%
                        <Typography component="span" sx={{ fontSize: '0.75rem', fontWeight: 600, color: P.muted }}>
                          {' '}verified · {Math.round(x.s?.coveragePct ?? 0)}% coverage
                        </Typography>
                      </Typography>
                      <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
                        {x.s?.completed ?? 0} of {x.s?.total} {x.unit} complete
                        {(x.s?.awaitingEvidence ?? 0) > 0 ? ` · ${x.s?.awaitingEvidence} awaiting evidence` : ''}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>

          <Box sx={{ mb: 3 }}>
            <SummaryCardsRow
              cards={snapshot.summaryCards}
              overallProgressPct={snapshot.overallProgressPct}
              analysedAt={snapshot.snapshotDate}
            />
          </Box>

          <Box sx={{ mb: 3 }}>
            <ExecutiveSummaryPanel summary={snapshot.executiveSummary} />
          </Box>

          <Box sx={{ mb: 3 }}>
            <ProgressTimelineChart floorId={snapshot.floorId} />
          </Box>

          <Box sx={{ mb: 3 }}>
            <ProgressComparisonView floorId={snapshot.floorId} />
          </Box>

          <Box sx={{ mb: 3 }}>
            <FloorPlanHeatmapOverlay
              floorPlanImageUrl={snapshot.floorPlanImageUrl}
              floorPlanId={snapshot.floorPlanId}
              rooms={snapshot.roomHeatmap}
              heatmapPins={snapshot.heatmapPins}
            />
          </Box>

          <ActivitySection activities={snapshot.activities} />
        </>
      )}
    </Box>

      <ConfirmDialog
        open={confirmReanalyzeOpen}
        title="Re-analyze this floor?"
        description="This will run progress analysis again using the latest captures and room map. The current report will be replaced with a new snapshot."
        confirmLabel={reanalyzeInBackground ? 'Re-analyze in background' : 'Re-analyze'}
        cancelLabel="Cancel"
        onConfirm={() => {
          setConfirmReanalyzeOpen(false);
          if (reanalyzeInBackground) void handleRunInBackground();
          else void handleAnalyze();
        }}
        onCancel={() => setConfirmReanalyzeOpen(false)}
      />

      <Snackbar
        open={!!bgNotice}
        autoHideDuration={8000}
        onClose={(_e, reason) => { if (reason !== 'clickaway') setBgNotice(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={bgNotice?.severity ?? 'success'}
          variant="filled"
          onClose={() => setBgNotice(null)}
          sx={{ maxWidth: 520 }}
        >
          {bgNotice?.text}
        </Alert>
      </Snackbar>
    </>
  );
}
