import React, { useEffect, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { describeTripResult, UPLOAD_TRIP_COMPLETE_EVENT, type TripCompleteDetail } from '@store/uploadCompletion';

function homeFor(role?: string): string {
  if (role === 'admin' || role === 'super_admin') return '/dashboard/admin';
  if (role === 'manager') return '/dashboard/manager';
  return '/dashboard/engineer';
}

/**
 * Tells the person, once, that the whole trip has been uploaded AND processed by the server: a message at the top of
 * the screen (never blocking) plus one entry in the notification bell. Mounted once in the dashboard layout so it
 * works on whatever page the person is on.
 */
export default function UploadCompletionNotice() {
  const [msg, setMsg] = useState<{ title: string; body: string; ok: boolean } | null>(null);

  useEffect(() => {
    const onDone = (e: Event) => {
      const detail = (e as CustomEvent<TripCompleteDetail>).detail;
      if (!detail) return;
      const result = describeTripResult(detail);
      setMsg(result);
      useWorkflowStore.getState().notifyTripUploaded(result.title, result.body, homeFor(useAuthStore.getState().user?.role));
    };
    window.addEventListener(UPLOAD_TRIP_COMPLETE_EVENT, onDone);
    return () => window.removeEventListener(UPLOAD_TRIP_COMPLETE_EVENT, onDone);
  }, []);

  return (
    <Snackbar
      open={!!msg}
      autoHideDuration={12_000}
      onClose={(_e, reason) => { if (reason !== 'clickaway') setMsg(null); }}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{ zIndex: 1700 }}
    >
      <Alert severity={msg?.ok === false ? 'warning' : 'success'} variant="filled" onClose={() => setMsg(null)} sx={{ width: '100%', maxWidth: 520 }}>
        <strong>{msg?.title}</strong>
        <br />
        {msg?.body}
      </Alert>
    </Snackbar>
  );
}
