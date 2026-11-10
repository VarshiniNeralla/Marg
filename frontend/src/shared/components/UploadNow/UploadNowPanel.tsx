import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Checkbox, Dialog, LinearProgress, Typography } from '@mui/material';
import {
  CloudUploadRounded, CloseRounded, PauseRounded, PlayArrowRounded, CheckCircleRounded, WarningAmberRounded, RefreshRounded,
} from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import {
  getUploadMode, getUploadSession, setUploadMode, subscribeUploadSession, type UploadMode,
} from '@store/uploadHold';
import {
  gatherPreChecks, getLastUploadNowResult, pauseUploadNow, readUploadNowStatus, resumeUploadNow, startUploadNow,
  type UploadNowStatus,
} from '@store/uploadNow';
import { FILE_QUEUE_CHANGED_EVENT, resendUnconfirmedPhotos, retryFileUpload, waitingPhotoInfos } from '@store/fileUploadQueue';
import { buildReview, describeProgress, isUnsent, type PinFloor, type PreCheckResult, type ReviewSummary } from '@store/uploadPlan';
import { checkStorageRoom, describeStorage, formatBytes, type StorageRoom } from '@store/storageCheck';

const EMPTY_STATUS: UploadNowStatus = {
  phase: 'open',
  progress: { total: 0, done: 0, remaining: 0, failed: 0, percent: 100 },
  writesPending: 0,
  stitching: 0,
  unconfirmed: 0,
  failed: [],
};

/** Floor name for a point, from what is on this phone. */
function floorOfPin(pinId: string): PinFloor | undefined {
  const st = useWorkflowStore.getState();
  const pin = st.capturePins.find(p => p.id === pinId);
  if (!pin) return undefined;
  const floor = st.floors.find(f => f.id === pin.floorId);
  const tower = st.towers.find(t => t.id === pin.towerId);
  const floorName = floor?.label || (floor ? `Floor ${floor.number}` : 'Unknown floor');
  return { floorId: pin.floorId, floorName, towerId: pin.towerId, towerName: tower?.name || 'Tower' };
}

function pinName(pinId: string): string {
  const pin = useWorkflowStore.getState().capturePins.find(p => p.id === pinId);
  if (!pin) return 'Point';
  const where = pin.flatName && pin.roomName ? `${pin.flatName} · ${pin.roomName}` : pin.roomName || pin.label || '';
  return where || `Point ${pin.sequenceNumber}`;
}

export default function UploadNowPanel() {
  const session = useSyncExternalStore(subscribeUploadSession, getUploadSession, getUploadSession);
  const mode = getUploadMode();
  const [status, setStatus] = useState<UploadNowStatus>(EMPTY_STATUS);
  const [review, setReview] = useState<ReviewSummary | null>(null);
  const [pre, setPre] = useState<PreCheckResult | null>(null);
  const [room, setRoom] = useState<StorageRoom | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Floors the person UNticked. Everything is ticked by default, including floors captured later.
  const [unticked, setUnticked] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const [s, infos] = await Promise.all([readUploadNowStatus(), waitingPhotoInfos()]);
    setStatus(s);
    setReview(buildReview(infos, floorOfPin));
  }, []);

  // Keep the numbers current. Cheap (memory only), and the file queue also announces its own changes.
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    const onChange = () => void refresh();
    window.addEventListener(FILE_QUEUE_CHANGED_EVENT, onChange);
    return () => { clearInterval(t); window.removeEventListener(FILE_QUEUE_CHANGED_EVENT, onChange); };
  }, [refresh, session]);

  const runChecks = useCallback(async () => {
    setChecking(true);
    setPre(null);
    try {
      const infos = await waitingPhotoInfos();
      const bytes = infos.filter(isUnsent).reduce((n, p) => n + (p.bytes || 0), 0);
      const [p, r] = await Promise.all([gatherPreChecks(bytes), checkStorageRoom()]);
      setPre(p);
      setRoom(r);
    } finally {
      setChecking(false);
    }
  }, []);

  const openDialog = () => {
    setOpen(true);
    setNote(null);
    void refresh();
    void runChecks();
  };

  const uploading = session.phase === 'uploading';
  const waiting = review?.totalPhotos ?? 0;
  const lastResult = getLastUploadNowResult();
  const showBanner = mode === 'manual' && (waiting > 0 || uploading || status.unconfirmed > 0 || status.writesPending > 0);

  if (!showBanner && !open) return null;

  const floorsAll = review?.floors ?? [];
  const chosen = floorsAll.filter(f => !unticked.has(f.floorId));
  const chosenPhotos = chosen.reduce((n, f) => n + f.photos, 0);
  const chosenPins = chosen.flatMap(f => f.pinIds);
  const allChosen = floorsAll.length > 0 && chosen.length === floorsAll.length;
  const toggleFloors = (ids: string[], on: boolean) => setUnticked(prev => {
    const next = new Set(prev);
    ids.forEach(id => (on ? next.delete(id) : next.add(id)));
    return next;
  });
  const towerGroups = (() => {
    const m = new Map<string, { name: string; floors: typeof floorsAll }>();
    for (const f of floorsAll) {
      const k = f.towerId ?? 'other';
      if (!m.has(k)) m.set(k, { name: f.towerName ?? 'Other points', floors: [] });
      m.get(k)!.floors.push(f);
    }
    return [...m.values()];
  })();

  const onUploadNow = async () => {
    if (!pre?.canStart || chosenPhotos === 0) return;
    setStarting(true);
    try {
      await startUploadNow(allChosen ? null : chosenPins);
    } finally {
      setStarting(false);
      void refresh();
    }
  };

  const onResend = async () => {
    const n = await resendUnconfirmedPhotos();
    setNote(n ? `${n} photo${n === 1 ? '' : 's'} queued to be sent again. Tap Upload now.` : 'Nothing to send again.');
    void refresh();
  };

  const resumeLabel = !uploading && session.startedAt != null && waiting > 0;

  return (
    <>
      {showBanner && (
        <Box
          role="status"
          sx={{
            position: 'fixed', left: { xs: 12, md: 'auto' }, right: 12, bottom: 12, zIndex: 1250,
            maxWidth: { md: 420 }, borderRadius: '16px', backgroundColor: colors.card,
            border: `1.5px solid ${uploading ? colors.primary : colors.border}`,
            boxShadow: '0 12px 32px rgba(15,23,42,0.18)', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <CloudUploadRounded sx={{ color: colors.primary, fontSize: 22 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong, lineHeight: 1.25 }}>
                {uploading
                  ? `Uploading ${status.progress.done} of ${status.progress.total}`
                  : waiting > 0
                    ? `${waiting} photo${waiting === 1 ? '' : 's'} saved on this phone`
                    : status.unconfirmed > 0
                      ? `${status.unconfirmed} photo${status.unconfirmed === 1 ? '' : 's'} waiting for server confirmation`
                      : 'Changes waiting to be sent'}
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>
                {uploading
                  ? 'Keep the app open until this finishes.'
                  : resumeLabel
                    ? 'Trip in progress. Tap to review and upload when you are ready.'
                    : 'Nothing is sent until you tap Upload now.'}
              </Typography>
            </Box>
            <Box
              onClick={openDialog}
              sx={{
                px: 1.75, py: 0.875, borderRadius: '10px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                color: '#fff', background: colors.primaryGradient, '&:active': { transform: 'scale(0.97)' },
              }}
            >
              {uploading ? 'Details' : resumeLabel ? 'Resume' : 'Review'}
            </Box>
          </Box>
          {uploading && <LinearProgress variant="determinate" value={status.progress.percent} sx={{ height: 6, borderRadius: 3 }} />}
        </Box>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        sx={{ zIndex: 1600 }}
        slotProps={{ paper: { sx: { borderRadius: '20px', m: { xs: 1.5, sm: 3 }, width: { xs: 'calc(100% - 24px)' } } } }}
      >
        <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '86vh', overflowY: 'auto' }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ flex: 1, fontSize: '1.125rem', fontWeight: 700, color: colors.textStrong }}>
              {uploading ? 'Uploading your trip' : 'Upload your trip'}
            </Typography>
            <Box
              component="button" type="button" aria-label="Close" onClick={() => setOpen(false)}
              sx={{ width: 32, height: 32, p: 0, border: 'none', borderRadius: '50%', cursor: 'pointer', backgroundColor: 'transparent', color: colors.textMuted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', '&:hover': { backgroundColor: colors.bg } }}
            >
              <CloseRounded sx={{ fontSize: 20 }} />
            </Box>
          </Box>

          {/* Mode */}
          <Box>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textMuted, mb: 0.75 }}>When should photos upload?</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              {([['manual', 'When I tap', 'Nothing is sent until you tap Upload now'], ['auto', 'Automatically', 'Sent as soon as there is signal']] as [UploadMode, string, string][]).map(([m, title, sub]) => (
                <Box
                  key={m}
                  onClick={() => { if (!uploading) setUploadMode(m); }}
                  sx={{
                    p: 1.25, borderRadius: '12px', cursor: uploading ? 'default' : 'pointer', opacity: uploading && mode !== m ? 0.5 : 1,
                    border: `1.5px solid ${mode === m ? colors.primary : colors.border}`,
                    backgroundColor: mode === m ? colors.primarySoft : colors.card,
                  }}
                >
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: mode === m ? colors.primary : colors.textStrong }}>{title}</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.25 }}>{sub}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Review */}
          {!uploading && (
            <Box>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textMuted, mb: 0.75 }}>Review</Typography>
              {review && review.totalPhotos > 0 ? (
                <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: '12px', overflow: 'hidden' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.25, backgroundColor: colors.bg }}>
                    <Checkbox
                      size="small"
                      checked={allChosen}
                      indeterminate={chosen.length > 0 && !allChosen}
                      onChange={e => toggleFloors(floorsAll.map(f => f.floorId), e.target.checked)}
                      slotProps={{ input: { 'aria-label': 'Select all floors' } }}
                    />
                    <Typography sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>Select all</Typography>
                  </Box>
                  {towerGroups.map(g => {
                    const ids = g.floors.map(f => f.floorId);
                    const on = ids.filter(id => !unticked.has(id)).length;
                    return (
                      <Box key={g.name} sx={{ borderTop: `1px solid ${colors.border}` }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.25 }}>
                          <Checkbox
                            size="small"
                            checked={on === ids.length}
                            indeterminate={on > 0 && on < ids.length}
                            onChange={e => toggleFloors(ids, e.target.checked)}
                            slotProps={{ input: { 'aria-label': `Select ${g.name}` } }}
                          />
                          <Typography sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>{g.name}</Typography>
                          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, pr: 1.5 }}>
                            {g.floors.reduce((n, f) => n + f.photos, 0)} photos
                          </Typography>
                        </Box>
                        {g.floors.map(f => (
                          <Box key={f.floorId} sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 3.5, pr: 1.5, py: 0.25 }}>
                            <Checkbox
                              size="small"
                              checked={!unticked.has(f.floorId)}
                              onChange={e => toggleFloors([f.floorId], e.target.checked)}
                              slotProps={{ input: { 'aria-label': `Select ${g.name} ${f.floorName}` } }}
                            />
                            <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>{f.floorName}</Typography>
                            <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
                              {f.photos} photo{f.photos === 1 ? '' : 's'} · {formatBytes(f.bytes)}
                            </Typography>
                            {f.needsAttention > 0 && (
                              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: colors.danger, fontSize: '0.6875rem', fontWeight: 600 }}>
                                <WarningAmberRounded sx={{ fontSize: 14 }} /> {f.needsAttention}
                              </Box>
                            )}
                          </Box>
                        ))}
                      </Box>
                    );
                  })}
                  <Box sx={{ display: 'flex', px: 1.5, py: 1, backgroundColor: colors.bg, borderTop: `1px solid ${colors.border}` }}>
                    <Typography sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>Selected</Typography>
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>
                      {chosenPhotos} of {review.totalPhotos} photos · {formatBytes(chosen.reduce((n, f) => n + f.bytes, 0))}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>No photos are waiting to upload.</Typography>
              )}
              {status.writesPending > 0 && (
                <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.75 }}>
                  Also waiting: {status.writesPending} point / room change{status.writesPending === 1 ? '' : 's'}. They go first, then the photos.
                </Typography>
              )}
            </Box>
          )}

          {/* Storage */}
          {room && describeStorage(room) && (
            <Typography sx={{ fontSize: '0.75rem', color: room.level === 'ok' ? colors.textMuted : colors.warning, fontWeight: room.level === 'ok' ? 400 : 600 }}>
              {describeStorage(room)}
            </Typography>
          )}

          {/* Pre-checks */}
          {!uploading && (
            <Box>
              {checking && <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>Checking connection…</Typography>}
              {pre?.blockers.map(b => (
                <Box key={b} sx={{ display: 'flex', gap: 1, color: colors.danger, fontSize: '0.8125rem', mb: 0.5 }}>
                  <WarningAmberRounded sx={{ fontSize: 18, flexShrink: 0 }} /> {b}
                </Box>
              ))}
              {pre?.warnings.map(w => (
                <Box key={w} sx={{ display: 'flex', gap: 1, color: colors.warning, fontSize: '0.8125rem', mb: 0.5 }}>
                  <WarningAmberRounded sx={{ fontSize: 18, flexShrink: 0 }} /> {w}
                </Box>
              ))}
              {pre?.canStart && !pre.warnings.length && waiting > 0 && (
                <Box sx={{ display: 'flex', gap: 1, color: colors.success, fontSize: '0.8125rem' }}>
                  <CheckCircleRounded sx={{ fontSize: 18 }} /> Ready: connected and signed in.
                </Box>
              )}
            </Box>
          )}

          {/* Progress */}
          {uploading && (
            <Box>
              <LinearProgress variant="determinate" value={status.progress.percent} sx={{ height: 8, borderRadius: 4, mb: 1 }} />
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>
                {status.writesPending > 0
                  ? `Sending points and rooms first (${status.writesPending} left)…`
                  : describeProgress(status.progress)}
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.5 }}>
                Keep the app open and the screen on. If the signal drops, this waits and carries on by itself.
                {status.stitching > 0 ? ` ${status.stitching} photo${status.stitching === 1 ? ' is' : 's are'} being processed on the server.` : ''}
              </Typography>
            </Box>
          )}

          {/* Errors */}
          {status.failed.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.danger, mb: 0.75 }}>
                {status.failed.length} photo{status.failed.length === 1 ? '' : 's'} need attention (kept safe on this phone)
              </Typography>
              <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: '12px', overflow: 'hidden' }}>
                {status.failed.map((f, i) => (
                  <Box key={f.pinId} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderTop: i ? `1px solid ${colors.border}` : 'none' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>{pinName(f.pinId)}</Typography>
                      <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>{f.message}</Typography>
                    </Box>
                    {f.failKind !== 'corrupt' && (
                      <Box onClick={() => { retryFileUpload(f.pinId); void refresh(); }} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.5, borderRadius: '8px', border: `1.5px solid ${colors.border}`, fontSize: '0.75rem', fontWeight: 600, color: colors.textSecondary, cursor: 'pointer', '&:hover': { borderColor: colors.primary, color: colors.primary } }}>
                        <RefreshRounded sx={{ fontSize: 15 }} /> Retry
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
              <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.5 }}>
                Damaged photos cannot be sent. Open the point on the floor plan and tap Capture Again.
              </Typography>
            </Box>
          )}

          {/* Result of the last upload */}
          {!uploading && lastResult && (
            <Box sx={{ p: 1.5, borderRadius: '12px', backgroundColor: lastResult.release.missing || lastResult.failed || lastResult.release.skipped ? colors.warningBg : colors.successBg }}>
              <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>
                {lastResult.release.missing === 0 && !lastResult.failed && !lastResult.release.skipped
                  ? 'All photos are safely on the server.'
                  : 'Upload finished, but not everything is confirmed yet.'}
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>
                {lastResult.release.confirmed} confirmed and cleared from this phone
                {lastResult.release.missing ? ` · ${lastResult.release.missing} kept on this phone until the server confirms them` : ''}
                {lastResult.release.skipped ? ' · the final check could not run (connection), so nothing was deleted' : ''}
                {lastResult.failed ? ` · ${lastResult.failed} need attention` : ''}.
              </Typography>
            </Box>
          )}
          {!uploading && status.unconfirmed > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography sx={{ flex: 1, fontSize: '0.75rem', color: colors.textMuted }}>
                {status.unconfirmed} photo{status.unconfirmed === 1 ? ' is' : 's are'} still kept on this phone until the server confirms an exact copy. Do not clear the app or format the camera card yet.
              </Typography>
              <Box onClick={onResend} sx={{ px: 1.25, py: 0.5, borderRadius: '8px', border: `1.5px solid ${colors.border}`, fontSize: '0.75rem', fontWeight: 600, color: colors.textSecondary, cursor: 'pointer', '&:hover': { borderColor: colors.primary, color: colors.primary } }}>
                Send again
              </Box>
            </Box>
          )}
          {note && <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{note}</Typography>}

          {/* Actions */}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {uploading ? (
              <Box onClick={() => void pauseUploadNow()} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, minHeight: 42, borderRadius: '12px', border: `1.5px solid ${colors.border}`, fontSize: '0.875rem', fontWeight: 600, color: colors.textSecondary, cursor: 'pointer' }}>
                <PauseRounded sx={{ fontSize: 18 }} /> Pause
              </Box>
            ) : (
              <>
                {session.batchTotal > 0 && waiting > 0 && (
                  <Box onClick={() => { void resumeUploadNow(); }} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, minHeight: 42, borderRadius: '12px', border: `1.5px solid ${colors.border}`, fontSize: '0.875rem', fontWeight: 600, color: colors.textSecondary, cursor: 'pointer' }}>
                    <PlayArrowRounded sx={{ fontSize: 18 }} /> Resume
                  </Box>
                )}
                <Box
                  onClick={() => { if (!starting && !checking && pre?.canStart && chosenPhotos > 0) void onUploadNow(); }}
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.5, py: 1, minHeight: 42, borderRadius: '12px',
                    fontSize: '0.875rem', fontWeight: 600, color: '#fff', userSelect: 'none',
                    background: colors.primaryGradient, boxShadow: '0 3px 10px rgba(37,99,235,0.28)',
                    cursor: pre?.canStart && chosenPhotos > 0 ? 'pointer' : 'not-allowed',
                    opacity: pre?.canStart && chosenPhotos > 0 ? 1 : 0.45,
                  }}
                >
                  <CloudUploadRounded sx={{ fontSize: 18 }} /> {allChosen || chosenPhotos === 0 ? 'Upload now' : `Upload selected (${chosenPhotos})`}
                </Box>
              </>
            )}
          </Box>
        </Box>
      </Dialog>
    </>
  );
}
