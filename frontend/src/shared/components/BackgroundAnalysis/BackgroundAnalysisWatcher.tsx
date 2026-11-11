import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Snackbar } from '@mui/material';
import { useAuthStore, isManagerOrAdmin } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { useBackgroundAnalysisStore } from '@store/backgroundAnalysis';
import { notificationService } from '@/services/notificationService';
import { constructionProgressService } from '@/services/constructionProgressService';
import type { MockNotification, NotifType } from '@/data/mockData';

const IDLE_POLL_MS = 30_000;   // pick up notifications created while the user was elsewhere
const JOB_POLL_MS = 5_000;     // tracked jobs: notice completion quickly
const ANALYSIS_TYPES: NotifType[] = ['progress_analysis_complete', 'progress_analysis_failed'];

interface ServerNotification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt?: string;
  created_at?: string;
  recipientUserId?: string;
}

function toMock(n: ServerNotification): MockNotification {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: !!n.read,
    createdAt: String(n.createdAt ?? n.created_at ?? ''),
    recipientUserId: n.recipientUserId,
  };
}

/**
 * Delivers "analysis ready for review" alerts for analyses started with Run in background.
 * Mounted once in the dashboard layout so it keeps working when the user navigates away
 * from the Construction Progress page. Renders nothing except a small snackbar.
 */
export default function BackgroundAnalysisWatcher() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const allowed = isManagerOrAdmin(user);
  const [alertNotif, setAlertNotif] = useState<MockNotification | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const page = await notificationService.listNotifications({ limit: 20, read: false });
      const items = (page?.items ?? []) as unknown as ServerNotification[];
      const fresh = useWorkflowStore.getState().mergeServerNotifications(items.map(toMock));
      const analysis = fresh.find(n => ANALYSIS_TYPES.includes(n.type));
      if (analysis) setAlertNotif(analysis);
    } catch {
      /* offline or a transient error: the next poll will try again */
    } finally {
      refreshing.current = false;
    }
  }, []);

  // The server inserts the notification just after it flips the job to completed, so look again shortly.
  const refreshSoon = useCallback(() => {
    void refresh();
    window.setTimeout(() => void refresh(), 1_500);
    window.setTimeout(() => void refresh(), 6_000);
  }, [refresh]);

  // 1) Slow poll + refresh whenever the tab/app comes back to the foreground.
  useEffect(() => {
    if (!allowed) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, IDLE_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [allowed, refresh]);

  // 2) Fast poll for analyses started in this session.
  useEffect(() => {
    if (!allowed) return;
    const timer = window.setInterval(async () => {
      const { jobs, untrack } = useBackgroundAnalysisStore.getState();
      for (const job of Object.values(jobs)) {
        try {
          const latest = await constructionProgressService.getAnalyzeJob(job.floorId, job.jobId);
          if (latest.status === 'completed' || latest.status === 'failed') {
            untrack(job.jobId);
            refreshSoon();
          }
        } catch {
          /* keep tracking through brief network blips */
        }
      }
    }, JOB_POLL_MS);
    return () => window.clearInterval(timer);
  }, [allowed, refreshSoon]);

  // Do not carry tracked jobs from one signed-in user to the next.
  useEffect(() => {
    if (!user) useBackgroundAnalysisStore.getState().clear();
  }, [user]);

  if (!allowed) return null;

  const failed = alertNotif?.type === 'progress_analysis_failed';
  return (
    <Snackbar
      open={!!alertNotif}
      autoHideDuration={12_000}
      onClose={(_e, reason) => { if (reason !== 'clickaway') setAlertNotif(null); }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        severity={failed ? 'error' : 'success'}
        variant="filled"
        onClose={() => setAlertNotif(null)}
        action={alertNotif?.link ? (
          <Button
            color="inherit"
            size="small"
            onClick={() => { const link = alertNotif.link; setAlertNotif(null); navigate(link); }}
            sx={{ fontWeight: 700, textTransform: 'none' }}
          >
            {failed ? 'Open floor' : 'Review'}
          </Button>
        ) : undefined}
        sx={{ alignItems: 'center', maxWidth: 560 }}
      >
        <strong>{alertNotif?.title}</strong>
        <br />
        {alertNotif?.body}
      </Alert>
    </Snackbar>
  );
}
