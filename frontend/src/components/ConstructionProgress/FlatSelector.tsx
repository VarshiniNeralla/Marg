import React from 'react';
import { Box, Typography } from '@mui/material';
import { colors } from '@theme/tokens';
import type { FlatProgress } from '@/services/constructionProgressService';
import { countNeedingReview, formatPct, resolveScopeStatus, safePct } from '@/utils/progressDisplay';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

/**
 * "Choose a flat": every configured flat on the floor as one compact pill (name and its own percentage) in a single
 * wrapping row. The chosen flat is filled in. Nothing else is printed per flat; its details appear below once chosen.
 */
export default function FlatSelector({
  flats, selected, onSelect,
}: { flats: FlatProgress[]; selected: string; onSelect: (flatName: string) => void }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography component="h2" sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1 }}>
        Choose a flat
      </Typography>
      <Box role="listbox" aria-label="Select a flat" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
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
                display: 'inline-flex', alignItems: 'center', gap: 1, minHeight: 40, px: 1.75, py: 0.75, borderRadius: '999px',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem',
                backgroundColor: isSel ? colors.primary : P.white,
                color: isSel ? '#fff' : P.strong,
                border: `1.5px solid ${isSel ? colors.primary : P.border}`,
                transition: 'background-color 120ms ease, border-color 120ms ease',
                '&:hover': { borderColor: colors.primary, backgroundColor: isSel ? colors.primary : colors.primarySoft },
                '&:focus-visible': { outline: `3px solid ${colors.primaryRing}`, outlineOffset: 2 },
              }}
            >
              <Box component="span" sx={{ fontWeight: 700 }}>{f.flatName}</Box>
              <Box component="span" sx={{ fontWeight: 600, opacity: isSel ? 0.9 : 0.65 }}>{formatPct(pct)}</Box>
              {countNeedingReview((f.rooms ?? []).flatMap(r => r.activities ?? [])) > 0 && (
                <Box component="span" role="img" aria-label="Needs review" title="Needs review"
                  sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: isSel ? '#fff' : colors.danger }} />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
