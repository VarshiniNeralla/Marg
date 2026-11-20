import React, { useEffect, useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup,
  TextField, Typography,
} from '@mui/material';
import { toast } from 'react-toastify';
import { colors } from '@theme/tokens';
import { constructionProgressService } from '@/services/constructionProgressService';
import { buildReviewPayload, REASON_CODES, type ReviewMode, type ReviewTarget } from '@/utils/reviewPayload';

const MODES: { value: ReviewMode; label: string; help: string }[] = [
  { value: 'accept', label: 'Accept AI assessment', help: 'The AI value is right. It is recorded as verified.' },
  { value: 'completed', label: 'Mark as completed', help: 'The work is finished (100%).' },
  { value: 'in_progress', label: 'Mark as in progress', help: 'Work has started but is not finished (1-99%).' },
  { value: 'correct', label: 'Correct', help: 'Set the exact percentage (0-100%).' },
];

export default function ActivityReviewDialog({
  open, target, activityName, onClose, onSaved,
}: {
  open: boolean;
  target: ReviewTarget | null;
  activityName: string;
  onClose: () => void;
  /** Called after a successful save; the page reloads the snapshot. */
  onSaved: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<ReviewMode>('accept');
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setMode('accept'); setPct(''); setReason(''); setNote(''); setReasonCode(''); setError(null); setSaving(false); }
  }, [open, target?.activityId, target?.roomName]);

  const needsPct = mode === 'in_progress' || mode === 'correct';

  const submit = async () => {
    if (!target) return;
    const built = buildReviewPayload(target, { mode, pct, reason, note, reasonCode });
    if (!built.ok) { setError(built.error); return; }
    setError(null);
    setSaving(true);
    try {
      await constructionProgressService.createReview(built.payload);
      toast.success('Review saved. The corrected value is kept across future analyses.');
      onClose();
      await onSaved();
    } catch {
      setError('Could not save the review. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 800 }}>
        Review: {activityName}
        {target && (
          <Typography component="div" sx={{ fontSize: '0.75rem', color: colors.textMuted, fontWeight: 500 }}>
            {target.flatName} · {target.roomName}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent>
        <RadioGroup value={mode} onChange={e => setMode(e.target.value as ReviewMode)}>
          {MODES.map(m => (
            <FormControlLabel
              key={m.value}
              value={m.value}
              control={<Radio sx={{ p: 1.25 }} />}
              sx={{ minHeight: 44, alignItems: 'flex-start', mr: 0 }}
              label={
                <Box sx={{ pt: 0.75 }}>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 700 }}>{m.label}</Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{m.help}</Typography>
                </Box>
              }
            />
          ))}
        </RadioGroup>

        {needsPct && (
          <TextField
            label={mode === 'in_progress' ? 'Percentage (1-99)' : 'Percentage (0-100)'}
            value={pct}
            onChange={e => setPct(e.target.value)}
            type="number"
            size="small"
            fullWidth
            sx={{ mt: 1.5 }}
            slotProps={{ htmlInput: { min: mode === 'in_progress' ? 1 : 0, max: mode === 'in_progress' ? 99 : 100, step: 1 } }}
          />
        )}
        {mode !== 'accept' && (
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textMuted, mb: 0.75 }}>
              What went wrong? (optional, helps improve the AI)
            </Typography>
            <Box role="radiogroup" aria-label="What went wrong" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {REASON_CODES.map(r => (
                <Chip
                  key={r.value}
                  role="radio"
                  aria-checked={reasonCode === r.value}
                  label={r.label}
                  size="small"
                  clickable
                  color={reasonCode === r.value ? 'primary' : 'default'}
                  variant={reasonCode === r.value ? 'filled' : 'outlined'}
                  onClick={() => setReasonCode(prev => (prev === r.value ? '' : r.value))}
                  sx={{ minHeight: 32 }}
                />
              ))}
            </Box>
          </Box>
        )}
        <TextField
          label="Reason (required)"
          value={reason}
          onChange={e => setReason(e.target.value)}
          size="small" fullWidth required multiline minRows={2}
          sx={{ mt: 1.5 }}
        />
        <TextField
          label="Note (optional)"
          value={note}
          onChange={e => setNote(e.target.value)}
          size="small" fullWidth multiline minRows={2}
          sx={{ mt: 1.5 }}
        />
        <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 1 }}>
          The AI estimate is kept separately and your decision is re-applied after every future analysis.
        </Typography>
        {error && (
          <Typography role="alert" sx={{ fontSize: '0.8125rem', color: colors.danger, mt: 1 }}>{error}</Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving} sx={{ minHeight: 44 }}>Cancel</Button>
        <Button onClick={submit} variant="contained" disabled={saving || !target} sx={{ minHeight: 44 }}>
          {saving ? 'Saving…' : 'Save review'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
