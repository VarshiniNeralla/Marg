import React from 'react';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import { snapOptionLabel, type CompareView, type SnapLike } from '@/utils/tourCompare';

interface Props {
  timeline: readonly SnapLike[];
  view: CompareView;
  onViewChange: (v: CompareView) => void;
  /** Date shown in "single" and "with latest". */
  selectedId: string;
  onSelect: (id: string) => void;
  beforeId: string;
  afterId: string;
  onBeforeChange: (id: string) => void;
  onAfterChange: (id: string) => void;
}

const BLUE = '#2563eb';

/**
 * Pick a capture date to view, put it next to the latest, or set two dates side by side (Before & After).
 * Every row names a real capture date and time, so it is clear which visit is on screen.
 * With a single capture there is nothing to choose or compare, so only a short note is shown.
 */
export default function DateViewControls({
  timeline, view, onViewChange, selectedId, onSelect, beforeId, afterId, onBeforeChange, onAfterChange,
}: Props) {
  const canCompare = timeline.length >= 2;

  if (!canCompare) {
    return (
      <Typography data-testid="date-view-controls" sx={{ mb: 1.5, fontSize: '0.8125rem', color: '#6b7280' }}>
        Recapture this floor to add another date, then compare how this spot changes.
      </Typography>
    );
  }

  const dateSelect = (label: string, value: string, onChange: (id: string) => void, testId: string) => (
    <Box sx={{ flex: 1, minWidth: 220 }}>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: '#6b7280', mb: 0.5, letterSpacing: '0.02em' }}>{label}</Typography>
      <Select
        size="small"
        fullWidth
        value={value}
        onChange={e => onChange(String(e.target.value))}
        inputProps={{ 'aria-label': label, 'data-testid': testId }}
        sx={{ borderRadius: '12px', fontSize: '0.8125rem', fontWeight: 600, backgroundColor: '#fff' }}
        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 320 } } } }}
      >
        {timeline.map((s, i) => (
          <MenuItem key={s.id} value={s.id} sx={{ fontSize: '0.8125rem' }}>
            {snapOptionLabel(s, i, timeline.length)}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );

  const seg = (v: CompareView, text: string) => (
    <Box
      key={v}
      role="button"
      aria-pressed={view === v}
      data-testid={`view-${v}`}
      onClick={() => onViewChange(v)}
      sx={{
        flex: 1, textAlign: 'center', px: 1.5, py: 0.875, borderRadius: '10px', fontSize: '0.8125rem', fontWeight: 700,
        userSelect: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
        color: view === v ? BLUE : '#6b7280', backgroundColor: view === v ? '#fff' : 'transparent',
        boxShadow: view === v ? '0 1px 4px rgba(15,23,42,0.12)' : 'none',
        transition: 'all 160ms',
      }}
    >
      {text}
    </Box>
  );

  return (
    <Box data-testid="date-view-controls" sx={{ mb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', p: 0.5, gap: 0.5, borderRadius: '14px', backgroundColor: '#f1f5f9', maxWidth: 440 }}>
        {seg('single', 'One date')}
        {seg('withLatest', 'With latest')}
        {seg('beforeAfter', 'Before & After')}
      </Box>

      {view !== 'beforeAfter' && (
        <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
          {dateSelect(view === 'withLatest' ? 'Compare this date with the latest' : 'Capture date', selectedId, onSelect, 'date-select')}
        </Box>
      )}
      {view === 'beforeAfter' && (
        <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
          {dateSelect('Before', beforeId, onBeforeChange, 'before-select')}
          {dateSelect('After', afterId, onAfterChange, 'after-select')}
        </Box>
      )}
    </Box>
  );
}
