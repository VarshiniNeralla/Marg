import React from 'react';
import { Box, Typography } from '@mui/material';
import { AutoAwesomeRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';

// The analysis opens its summary with "Based on N analyzed image(s), this floor is approximately P% complete across the
// full finishing checklist." The floor overview right above already shows that percentage and the photo count, and N
// there is every photo on the floor while the overview counts the ones actually scored, so the two disagreed. Show only
// the part that adds something (what is finished, what is in progress, what could not be confirmed).
const HEADLINE = /^\s*Based on \d+ analyzed image\(s\), this floor is approximately \d+% complete across the full finishing checklist\.\s*/i;

/** Summary text as shown on the floor page. Anything that is not the usual opening sentence is left untouched. */
export function summaryDetail(summary: string): string {
  const rest = (summary || '').replace(HEADLINE, '').trim();
  return rest || (summary || '').trim();
}

export default function ExecutiveSummaryPanel({ summary }: { summary: string }) {
  return (
    <Box
      sx={{
        p: 2.5,
        borderRadius: '14px',
        backgroundColor: colors.primarySoft,
        border: `1.5px solid ${colors.primaryRing}`,
        display: 'flex',
        gap: 1.5,
      }}
    >
      <AutoAwesomeRounded sx={{ fontSize: 20, color: colors.primary, flexShrink: 0, mt: 0.25 }} />
      <Box>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.primary, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.5 }}>
          AI Summary
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textBody, lineHeight: 1.6 }}>
          {summaryDetail(summary)}
        </Typography>
      </Box>
    </Box>
  );
}
