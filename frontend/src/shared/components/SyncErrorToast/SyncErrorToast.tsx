import { useEffect, useState } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { SYNC_ERROR_EVENT, SYNC_RECOVERED_EVENT } from '@store/writeQueue';

type Toast = { message: string; severity: 'warning' | 'success' };

/**
 * Global listener for backend-sync state emitted by the durable write queue.
 * A failed write that the queue gives up on surfaces a warning; once a backlog
 * of pending writes fully drains, a brief success confirms the changes synced.
 *
 * Mounted once near the app root. Debounces bursts so a batch of failed mirror
 * calls shows a single toast rather than a stack.
 */
export default function SyncErrorToast() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let lastShownAt = 0;
    function onSyncError(e: Event) {
      const detail = (e as CustomEvent).detail as { message?: string } | undefined;
      const now = Date.now();
      // Collapse rapid bursts (e.g. a multi-entity batch) into one toast.
      if (now - lastShownAt < 1500) return;
      lastShownAt = now;
      setToast({
        message: detail?.message ?? 'A change could not be saved to the server.',
        severity: 'warning',
      });
    }
    function onSyncRecovered() {
      setToast({ message: 'All changes synced.', severity: 'success' });
    }
    window.addEventListener(SYNC_ERROR_EVENT, onSyncError);
    window.addEventListener(SYNC_RECOVERED_EVENT, onSyncRecovered);
    return () => {
      window.removeEventListener(SYNC_ERROR_EVENT, onSyncError);
      window.removeEventListener(SYNC_RECOVERED_EVENT, onSyncRecovered);
    };
  }, []);

  return (
    <Snackbar
      open={!!toast}
      autoHideDuration={toast?.severity === 'success' ? 2500 : 5000}
      onClose={() => setToast(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        severity={toast?.severity ?? 'warning'}
        variant="filled"
        onClose={() => setToast(null)}
        sx={{ maxWidth: 420 }}
      >
        {toast?.message}
      </Alert>
    </Snackbar>
  );
}
