import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Modal,
  IconButton,
  Radio,
  RadioGroup,
  FormControlLabel,
  TextField,
  Collapse,
  CircularProgress,
  MenuItem,
  Select,
  Button,
  type SelectChangeEvent,
} from '@mui/material';
import { CloseRounded, CheckRounded, ClearRounded, ExpandMoreRounded } from '@mui/icons-material';
import { toast } from 'react-toastify';
import { colors } from '@theme/tokens';
import {
  constructionProgressService,
  type PinRoomVerdict,
  type ProgressReviewCreate,
  type RoomActivityAssessment,
  type RoomCorrectVerdict,
  type RoomProgress,
} from '@/services/constructionProgressService';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

const OTHER_ROOM_VALUE = '__other__';

export type ReviewRoomOption = {
  flatName: string;
  roomName: string;
};

export type ReviewTarget = {
  snapshotId: string;
  floorId: string;
  flatName: string;
  room: RoomProgress;
};

type Props = {
  open: boolean;
  target: ReviewTarget | null;
  /** Prefer live latest snapshot id so submit survives a re-analyze. */
  liveSnapshotId?: string;
  /** Rooms on this floor the pin might actually belong to (same + other flats). */
  roomOptions?: ReviewRoomOption[];
  onClose: () => void;
  onSubmitted: (reviewKey: string) => void;
};

type PinRoomAnswer = {
  roomCorrect: RoomCorrectVerdict;
  selectedRoomValue: string;
  otherRoomText: string;
};

type DraftState = {
  pinAnswers: Record<number, PinRoomAnswer>;
  fallbackAnswer: PinRoomAnswer;
  progressVerdict: 'correct' | 'mostly_correct' | 'wrong';
  note: string;
  showActivities: boolean;
  activityVerdicts: Record<string, 'correct' | 'wrong' | undefined>;
  activityCorrectPct: Record<string, string>;
  activityReasons: Record<string, string>;
};

/** Survives dialog close so drafts don't disappear mid-review session. */
const reviewDrafts = new Map<string, DraftState>();

function optionValue(o: ReviewRoomOption): string {
  return `${o.flatName}::${o.roomName}`;
}

function emptyPinAnswer(): PinRoomAnswer {
  return { roomCorrect: 'yes', selectedRoomValue: '', otherRoomText: '' };
}

function draftKeyFor(target: ReviewTarget): string {
  return `${target.floorId}::${target.flatName}::${target.room.roomName}`;
}

function resolveActualRoom(answer: PinRoomAnswer): string | undefined {
  if (answer.roomCorrect !== 'no') return undefined;
  if (answer.selectedRoomValue === OTHER_ROOM_VALUE) {
    return answer.otherRoomText.trim() || undefined;
  }
  if (!answer.selectedRoomValue) return undefined;
  const parts = answer.selectedRoomValue.split('::');
  const roomName = parts.slice(1).join('::');
  return roomName || answer.selectedRoomValue;
}

function initPins(pinNumbers: number[]): Record<number, PinRoomAnswer> {
  const next: Record<number, PinRoomAnswer> = {};
  for (const n of pinNumbers) next[n] = emptyPinAnswer();
  return next;
}

/**
 * Human accuracy review dialog. Drafts persist across close/reopen for the
 * same floor+flat+room until a successful submit.
 */
export default function ProgressReviewDialog({
  open,
  target,
  liveSnapshotId,
  roomOptions = [],
  onClose,
  onSubmitted,
}: Props) {
  const [pinAnswers, setPinAnswers] = useState<Record<number, PinRoomAnswer>>({});
  const [fallbackAnswer, setFallbackAnswer] = useState<PinRoomAnswer>(emptyPinAnswer());
  const [progressVerdict, setProgressVerdict] = useState<'correct' | 'mostly_correct' | 'wrong'>('correct');
  const [note, setNote] = useState('');
  const [showActivities, setShowActivities] = useState(false);
  const [activityVerdicts, setActivityVerdicts] = useState<Record<string, 'correct' | 'wrong' | undefined>>({});
  const [activityCorrectPct, setActivityCorrectPct] = useState<Record<string, string>>({});
  const [activityReasons, setActivityReasons] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const loadedKeyRef = useRef<string | null>(null);

  const activities: RoomActivityAssessment[] = useMemo(
    () => target?.room.activities ?? [],
    [target],
  );

  const pinNumbers = useMemo(
    () => (target?.room.pinNumbers ?? []).filter(n => Number.isFinite(n)),
    [target],
  );

  const draftKey = target ? draftKeyFor(target) : null;

  const selectableRooms = useMemo(() => {
    if (!target) return [] as ReviewRoomOption[];
    return roomOptions.filter(
      o => o.flatName === target.flatName && o.roomName !== target.room.roomName,
    );
  }, [roomOptions, target]);

  function snapshotDraft(): DraftState {
    return {
      pinAnswers,
      fallbackAnswer,
      progressVerdict,
      note,
      showActivities,
      activityVerdicts,
      activityCorrectPct,
      activityReasons,
    };
  }

  function applyDraft(draft: DraftState) {
    setPinAnswers(draft.pinAnswers);
    setFallbackAnswer(draft.fallbackAnswer);
    setProgressVerdict(draft.progressVerdict);
    setNote(draft.note);
    setShowActivities(draft.showActivities);
    setActivityVerdicts(draft.activityVerdicts);
    setActivityCorrectPct(draft.activityCorrectPct);
    setActivityReasons(draft.activityReasons);
  }

  // Restore draft (or init) when opening a room — never wipe an existing draft.
  useEffect(() => {
    if (!open || !target || !draftKey) return;
    if (loadedKeyRef.current === draftKey) return;
    loadedKeyRef.current = draftKey;
    setFormError(null);

    const saved = reviewDrafts.get(draftKey);
    if (saved) {
      applyDraft(saved);
      return;
    }

    const pins = (target.room.pinNumbers ?? []).filter(n => Number.isFinite(n));
    setPinAnswers(initPins(pins));
    setFallbackAnswer(emptyPinAnswer());
    setProgressVerdict('correct');
    setNote('');
    setShowActivities(false);
    setActivityVerdicts({});
    setActivityCorrectPct({});
    setActivityReasons({});
  }, [open, draftKey, target]);

  function handleClose() {
    if (draftKey) {
      reviewDrafts.set(draftKey, snapshotDraft());
    }
    setFormError(null);
    loadedKeyRef.current = null;
    onClose();
  }

  function updatePinAnswer(pin: number, patch: Partial<PinRoomAnswer>) {
    setFormError(null);
    setPinAnswers(prev => {
      const cur = prev[pin] ?? emptyPinAnswer();
      const next = { ...cur, ...patch };
      if (patch.roomCorrect === 'yes') {
        next.selectedRoomValue = '';
        next.otherRoomText = '';
      }
      return { ...prev, [pin]: next };
    });
  }

  function updateFallbackAnswer(patch: Partial<PinRoomAnswer>) {
    setFormError(null);
    setFallbackAnswer(prev => {
      const next = { ...prev, ...patch };
      if (patch.roomCorrect === 'yes') {
        next.selectedRoomValue = '';
        next.otherRoomText = '';
      }
      return next;
    });
  }

  function fail(message: string) {
    setFormError(message);
    toast.error(message);
  }

  async function handleSubmit() {
    if (!target || submitting) return;

    let roomCorrect: RoomCorrectVerdict = 'yes';
    let actualRoom: string | undefined;
    let pinRoomVerdicts: PinRoomVerdict[] | undefined;

    if (pinNumbers.length > 0) {
      const verdicts: PinRoomVerdict[] = [];
      for (const pin of pinNumbers) {
        const answer = pinAnswers[pin] ?? emptyPinAnswer();
        const pinActual = resolveActualRoom(answer);
        if (answer.roomCorrect === 'no' && !pinActual) {
          fail(`Select or type the room Pin ${pin} should actually map to.`);
          return;
        }
        verdicts.push({
          pinNumber: pin,
          roomCorrect: answer.roomCorrect,
          actualRoom: pinActual,
        });
      }
      pinRoomVerdicts = verdicts;
      const anyNo = verdicts.some(v => v.roomCorrect === 'no');
      roomCorrect = anyNo ? 'no' : 'yes';
      actualRoom = verdicts.find(v => v.roomCorrect === 'no')?.actualRoom;
    } else {
      actualRoom = resolveActualRoom(fallbackAnswer);
      if (fallbackAnswer.roomCorrect === 'no' && !actualRoom) {
        fail('Select or type the room this pin should actually map to.');
        return;
      }
      roomCorrect = fallbackAnswer.roomCorrect;
    }

    const marked = Object.entries(activityVerdicts).filter(
      ([, v]) => v === 'correct' || v === 'wrong',
    );
    for (const [activityId, verdict] of marked) {
      const name = activities.find(a => a.activityId === activityId)?.activityName ?? activityId;
      const aiPct = activities.find(a => a.activityId === activityId)?.completionPct;
      let pctRaw = (activityCorrectPct[activityId] ?? '').trim();
      if (pctRaw === '' && verdict === 'correct' && aiPct != null) {
        pctRaw = String(Math.round(aiPct));
      }
      const reason = (activityReasons[activityId] ?? '').trim();
      const pct = pctRaw === '' ? NaN : Number(pctRaw);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        fail(`Enter a correct percentage (0–100) for "${name}".`);
        setShowActivities(true);
        return;
      }
      if (!reason) {
        fail(`Enter a reason for marking "${name}" as ${verdict}.`);
        setShowActivities(true);
        return;
      }
    }

    const snapshotId = (liveSnapshotId || target.snapshotId || '').trim();
    if (!snapshotId) {
      fail('Missing snapshot id — reload the floor report and try again.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const payload: ProgressReviewCreate = {
        snapshotId,
        floorId: target.floorId,
        flatName: target.flatName,
        roomName: target.room.roomName,
        pinNumbers: pinNumbers,
        roomCorrect,
        actualRoom,
        pinRoomVerdicts,
        progressVerdict,
        activityCorrections: marked.map(([activityId, verdict]) => {
          const aiPct = activities.find(a => a.activityId === activityId)?.completionPct;
          let pctRaw = (activityCorrectPct[activityId] ?? '').trim();
          if (pctRaw === '' && verdict === 'correct' && aiPct != null) {
            pctRaw = String(Math.round(aiPct));
          }
          return {
            activityId,
            verdict: verdict!,
            correctPercentage: Number(pctRaw),
            note: (activityReasons[activityId] ?? '').trim(),
          };
        }),
        note: note.trim() || undefined,
      };
      await constructionProgressService.createReview(payload);
      if (draftKey) reviewDrafts.delete(draftKey);
      toast.success('Review saved');
      onSubmitted(`${target.flatName}::${target.room.roomName}`);
      loadedKeyRef.current = null;
      onClose();
    } catch (err) {
      const e = err as {
        response?: { data?: { message?: string; detail?: string }; status?: number };
        message?: string;
      };
      const msg =
        e?.response?.data?.message
        || e?.response?.data?.detail
        || e?.message
        || 'Could not save review';
      fail(typeof msg === 'string' ? msg : 'Could not save review');
    } finally {
      setSubmitting(false);
    }
  }

  if (!target) return null;

  const headerPinLabel = pinNumbers.length
    ? `Pin${pinNumbers.length === 1 ? '' : 's'} ${pinNumbers.join(', ')}`
    : null;

  function renderRoomCorrection(answer: PinRoomAnswer, pinLabel: string, onChange: (patch: Partial<PinRoomAnswer>) => void) {
    if (answer.roomCorrect !== 'no') return null;
    return (
      <Box sx={{ mt: 1, mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.75rem', color: P.muted, mb: 0.75 }}>
          Where should {pinLabel} actually fall?
        </Typography>
        <Select
          size="small"
          fullWidth
          displayEmpty
          value={answer.selectedRoomValue}
          onChange={(e: SelectChangeEvent) => onChange({ selectedRoomValue: e.target.value })}
          sx={{ borderRadius: '8px', fontSize: '0.875rem', mb: answer.selectedRoomValue === OTHER_ROOM_VALUE ? 1 : 0 }}
        >
          <MenuItem value="" disabled>
            <em>Select the correct room…</em>
          </MenuItem>
          {selectableRooms.map(o => (
            <MenuItem key={optionValue(o)} value={optionValue(o)}>
              {o.roomName}
            </MenuItem>
          ))}
          <MenuItem value={OTHER_ROOM_VALUE}>Other (type name)…</MenuItem>
        </Select>
        {answer.selectedRoomValue === OTHER_ROOM_VALUE && (
          <TextField
            size="small"
            fullWidth
            label="Correct room name"
            placeholder="e.g. Kitchen, Utility, Sit-Out"
            value={answer.otherRoomText}
            onChange={e => onChange({ otherRoomText: e.target.value })}
          />
        )}
      </Box>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box sx={{
        width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto',
        backgroundColor: P.white, borderRadius: '16px', p: 3, outline: 'none',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 2 }}>
          <Box>
            <Typography sx={{ fontSize: '1.0625rem', fontWeight: 700, color: P.strong }}>
              {target.room.roomName}
              <Box component="span" sx={{ fontWeight: 500, color: P.muted }}>
                {' '}· {target.flatName}{headerPinLabel ? ` · ${headerPinLabel}` : ''}
              </Box>
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: P.muted, mt: 0.25 }}>
              Draft is kept if you close — submit to save. Corrections apply to the live report.
            </Typography>
          </Box>
          <IconButton onClick={handleClose} size="small" aria-label="Close review">
            <CloseRounded sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>

        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.strong, mb: 0.75 }}>
          1  Is this the correct room?
        </Typography>

        {pinNumbers.length > 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
            {pinNumbers.map(pin => {
              const answer = pinAnswers[pin] ?? emptyPinAnswer();
              const label = `Pin ${pin}`;
              return (
                <Box
                  key={pin}
                  sx={{
                    border: `1px solid ${P.border}`,
                    borderRadius: '10px',
                    px: 1.5,
                    py: 1.25,
                  }}
                >
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, mb: 0.5 }}>
                    Is this the correct room for {label}?
                  </Typography>
                  <RadioGroup
                    row
                    value={answer.roomCorrect}
                    onChange={(_, v) => updatePinAnswer(pin, { roomCorrect: v as RoomCorrectVerdict })}
                  >
                    <FormControlLabel value="yes" control={<Radio size="small" />} label="Yes" />
                    <FormControlLabel value="no" control={<Radio size="small" />} label="No" />
                  </RadioGroup>
                  {renderRoomCorrection(answer, label, patch => updatePinAnswer(pin, patch))}
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: '0.8125rem', color: P.strong, mb: 0.5 }}>
              Is this the correct room for this pin?
            </Typography>
            <RadioGroup
              row
              value={fallbackAnswer.roomCorrect}
              onChange={(_, v) => updateFallbackAnswer({ roomCorrect: v as RoomCorrectVerdict })}
              sx={{ mb: 0.5 }}
            >
              <FormControlLabel value="yes" control={<Radio size="small" />} label="Yes" />
              <FormControlLabel value="no" control={<Radio size="small" />} label="No" />
            </RadioGroup>
            {renderRoomCorrection(fallbackAnswer, 'this pin', updateFallbackAnswer)}
          </Box>
        )}

        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.strong, mb: 0.75 }}>
          2  Is the progress mapping correct?
        </Typography>
        <RadioGroup
          row
          value={progressVerdict}
          onChange={(_, v) => { setFormError(null); setProgressVerdict(v as 'correct' | 'mostly_correct' | 'wrong'); }}
          sx={{ mb: 2 }}
        >
          <FormControlLabel value="correct" control={<Radio size="small" />} label="Correct" />
          <FormControlLabel value="mostly_correct" control={<Radio size="small" />} label="Mostly correct" />
          <FormControlLabel value="wrong" control={<Radio size="small" />} label="Wrong" />
        </RadioGroup>

        <Box
          onClick={() => setShowActivities(v => !v)}
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', py: 0.75, mb: 0.5,
          }}
        >
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.strong }}>
            3  Optional — mark individual activities
          </Typography>
          <ExpandMoreRounded sx={{
            fontSize: 20, color: P.muted,
            transform: showActivities ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }} />
        </Box>
        <Collapse in={showActivities}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 1.5 }}>
            {activities.length === 0 && (
              <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>No scored activities on this room.</Typography>
            )}
            {activities.map(a => {
              const verdict = activityVerdicts[a.activityId];
              return (
                <Box key={a.activityId} sx={{ py: 0.75, borderBottom: `1px solid ${P.border}` }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ flex: 1, fontSize: '0.8125rem', color: P.strong }} noWrap>
                      {a.activityName}
                    </Typography>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, minWidth: 36, textAlign: 'right' }}>
                      {Math.round(a.completionPct)}%
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label="Mark correct"
                      onClick={() => {
                        setFormError(null);
                        setActivityVerdicts(s => ({ ...s, [a.activityId]: 'correct' }));
                        setActivityCorrectPct(s => (
                          s[a.activityId] === undefined || s[a.activityId] === ''
                            ? { ...s, [a.activityId]: String(Math.round(a.completionPct)) }
                            : s
                        ));
                      }}
                      sx={{ color: verdict === 'correct' ? colors.success : P.muted }}
                    >
                      <CheckRounded sx={{ fontSize: 18 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Mark wrong"
                      onClick={() => {
                        setFormError(null);
                        setActivityVerdicts(s => ({ ...s, [a.activityId]: 'wrong' }));
                      }}
                      sx={{ color: verdict === 'wrong' ? colors.danger : P.muted }}
                    >
                      <ClearRounded sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Box>
                  {(verdict === 'correct' || verdict === 'wrong') && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1, pl: 0.25 }}>
                      <TextField
                        size="small"
                        type="number"
                        label="Correct percentage"
                        placeholder="e.g. 75"
                        value={activityCorrectPct[a.activityId] ?? ''}
                        onChange={e => {
                          setFormError(null);
                          setActivityCorrectPct(s => ({ ...s, [a.activityId]: e.target.value }));
                        }}
                        slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
                        sx={{ maxWidth: 180 }}
                      />
                      <TextField
                        size="small"
                        fullWidth
                        required
                        label="Reason"
                        placeholder={
                          verdict === 'correct'
                            ? 'Why is this percentage correct?'
                            : 'Why is this wrong, and what should it be?'
                        }
                        value={activityReasons[a.activityId] ?? ''}
                        onChange={e => {
                          setFormError(null);
                          setActivityReasons(s => ({ ...s, [a.activityId]: e.target.value }));
                        }}
                      />
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </Collapse>

        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          label="Notes"
          value={note}
          onChange={e => { setFormError(null); setNote(e.target.value); }}
          sx={{ mb: 1.5 }}
        />

        {formError && (
          <Typography sx={{
            fontSize: '0.8125rem', color: colors.danger, mb: 1.5,
            backgroundColor: 'rgba(220, 38, 38, 0.06)', borderRadius: '8px', px: 1.25, py: 1,
          }}>
            {formError}
          </Typography>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button
            type="button"
            variant="outlined"
            onClick={handleClose}
            sx={{
              textTransform: 'none', borderRadius: '8px', borderColor: P.border,
              color: P.muted, fontWeight: 600, fontSize: '0.8125rem',
            }}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="contained"
            disabled={submitting}
            onClick={() => { void handleSubmit(); }}
            sx={{
              textTransform: 'none', borderRadius: '8px',
              background: colors.primaryGradient, fontWeight: 700, fontSize: '0.8125rem',
              boxShadow: 'none', '&:hover': { boxShadow: 'none', opacity: 0.92 },
            }}
            startIcon={submitting ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : undefined}
          >
            Submit
          </Button>
        </Box>
      </Box>
    </Modal>
  );
}
