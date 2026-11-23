import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Radio, RadioGroup, Typography,
} from '@mui/material';
import { toast } from 'react-toastify';
import { colors } from '@theme/tokens';
import { useFloorScope, useSaveFloorScope } from '@/hooks/useActivityScope';
import type { FloorScope, ScopeApplyTo, ScopeCatalogItem } from '@/services/constructionProgressService';
import { activityDisplayName } from '@/utils/activityNames';
import { APPLY_OPTIONS, applyOption } from '@/utils/scopeApply';
import { needsRerun, sameSet, scopeDiff, toggleId } from '@/utils/scopeDiff';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827' };

export interface ChooseActivitiesDialogProps {
  open: boolean;
  onClose: () => void;
  floorId: string | undefined;
  /** Managers and admins can change the list. Everyone else sees it read-only. */
  canEdit: boolean;
  /** Activity ids the last analysis used (snapshot.activityScope). Missing = everything. */
  analysedScope?: string[] | null;
  /** Server flag from the snapshot. */
  scopeChangedSinceAnalysis?: boolean;
  /** False while the floor has never been analysed: there is no "run again" to talk about. Default true. */
  hasAnalysis?: boolean;
  /**
   * Called after the list was saved when the user pressed "Save and analyse". The page starts the analysis that
   * matches `applyTo` (this floor, the tower or the project). Errors are the page's to report.
   */
  onAnalyse?: (info: { applyTo: ScopeApplyTo; scope: FloorScope }) => void | Promise<void>;
}

const SECTIONS: { id: 'flat' | 'common'; label: string }[] = [
  { id: 'flat', label: 'Flat' },
  { id: 'common', label: 'Common Area' },
];

function errorText(err: unknown): string {
  const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
  return e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Could not save the list.';
}

const SECTION_TITLE_SX = {
  fontSize: '0.6875rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase',
  letterSpacing: '0.06em', mb: 0.75,
} as const;

export default function ChooseActivitiesDialog({
  open, onClose, floorId, canEdit, analysedScope, scopeChangedSinceAnalysis, hasAnalysis = true, onAnalyse,
}: ChooseActivitiesDialogProps) {
  const { data: scope, isLoading, isError, refetch } = useFloorScope(open ? floorId : undefined);
  const save = useSaveFloorScope(floorId);
  const [selected, setSelected] = useState<string[]>([]);
  const [applyTo, setApplyTo] = useState<ScopeApplyTo>('floor');

  const catalog: ScopeCatalogItem[] = useMemo(() => scope?.catalog ?? [], [scope]);
  const allIds = useMemo(() => catalog.map(c => c.activityId), [catalog]);

  // Start from what the server has (default: everything ticked) each time the dialog opens or the data arrives.
  useEffect(() => {
    if (open && scope) {
      setSelected(scope.activityIds?.length ? scope.activityIds : allIds);
      setApplyTo('floor');
    }
  }, [open, scope, allIds]);

  const savedIds = scope?.activityIds?.length ? scope.activityIds : allIds;
  const dirty = !sameSet(selected, savedIds);
  const diff = scopeDiff(savedIds, analysedScope, allIds);
  const showRerun = hasAnalysis && needsRerun(scopeChangedSinceAnalysis, diff);
  const none = selected.length === 0;
  const chosen = applyOption(applyTo);
  // A tower or project run needs to know where this floor sits. Without it, only "this floor" can be analysed.
  const missingLocation = applyTo === 'tower' ? !scope?.towerId : applyTo === 'project' ? !scope?.projectId : false;

  const handleSave = async (thenAnalyse: boolean) => {
    if (!canEdit || none || save.isPending) return;
    let saved: FloorScope;
    try {
      saved = await save.mutateAsync({ activityIds: selected, applyTo });
    } catch (err) {
      toast.error(errorText(err));
      return;
    }
    onClose();
    if (thenAnalyse && onAnalyse) {
      toast.success('Activity list saved.');
      await onAnalyse({ applyTo, scope: saved });
    } else {
      toast.success(hasAnalysis ? 'Activity list saved. Run analysis again to apply.' : 'Activity list saved.');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="choose-activities-title">
      <DialogTitle id="choose-activities-title" sx={{ fontWeight: 800, pb: 0.5 }}>
        {canEdit ? 'Choose activities to view progress for' : 'Choose activities'}
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: P.border }}>
        <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mb: 1.5 }}>
          {canEdit
            ? 'First pick where this applies, then tick the activities the AI should check in the 360 photos. Unticked ones are left out of every total.'
            : 'These are the activities the analysis looks at on this floor. Only a manager or admin can change them.'}
        </Typography>

        {showRerun && (
          <Alert severity="info" sx={{ mb: 1.5 }} data-testid="scope-rerun-note">
            The list changed since the last analysis. Run analysis again to apply.
          </Alert>
        )}

        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={26} /></Box>
        )}

        {isError && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void refetch()}>Retry</Button>}>
            Could not load the activity list.
          </Alert>
        )}

        {scope && (
          <>
            {canEdit && (
              <Box sx={{ mb: 2.25 }} data-testid="apply-to-step">
                <Typography sx={SECTION_TITLE_SX}>1. Where should this apply?</Typography>
                <RadioGroup
                  value={applyTo}
                  onChange={e => setApplyTo(e.target.value as ScopeApplyTo)}
                  aria-label="Where should this apply"
                >
                  {APPLY_OPTIONS.map(opt => {
                    const active = opt.value === applyTo;
                    return (
                      <Box
                        key={opt.value}
                        sx={{
                          mb: 0.75, px: 1.25, py: 0.5, borderRadius: '10px',
                          border: `1.5px solid ${active ? colors.primary : P.border}`,
                          backgroundColor: active ? colors.primarySoft : '#fff',
                        }}
                      >
                        <FormControlLabel
                          value={opt.value}
                          control={<Radio size="small" />}
                          sx={{ display: 'flex', alignItems: 'flex-start', mr: 0, ml: 0 }}
                          label={(
                            <Box sx={{ pt: 0.5 }}>
                              <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong }}>{opt.title}</Typography>
                              <Typography sx={{ fontSize: '0.75rem', color: P.muted, lineHeight: 1.4 }}>{opt.help}</Typography>
                            </Box>
                          )}
                        />
                      </Box>
                    );
                  })}
                </RadioGroup>
                {missingLocation && (
                  <Typography sx={{ fontSize: '0.75rem', color: colors.danger, mt: 0.5 }}>
                    We could not find which {applyTo === 'tower' ? 'tower' : 'project'} this floor belongs to, so this choice is not available.
                  </Typography>
                )}
              </Box>
            )}

            <Typography sx={SECTION_TITLE_SX}>{canEdit ? '2. Which activities?' : 'Activities'}</Typography>
            {canEdit && (
              <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                <Button size="small" onClick={() => setSelected(allIds)} sx={{ textTransform: 'none', fontWeight: 600 }}>Select all</Button>
                <Button size="small" onClick={() => setSelected([])} sx={{ textTransform: 'none', fontWeight: 600 }}>Clear</Button>
                <Typography sx={{ ml: 'auto', alignSelf: 'center', fontSize: '0.75rem', color: P.muted }}>
                  {selected.length} of {allIds.length} selected
                </Typography>
              </Box>
            )}

            {SECTIONS.map(sec => {
              const items = catalog.filter(c => c.section === sec.id);
              if (!items.length) return null;
              const shown = canEdit ? items : items.filter(c => selected.includes(c.activityId));
              return (
                <Box key={sec.id} sx={{ mb: 2 }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.strong, mb: 0.25 }}>
                    {sec.label}
                  </Typography>
                  {shown.length === 0 && (
                    <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>None selected</Typography>
                  )}
                  {shown.map(item => (
                    <Box key={item.activityId} sx={{ display: 'block' }}>
                      {canEdit ? (
                        <FormControlLabel
                          sx={{ display: 'flex', mr: 0, '& .MuiFormControlLabel-label': { fontSize: '0.875rem' } }}
                          control={(
                            <Checkbox
                              size="small"
                              checked={selected.includes(item.activityId)}
                              onChange={() => setSelected(s => toggleId(s, item.activityId))}
                              slotProps={{ input: { 'aria-label': activityDisplayName(item.activityId, item.name) } }}
                            />
                          )}
                          label={activityDisplayName(item.activityId, item.name)}
                        />
                      ) : (
                        <Typography sx={{ fontSize: '0.875rem', color: P.strong, py: 0.5 }}>
                          {activityDisplayName(item.activityId, item.name)}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              );
            })}

            {canEdit && none && (
              <Typography sx={{ fontSize: '0.75rem', color: colors.danger, mt: 0.5 }}>
                Pick at least one activity.
              </Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 600, color: P.muted }}>
          {canEdit ? 'Cancel' : 'Close'}
        </Button>
        {canEdit && (
          <>
            <Button
              onClick={() => void handleSave(false)}
              disabled={!scope || none || save.isPending || missingLocation || (!dirty && applyTo === 'floor')}
              sx={{
                border: `1.5px solid ${P.border}`, color: P.strong, px: 2.25, borderRadius: '10px',
                fontWeight: 700, textTransform: 'none',
                '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
              }}
            >
              Save
            </Button>
            {onAnalyse && (
              <Button
                onClick={() => void handleSave(true)}
                disabled={!scope || none || save.isPending || missingLocation}
                startIcon={save.isPending ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : undefined}
                sx={{
                  background: colors.primaryGradient, color: '#fff', px: 2.5, borderRadius: '10px',
                  fontWeight: 700, textTransform: 'none',
                  '&.Mui-disabled': { color: 'rgba(255,255,255,0.85)', opacity: 0.6 },
                }}
              >
                {chosen.analyseLabel}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
