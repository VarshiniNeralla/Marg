import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Snackbar } from '@mui/material';
import { useAuthStore, isManagerOrAdmin } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { useBackgroundAnalysisStore } from '@store/backgroundAnalysis';
import { notificationService } from '@/services/notificationService';
import { isActiveStatus } from '@/utils/analysisProgress';
import type { MockNotification, NotifType } from '@/data/mockData';

const IDLE_POLL_MS = 30_000;   // nothing running: a slow check is enough
const ACTIVE_POLL_MS = 5_000;  // something is running: notice completion quickly
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
 * Keeps the app-wide background-analysis state fresh and delivers the "ready for review" alert.
 * Mounted once in the dashboard layout so it keeps working when the user navigates away from
 * the Construction Progress page. Renders nothing except a snackbar.
 */
export default function BackgroundAnalysisWatcher() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const allowed = isManagerOrAdmin(user);
  const [alertNotif, setAlertNotif] = useState<MockNotification | null>(null);
  const refreshing = useRef(false);
  const jobs = useBackgroundAnalysisStore(s => s.jobs);
  const hasActive = jobs.some(j => isActiveStatus(j.status));
  const prevActiveIds = useRef<Set<string>>(new Set());

  const refreshNotifications = useCallback(async () => {
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
  const refreshNotificationsSoon = useCallback(() => {
    void refreshNotifications();
    window.setTimeout(() => void refreshNotifications(), 1_500);
    window.setTimeout(() => void refreshNotifications(), 6_000);
  }, [refreshNotifications]);

  // 1) Notifications: slow poll, plus refresh whenever the tab/app comes back to the foreground.
  useEffect(() => {
    if (!allowed) return;
    void refreshNotifications();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    }, IDLE_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshNotifications(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [allowed, refreshNotifications]);

  // 2) The job list behind the status indicator: 5s while something runs, 30s otherwise.
  //    Re-created when a run starts or ends, so a freshly started run is picked up at once.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        await useBackgroundAnalysisStore.getState().refresh();
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    void tick();
    const onVisible = () => { if (document.visibilityState === 'visible') void useBackgroundAnalysisStore.getState().refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [allowed, hasActive]);

  // 3) A run that was active and no longer is has just finished: fetch its notification now.
  useEffect(() => {
    const nowActive = new Set(jobs.filter(j => isActiveStatus(j.status)).map(j => j.jobId));
    if ([...prevActiveIds.current].some(id => !nowActive.has(id))) refreshNotificationsSoon();
    prevActiveIds.current = nowActive;
  }, [jobs, refreshNotificationsSoon]);

  // Do not carry one signed-in user's state to the next.
  useEffect(() => {
    if (!user) {
      prevActiveIds.current = new Set(); // clearing the list is not "a run finished"
      useBackgroundAnalysisStore.getState().clear();
    }
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
