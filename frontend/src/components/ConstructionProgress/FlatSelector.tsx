import React from 'react';
import { Box, Typography } from '@mui/material';
import { colors } from '@theme/tokens';
import type { FlatProgress } from '@/services/constructionProgressService';
import { formatPct, resolveScopeStatus, safePct } from '@/utils/progressDisplay';
import { ReviewChip, ScopeChip } from './ProgressChips';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

export default function FlatSelector({
  flats, selected, onSelect,
}: { flats: FlatProgress[]; selected: string; onSelect: (flatName: string) => void }) {
  return (
    <Box
      role="listbox"
      aria-label="Select a flat"
      sx={{
        display: 'grid', gap: 1, mb: 3,
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
      }}
    >
      {flats.map(f => {
        const isSel = f.flatName === selected;
        const scope = resolveScopeStatus(f);
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
              border: `1.5px solid ${isSel ? colors.primary : P.border}`,
              minWidth: 0,
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
              <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 800, color: P.strong }}>{f.flatName}</Typography>
              <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: P.strong }}>
                {formatPct(safePct(f.completionPct, scope === 'completed' || !!f.isFullyComplete))}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '0.6875rem', color: P.muted, mb: 0.75 }}>
              Verified progress
              {typeof f.coveragePct === 'number' ? ` · ${Math.round(f.coveragePct)}% coverage` : ''}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              <ScopeChip status={scope} />
              {f.reviewRequired && <ReviewChip label="Review needed" />}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
