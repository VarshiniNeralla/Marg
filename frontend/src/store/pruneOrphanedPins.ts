import { useWorkflowStore } from './workflowStore';
import { fileUploadStatusForPin } from './fileUploadQueue';
import { pendingUploadPins } from './pendingUploadRegistry';

/**
 * One-time cleanup: deletes every capture pin that has zero attached
 * captures and no in-flight/queued/failed upload — across ALL floor plans,
 * not just the one currently being viewed (unlike CaptureWorkflowPage.tsx's
 * pruneEmptyPinsOnCurrentFloor, which only runs for the current floor at
 * specific moments). Meant to clear pins orphaned by past interrupted
 * sessions (e.g. a capture attempt that never completed before the app was
 * closed or the camera disconnected).
 *
 * Reuses workflowStore's deleteCapturePin for each pin, so resequencing,
 * room cleanup, and backend mirroring all follow the same safe path as a
 * manual pin delete.
 *
 * Returns the number of pins removed.
 */
export function pruneOrphanedPins(): number {
  const { capturePins, deleteCapturePin } = useWorkflowStore.getState();
  const pending = pendingUploadPins();

  const orphans = capturePins.filter(
    p =>
      p.captureIds.length === 0 &&
      !fileUploadStatusForPin(p.id) &&
      // Sync mirror — Preferences load may not have finished yet.
      !pending.has(p.id),
  );

  orphans.forEach(p => deleteCapturePin(p.id));

  return orphans.length;
}
