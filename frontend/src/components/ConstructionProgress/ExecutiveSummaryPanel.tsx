import React from 'react';
import { Box, Typography } from '@mui/material';
import { AutoAwesomeRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';

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
          {summary}
        </Typography>
      </Box>
    </Box>
  );
}
