import React from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import {
  ApartmentRounded, MeetingRoomRounded, RefreshRounded, NotificationsActiveRounded,
  PictureAsPdfRounded, TableChartRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, shadows } from '@theme/tokens';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827' };

const BTN_BASE = {
  minHeight: 44,
  width: '100%',
  px: 2,
  borderRadius: '10px',
  fontWeight: 600,
  textTransform: 'none',
  fontSize: '0.875rem',
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
} as const;

const OUTLINED = {
  ...BTN_BASE,
  border: `1.5px solid ${P.border}`,
  color: P.strong,
  '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  '&.Mui-disabled': { color: P.muted, opacity: 0.6 },
} as const;

const PRIMARY = {
  ...BTN_BASE,
  background: colors.primaryGradient,
  color: '#fff',
  fontWeight: 700,
  boxShadow: shadows.btn,
  '&:hover': { opacity: 0.92 },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.85)', opacity: 0.6 },
} as const;

function Group({ label, children, cols = 2 }: { label: string; children: React.ReactNode; cols?: number }) {
  return (
    <Box component="section" aria-label={label} sx={{ minWidth: 0 }}>
      <Typography
        sx={{
          fontSize: '0.6875rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase',
          letterSpacing: '0.06em', mb: 1,
        }}
      >
        {label}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 1.5 }}>
        {children}
      </Box>
    </Box>
  );
}

export interface FloorActionToolbarProps {
  floorId: string | undefined;
  analyzing: boolean;
  backgroundRunning: boolean;
  onPdf: () => void;
  onExcel: () => void;
  onReanalyze: () => void;
  onRunInBackground: () => void;
}

export default function FloorActionToolbar({
  floorId, analyzing, backgroundRunning, onPdf, onExcel, onReanalyze, onRunInBackground,
}: FloorActionToolbarProps) {
  const busy = analyzing || backgroundRunning;
  return (
    <Box
      data-testid="floor-action-toolbar"
      sx={{
        display: 'grid',
        // phone: stacked; tablet: View + Analysis / Reports row; desktop: one row of three.
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(3, minmax(0, 1fr))',
        },
        columnGap: 3,
        rowGap: 2.5,
        p: 2,
        borderRadius: '14px',
        backgroundColor: '#fff',
        border: `1.5px solid ${P.border}`,
        '& > section:last-of-type': { gridColumn: { sm: '1 / -1', md: 'auto' } },
      }}
    >
      <Group label="View">
        <Button component={Link} to={`/construction-progress/${floorId}/flats`} startIcon={<ApartmentRounded sx={{ fontSize: 20 }} />} sx={OUTLINED}>
          Flat Finishing Works
        </Button>
        <Button component={Link} to={`/construction-progress/${floorId}/common`} startIcon={<MeetingRoomRounded sx={{ fontSize: 20 }} />} sx={OUTLINED}>
          Common Area Finishing
        </Button>
      </Group>

      <Group label="Analysis">
        <Button
          onClick={onReanalyze}
          disabled={busy}
          startIcon={analyzing ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <RefreshRounded sx={{ fontSize: 20 }} />}
          sx={PRIMARY}
        >
          {analyzing ? 'Re-analyzing…' : 'Re-analyze'}
        </Button>
        <Button
          onClick={onRunInBackground}
          disabled={busy}
          startIcon={backgroundRunning
            ? <CircularProgress size={14} sx={{ color: colors.primary }} />
            : <NotificationsActiveRounded sx={{ fontSize: 20 }} />}
          sx={OUTLINED}
        >
          {backgroundRunning ? 'Running in background…' : 'Run in Background'}
        </Button>
      </Group>

      <Group label="Reports">
        <Button onClick={onPdf} startIcon={<PictureAsPdfRounded sx={{ fontSize: 20 }} />} sx={OUTLINED}>
          PDF Report
        </Button>
        <Button onClick={onExcel} startIcon={<TableChartRounded sx={{ fontSize: 20 }} />} sx={OUTLINED}>
          Excel Report
        </Button>
      </Group>
    </Box>
  );
}
