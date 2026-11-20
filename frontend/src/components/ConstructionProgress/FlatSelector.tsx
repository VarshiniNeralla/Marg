import React from 'react';
import { Box, Typography } from '@mui/material';
import { CheckCircleRounded, RadioButtonUncheckedRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import type { FlatProgress } from '@/services/constructionProgressService';
import { formatPct, resolveScopeStatus, safePct } from '@/utils/progressDisplay';
import { ReviewChip, ScopeChip } from './ProgressChips';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

/**
 * "Choose a flat": every configured flat on the floor, each with its own progress. Picking one shows that flat's
 * rooms below. It is drawn as a clear picker (heading, instruction, radio marker, "Viewing" on the chosen flat),
 * not as a grid of statistics, so it is obvious that the flats can be chosen.
 */
export default function FlatSelector({
  flats, selected, onSelect,
}: { flats: FlatProgress[]; selected: string; onSelect: (flatName: string) => void }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1.25 }}>
        <Typography component="h2" sx={{ fontSize: '1rem', fontWeight: 800, color: P.strong }}>Choose a flat</Typography>
        <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>
          {flats.length} flat{flats.length === 1 ? '' : 's'} on this floor · tap one to see its progress
        </Typography>
      </Box>
      <Box
        role="listbox"
        aria-label="Select a flat"
        sx={{
          display: 'grid', gap: 1,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
        }}
      >
        {flats.map(f => {
          const isSel = f.flatName === selected;
          const scope = resolveScopeStatus(f);
          const pct = safePct(f.completionPct, scope === 'completed' || !!f.isFullyComplete);
          return (
            <Box
              key={f.flatName}
              component="button"
              type="button"
              role="option"
              aria-selected={isSel}
              data-selected={isSel ? 'true' : 'false'}
              onClick={() => onSelect(f.flatName)}
              sx={{
                textAlign: 'left', minHeight: 44, p: 1.5, borderRadius: '14px', cursor: 'pointer', fontFamily: 'inherit',
                backgroundColor: isSel ? colors.primarySoft : P.white,
                border: `2px solid ${isSel ? colors.primary : P.border}`,
                boxShadow: isSel ? `0 0 0 3px ${colors.primarySoft}` : 'none',
                minWidth: 0,
                transition: 'border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease',
                '&:hover': { borderColor: colors.primary },
                '&:focus-visible': { outline: `3px solid ${colors.primary}`, outlineOffset: 2 },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {isSel
                  ? <CheckCircleRounded sx={{ fontSize: 20, color: colors.primary, flexShrink: 0 }} />
                  : <RadioButtonUncheckedRounded sx={{ fontSize: 20, color: P.muted, flexShrink: 0 }} />}
                <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: '0.9375rem', fontWeight: 800, color: P.strong }}>{f.flatName}</Typography>
                <Typography sx={{ fontSize: '1.0625rem', fontWeight: 800, color: P.strong }}>{formatPct(pct)}</Typography>
              </Box>
              <Typography sx={{ fontSize: '0.6875rem', color: P.muted, mt: 0.25, mb: 0.75, pl: 3.5 }}>
                Verified progress
                {typeof f.coveragePct === 'number' ? ` · ${Math.round(f.coveragePct)}% coverage` : ''}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center', pl: 3.5 }}>
                <ScopeChip status={scope} />
                {f.reviewRequired && <ReviewChip label="Review needed" />}
                {isSel && (
                  <Typography component="span" sx={{ ml: 'auto', fontSize: '0.6875rem', fontWeight: 800, color: colors.primary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Viewing
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
