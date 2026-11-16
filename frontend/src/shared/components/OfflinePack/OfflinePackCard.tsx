import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Checkbox, LinearProgress, Typography } from '@mui/material';
import { CloudDownloadRounded, CheckCircleRounded, WarningAmberRounded, LayersRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { resolveFloorPlanForFloor } from '@store/workflowSelectors';
import {
  cleanupOrphanFiles, downloadPlanFiles, getSavedKeys, offlinePackSupported, OFFLINE_PACK_CHANGED_EVENT, savedBytes,
  sweepUntrackedFiles, verifySavedFiles, getKnownKeys, markKeysKnown,
} from '@store/offlinePlanStore';
import {
  allPlanKeys, buildFloorRows, floorStatus, keysToDownload, leavingCoverageWarnings, planMediaKeys, summariseTowers, type PlanLike,
} from '@store/offlinePack';
import { formatBytes } from '@store/storageCheck';

interface Props {
  /** Limit the pack to one project's towers. Omit for every tower the person can see. */
  projectId?: string;
  /** Shown in the heading so it is clear which project the download covers. */
  projectName?: string;
}

/**
 * "Offline site pack": save floor plans on the phone before leaving coverage, so every floor opens with no network.
 * Shown only in the Android app. Each tower says "Available offline" or "Needs download".
 */
export default function OfflinePackCard({ projectId, projectName }: Props) {
  const towers = useWorkflowStore(s => s.towers);
  const floors = useWorkflowStore(s => s.floors);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const capturePins = useWorkflowStore(s => s.capturePins);

  const [saved, setSaved] = useState<Set<string>>(() => getSavedKeys());
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [justSaved, setJustSaved] = useState<number | null>(null);
  // "Choose floors": which floors are ticked, and whether the list is open.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [known, setKnown] = useState<Set<string>>(() => getKnownKeys());

  useEffect(() => {
    const onChange = () => { setSaved(getSavedKeys()); setKnown(getKnownKeys()); };
    window.addEventListener(OFFLINE_PACK_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OFFLINE_PACK_CHANGED_EVENT, onChange);
  }, []);

  // Files that vanished from the phone (cleared cache) must stop counting as saved.
  useEffect(() => { void verifySavedFiles().then(() => sweepUntrackedFiles()); }, []);

  const scopedTowers = useMemo(
    () => towers.filter(t => !projectId || t.projectId === projectId),
    [towers, projectId],
  );
  const scopedFloors = useMemo(
    () => floors.filter(f => scopedTowers.some(t => t.id === f.towerId)),
    [floors, scopedTowers],
  );

  const planOfFloor = useCallback((floorId: string): PlanLike | undefined => {
    const floor = scopedFloors.find(f => f.id === floorId);
    if (!floor) return undefined;
    return resolveFloorPlanForFloor(floorPlans, capturePins, floor.towerId, floorId) as unknown as PlanLike | undefined;
  }, [scopedFloors, floorPlans, capturePins]);

  const summaries = useMemo(
    () => summariseTowers(scopedTowers.map(t => ({ id: t.id, name: t.name })), scopedFloors, planOfFloor, saved),
    [scopedTowers, scopedFloors, planOfFloor, saved],
  );

  const warnings = useMemo(() => leavingCoverageWarnings(summaries), [summaries]);

  const rows = useMemo(
    () => buildFloorRows(scopedTowers.map(t => ({ id: t.id, name: t.name })), scopedFloors, planOfFloor, saved, known),
    [scopedTowers, scopedFloors, planOfFloor, saved, known],
  );
  const newRows = rows.filter(r => r.isNew);

  const download = useCallback(async (floorIds: string[]) => {
    const keys = keysToDownload(floorIds, planOfFloor, getSavedKeys());
    if (!keys.length) return;
    setFailures([]);
    setJustSaved(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setFailures(['you are offline']);
      return;
    }
    setBusy({ done: 0, total: keys.length });
    try {
      const result = await downloadPlanFiles(keys, (done, total) => setBusy({ done, total }));
      // Short, de-duplicated reasons: never dump file paths on screen.
      const short = result.failed
        .map(f => (/unable to resolve host|no address associated|unknownhost|failed to connect|timed? ?out/i.test(f.reason)
          ? 'no internet connection'
          : f.reason.replace(/\/data\/user\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 70)))
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 2);
      setFailures(result.failed.length ? [`${result.failed.length} file${result.failed.length === 1 ? '' : 's'}: ${short.join('; ')}`] : []);
      setJustSaved(result.saved.length);
      // Remember every plan that exists right now: whatever is added later is what "new" means. Floors the person
      // chose not to download stay skipped (they are known, just not saved).
      markKeysKnown(allPlanKeys(scopedFloors.map(f => f.id), planOfFloor));
      // Plans that were replaced since the last download no longer need their old copy.
      // "Needed" means needed by ANY floor the person can see, not just this project's: this card is scoped to one
      // project, and treating the other projects' saved plans as leftovers deleted them (downloading project B
      // wiped the pack of project A).
      const needed = new Set<string>();
      for (const f of floors) {
        const p = resolveFloorPlanForFloor(floorPlans, capturePins, f.towerId, f.id) as unknown as PlanLike | undefined;
        if (p) planMediaKeys(p).forEach(k => needed.add(k));
      }
      await cleanupOrphanFiles(needed);
    } finally {
      setBusy(null);
      setSaved(getSavedKeys());
    }
  }, [planOfFloor, scopedFloors, floors, floorPlans, capturePins]);

  if (!offlinePackSupported()) return null;

  if (summaries.length === 0) {
    if (!projectId) return null;
    // Nothing to save for this project: say so plainly instead of showing nothing.
    const withPlan = scopedFloors.filter(f => floorStatus(planOfFloor(f.id), saved) !== 'no-plan').length;
    return (
      <Box data-testid="offline-no-plans" sx={{ mb: 3, p: 2, borderRadius: '16px', border: `1.5px dashed ${colors.border}`, backgroundColor: colors.card, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: colors.warningBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <LayersRounded sx={{ color: colors.warning, fontSize: 20 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>
            {withPlan === 0
              ? `No floor plans uploaded for ${projectName ?? 'this project'} yet`
              : 'These floor plans cannot be saved for offline use'}
          </Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>
            {withPlan === 0
              ? 'There is nothing to download. Once the admin uploads floor plans for this project, you can save them here for offline use.'
              : 'They are stored outside the app, so they need an internet connection to open.'}
          </Typography>
        </Box>
      </Box>
    );
  }

  const allFloorIds = scopedFloors.map(f => f.id);
  const totalFloors = summaries.reduce((n, t) => n + t.floors, 0);
  const totalNeeds = summaries.reduce((n, t) => n + t.needsDownload, 0);
  const allSet = totalNeeds === 0;

  return (
    <Box sx={{ mb: 3, p: 2, borderRadius: '16px', border: `1.5px solid ${allSet ? colors.border : colors.warning}`, backgroundColor: colors.card }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: allSet ? colors.successBg : colors.warningBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {allSet ? <CheckCircleRounded sx={{ color: colors.success, fontSize: 20 }} /> : <CloudDownloadRounded sx={{ color: colors.warning, fontSize: 20 }} />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 180 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>
              {projectName ? `Offline site pack · ${projectName}` : 'Offline site pack'}
            </Typography>
            {allSet && (
              <Box data-testid="downloaded-chip" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: '999px', backgroundColor: colors.successBg, color: colors.success, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.02em' }}>
                <CheckCircleRounded sx={{ fontSize: 13 }} /> Downloaded for offline use
              </Box>
            )}
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
            {allSet
              ? `All ${totalFloors} floor plans${projectName ? ' of this project' : ''} are available offline · ${formatBytes(savedBytes())} on this device`
              : `${totalFloors - totalNeeds} of ${totalFloors} floor plans${projectName ? ' of this project' : ''} are available offline`}
          </Typography>
        </Box>
        <Box
          role="button"
          aria-label="Download for Offline"
          data-testid="download-for-offline"
          onClick={() => { if (!busy) void download(allFloorIds); }}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, minHeight: 44, borderRadius: '12px',
            fontSize: '0.8125rem', fontWeight: 600, userSelect: 'none',
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
            ...(allSet
              ? { color: colors.textSecondary, border: `1.5px solid ${colors.border}`, backgroundColor: 'transparent' }
              : { color: '#fff', background: colors.primaryGradient }),
          }}
        >
          <CloudDownloadRounded sx={{ fontSize: 18 }} /> {busy ? 'Downloading…' : allSet ? 'Check again' : 'Download all'}
        </Box>
        {rows.length > 1 && (
          <Box
            role="button"
            aria-label="Choose floors to download"
            data-testid="choose-floors"
            onClick={() => {
              if (busy) return;
              setChooserOpen(o => {
                const next = !o;
                if (next) setPicked(new Set(rows.filter(r => !r.saved).map(r => r.floorId)));
                return next;
              });
            }}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, minHeight: 44, borderRadius: '12px',
              fontSize: '0.8125rem', fontWeight: 600, userSelect: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
              color: chooserOpen ? colors.primary : colors.textSecondary, border: `1.5px solid ${chooserOpen ? colors.primary : colors.border}`,
              backgroundColor: chooserOpen ? colors.primarySoft : 'transparent',
            }}
          >
            Choose floors
          </Box>
        )}
      </Box>

      {newRows.length > 0 && !busy && (
        <Box data-testid="new-plans-banner" sx={{ mt: 1.25, p: 1.25, borderRadius: '12px', backgroundColor: colors.primarySoft, border: `1px solid ${colors.primary}`, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <CloudDownloadRounded sx={{ color: colors.primary, fontSize: 20 }} />
          <Typography sx={{ flex: 1, minWidth: 160, fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>
            {newRows.length} new floor plan{newRows.length === 1 ? '' : 's'} added since your last download
          </Typography>
          <Box
            role="button"
            data-testid="download-new-plans"
            onClick={() => { if (!busy) void download(newRows.map(r => r.floorId)); }}
            sx={{ px: 1.75, py: 0.875, minHeight: 40, borderRadius: '10px', fontSize: '0.8125rem', fontWeight: 700, color: '#fff', background: colors.primaryGradient, cursor: 'pointer', userSelect: 'none' }}
          >
            Download new plans
          </Box>
        </Box>
      )}

      {chooserOpen && !busy && (
        <Box data-testid="floor-chooser" sx={{ mt: 1.25, p: 1.25, borderRadius: '12px', border: `1px solid ${colors.border}`, backgroundColor: colors.bg }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.textMuted, mb: 0.5 }}>
            Tick the floors to save on this device
          </Typography>
          {[...new Set(rows.map(r => r.towerId))].map(tid => {
            const towerRows = rows.filter(r => r.towerId === tid);
            const allTicked = towerRows.every(r => picked.has(r.floorId));
            return (
              <Box key={tid} sx={{ mb: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Checkbox
                    size="small"
                    checked={allTicked}
                    onChange={e => setPicked(prev => {
                      const next = new Set(prev);
                      towerRows.forEach(r => { if (e.target.checked) next.add(r.floorId); else next.delete(r.floorId); });
                      return next;
                    })}
                    slotProps={{ input: { 'aria-label': `Select all floors of ${towerRows[0].towerName}` } }}
                  />
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>{towerRows[0].towerName}</Typography>
                </Box>
                {towerRows.map(r => (
                  <Box key={r.floorId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 3.5 }}>
                    <Checkbox
                      size="small"
                      checked={picked.has(r.floorId)}
                      onChange={e => setPicked(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r.floorId); else next.delete(r.floorId);
                        return next;
                      })}
                      slotProps={{ input: { 'aria-label': `Select ${towerRows[0].towerName} ${r.label}` } }}
                    />
                    <Typography sx={{ flex: 1, fontSize: '0.8125rem', color: colors.textStrong }}>{r.label}</Typography>
                    {r.saved ? (
                      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.success }}>Offline</Typography>
                    ) : r.isNew ? (
                      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.primary }}>New</Typography>
                    ) : (
                      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.warning }}>Not downloaded</Typography>
                    )}
                  </Box>
                ))}
              </Box>
            );
          })}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 0.5 }}>
            <Box
              onClick={() => setChooserOpen(false)}
              sx={{ px: 1.5, py: 0.875, minHeight: 40, borderRadius: '10px', border: `1.5px solid ${colors.border}`, fontSize: '0.8125rem', fontWeight: 600, color: colors.textSecondary, cursor: 'pointer' }}
            >
              Close
            </Box>
            <Box
              role="button"
              data-testid="download-selected"
              onClick={() => {
                const ids = [...picked];
                setChooserOpen(false);
                void download(ids);
              }}
              sx={{
                px: 1.75, py: 0.875, minHeight: 40, borderRadius: '10px', fontSize: '0.8125rem', fontWeight: 700, color: '#fff',
                background: colors.primaryGradient, cursor: picked.size ? 'pointer' : 'not-allowed', opacity: picked.size ? 1 : 0.45,
                pointerEvents: picked.size ? 'auto' : 'none',
              }}
            >
              {picked.size ? `Download selected (${picked.size})` : 'Download selected'}
            </Box>
          </Box>
        </Box>
      )}

      {busy && (
        <Box data-testid="download-progress" sx={{ mt: 1.5, p: 1.5, borderRadius: '12px', backgroundColor: colors.primarySoft }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong }}>
              Downloading floor plans… {Math.min(busy.done + 1, busy.total)} of {busy.total}
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.primary }}>
              {Math.round((busy.done / Math.max(1, busy.total)) * 100)}%
            </Typography>
          </Box>
          <LinearProgress
            variant={busy.done === 0 ? 'indeterminate' : 'determinate'}
            value={Math.round((busy.done / Math.max(1, busy.total)) * 100)}
            sx={{ height: 10, borderRadius: 5 }}
          />
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.75 }}>
            Keep the app open until this finishes. Plans already saved are not lost if it stops.
          </Typography>
        </Box>
      )}

      {warnings.length > 0 && !busy && (
        <Box sx={{ mt: 1.25 }}>
          {warnings.map(w => (
            <Box key={w} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: colors.warning, fontSize: '0.8125rem', fontWeight: 600 }}>
              <WarningAmberRounded sx={{ fontSize: 16 }} /> {w}
            </Box>
          ))}
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.5 }}>Download them now, while you still have signal.</Typography>
        </Box>
      )}

      <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {summaries.map(t => (
          <Box key={t.towerId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>{t.towerName}</Typography>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: t.needsDownload ? colors.warning : colors.success }}>
              {t.needsDownload ? `Needs download (${t.needsDownload} of ${t.floors})` : 'Available offline'}
            </Typography>
            {t.needsDownload > 0 && (
              <Box
                onClick={() => { if (!busy) void download(scopedFloors.filter(f => f.towerId === t.towerId).map(f => f.id)); }}
                sx={{ px: 1.25, py: 0.375, borderRadius: '8px', border: `1.5px solid ${colors.border}`, fontSize: '0.75rem', fontWeight: 600, color: colors.textSecondary, cursor: busy ? 'default' : 'pointer', '&:hover': { borderColor: colors.primary, color: colors.primary } }}
              >
                Download
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {justSaved != null && !busy && failures.length === 0 && (
        <Box data-testid="download-done" sx={{ mt: 1.25, p: 1.25, borderRadius: '12px', backgroundColor: colors.successBg, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircleRounded sx={{ color: colors.success, fontSize: 20, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.8125rem', color: colors.success, fontWeight: 700 }}>
            {justSaved > 0
              ? `Downloaded for offline use: ${justSaved} plan file${justSaved === 1 ? '' : 's'} saved on this device. You can open these floor plans without internet, and they stay saved after app updates.`
              : 'Everything is already downloaded for offline use.'}
          </Typography>
        </Box>
      )}
      {failures.length > 0 && !busy && (
        <Typography sx={{ fontSize: '0.75rem', color: colors.danger, mt: 1 }}>
          Some plans could not be saved ({failures.join('; ')}). Check your connection and try again.
        </Typography>
      )}
    </Box>
  );
}
