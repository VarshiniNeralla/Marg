import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { CloudDownloadRounded, CheckCircleRounded, WarningAmberRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { resolveFloorPlanForFloor } from '@store/workflowSelectors';
import {
  cleanupOrphanFiles, downloadPlanFiles, getSavedKeys, offlinePackSupported, OFFLINE_PACK_CHANGED_EVENT, savedBytes,
  verifySavedFiles,
} from '@store/offlinePlanStore';
import {
  keysToDownload, leavingCoverageWarnings, planMediaKeys, summariseTowers, type PlanLike,
} from '@store/offlinePack';
import { formatBytes } from '@store/storageCheck';

interface Props {
  /** Limit the pack to one project's towers. Omit for every tower the person can see. */
  projectId?: string;
}

/**
 * "Offline site pack": save floor plans on the phone before leaving coverage, so every floor opens with no network.
 * Shown only in the Android app. Each tower says "Available offline" or "Needs download".
 */
export default function OfflinePackCard({ projectId }: Props) {
  const towers = useWorkflowStore(s => s.towers);
  const floors = useWorkflowStore(s => s.floors);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const capturePins = useWorkflowStore(s => s.capturePins);

  const [saved, setSaved] = useState<Set<string>>(() => getSavedKeys());
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [justSaved, setJustSaved] = useState<number | null>(null);

  useEffect(() => {
    const onChange = () => setSaved(getSavedKeys());
    window.addEventListener(OFFLINE_PACK_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OFFLINE_PACK_CHANGED_EVENT, onChange);
  }, []);

  // Files that vanished from the phone (cleared cache) must stop counting as saved.
  useEffect(() => { void verifySavedFiles(); }, []);

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

  const download = useCallback(async (floorIds: string[]) => {
    const keys = keysToDownload(floorIds, planOfFloor, getSavedKeys());
    if (!keys.length) return;
    setFailures([]);
    setJustSaved(null);
    setBusy({ done: 0, total: keys.length });
    try {
      const result = await downloadPlanFiles(keys, (done, total) => setBusy({ done, total }));
      // Short, de-duplicated reasons: never dump file paths on screen.
      const short = result.failed
        .map(f => f.reason.replace(/\/data\/user\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 70))
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 2);
      setFailures(result.failed.length ? [`${result.failed.length} file${result.failed.length === 1 ? '' : 's'}: ${short.join('; ')}`] : []);
      setJustSaved(result.saved.length);
      // Plans that were replaced since the last download no longer need their old copy.
      const needed = new Set<string>();
      for (const f of scopedFloors) {
        const p = planOfFloor(f.id);
        if (p) planMediaKeys(p).forEach(k => needed.add(k));
      }
      await cleanupOrphanFiles(needed);
    } finally {
      setBusy(null);
      setSaved(getSavedKeys());
    }
  }, [planOfFloor, scopedFloors]);

  if (!offlinePackSupported() || summaries.length === 0) return null;

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
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>Offline site pack</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
            {allSet
              ? `All ${totalFloors} floor plans are available offline · ${formatBytes(savedBytes())} on this phone`
              : `${totalFloors - totalNeeds} of ${totalFloors} floor plans are available offline`}
          </Typography>
        </Box>
        {!allSet && (
          <Box
            onClick={() => { if (!busy) void download(allFloorIds); }}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2, py: 1, minHeight: 40, borderRadius: '12px',
              fontSize: '0.8125rem', fontWeight: 600, color: '#fff', background: colors.primaryGradient, userSelect: 'none',
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            <CloudDownloadRounded sx={{ fontSize: 18 }} /> Download for offline
          </Box>
        )}
      </Box>

      {busy && (
        <Box sx={{ mt: 1.5 }}>
          <LinearProgress variant="determinate" value={Math.round((busy.done / Math.max(1, busy.total)) * 100)} sx={{ height: 6, borderRadius: 3 }} />
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.5 }}>Saving plan {Math.min(busy.done + 1, busy.total)} of {busy.total}…</Typography>
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
        <Typography sx={{ fontSize: '0.75rem', color: colors.success, mt: 1, fontWeight: 600 }}>
          Saved {justSaved} plan file{justSaved === 1 ? '' : 's'} on this phone.
        </Typography>
      )}
      {failures.length > 0 && !busy && (
        <Typography sx={{ fontSize: '0.75rem', color: colors.danger, mt: 1 }}>
          Some plans could not be saved ({failures.join('; ')}). Check your connection and try again.
        </Typography>
      )}
    </Box>
  );
}
