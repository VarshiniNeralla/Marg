import React from 'react';
import { Box, Button, CircularProgress, Tooltip, Typography } from '@mui/material';
import {
  ApartmentRounded, MeetingRoomRounded, RefreshRounded, NotificationsActiveRounded,
  PictureAsPdfRounded, TableChartRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, shadows } from '@theme/tokens';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', soft: '#f1f5f9' };

// Phone and tablet keep the stacked layout (equal-width buttons that may wrap their text).
// Desktop (lg and up) becomes one command bar: buttons take the width of their text, never wrap, share one height.
const BTN_BASE = {
  minHeight: { xs: 44, lg: 40 },
  width: { xs: '100%', lg: 'auto' },
  px: { xs: 2, lg: 2.25 },
  borderRadius: '10px',
  fontWeight: 600,
  textTransform: 'none',
  fontSize: '0.875rem',
  lineHeight: 1.2,
  whiteSpace: { xs: 'normal', lg: 'nowrap' },
  textAlign: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease',
  '&:active': { transform: 'scale(0.98)' },
  '&:focus-visible': { outline: `3px solid ${colors.primaryRing}`, outlineOffset: 2 },
} as const;

const OUTLINED = {
  ...BTN_BASE,
  border: `1.5px solid ${P.border}`,
  color: P.strong,
  backgroundColor: '#fff',
  '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  '&.Mui-disabled': { color: P.muted, opacity: 0.6 },
} as const;

const PRIMARY = {
  ...BTN_BASE,
  minWidth: { lg: 150 },
  background: colors.primaryGradient,
  color: '#fff',
  fontWeight: 700,
  boxShadow: shadows.btn,
  '&:hover': { opacity: 0.94, boxShadow: shadows.btn },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.85)', opacity: 0.6 },
} as const;

// Report downloads: full-width labelled buttons on phone/tablet; on desktop a compact square icon button (with a
// tooltip and an accessible name) so all three groups fit on one line inside the page's card.
const REPORT = {
  ...OUTLINED,
  minWidth: { lg: 44 },
  px: { lg: 1.25 },
  '& .MuiButton-startIcon': { mr: { xs: 1, lg: 0 }, ml: { lg: 0 } },
} as const;

function ReportButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <Tooltip title={label} arrow enterDelay={300}>
      <Button onClick={onClick} aria-label={label} startIcon={icon} sx={REPORT}>
        <Box component="span" sx={{ display: { xs: 'inline', lg: 'none' } }}>{label}</Box>
      </Button>
    </Tooltip>
  );
}

function Group({ label, children, cols = 2 }: { label: string; children: React.ReactNode; cols?: number }) {
  return (
    <Box component="section" aria-label={label} sx={{ minWidth: 0, flex: { lg: '0 0 auto' } }}>
      <Typography
        sx={{
          fontSize: '0.6875rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase',
          letterSpacing: '0.06em', mb: 1,
        }}
      >
        {label}
      </Typography>
      <Box
        sx={{
          display: { xs: 'grid', lg: 'flex' },
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: `repeat(${cols}, minmax(0, 1fr))` },
          gap: { xs: 1.5, lg: 1 },
          alignItems: 'center',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/** Thin vertical rule between the groups on desktop only. */
function Divider() {
  return (
    <Box
      aria-hidden
      sx={{ display: { xs: 'none', lg: 'block' }, width: '1.5px', flexShrink: 0, alignSelf: 'stretch', mt: 3, backgroundColor: P.border, borderRadius: 1 }}
    />
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
        display: { xs: 'grid', lg: 'flex' },
        // phone/tablet: three stacked groups of two equal buttons; desktop: one row, groups separated by thin rules.
        gridTemplateColumns: 'minmax(0, 1fr)',
        alignItems: { lg: 'stretch' },
        justifyContent: { lg: 'space-between' },
        columnGap: { lg: 2.5 },
        rowGap: 2.5,
        px: { xs: 2, lg: 2.5 },
        py: 2,
        borderRadius: '14px',
        backgroundColor: '#fff',
        border: `1.5px solid ${P.border}`,
        boxShadow: { lg: '0 1px 2px rgba(15,23,42,0.04)' },
      }}
    >
      <Group label="View">
        <Button component={Link} to={`/construction-progress/${floorId}/flats`} startIcon={<ApartmentRounded sx={{ fontSize: 20, color: colors.primary }} />} sx={OUTLINED}>
          Flat Finishing Works
        </Button>
        <Button component={Link} to={`/construction-progress/${floorId}/common`} startIcon={<MeetingRoomRounded sx={{ fontSize: 20, color: colors.primary }} />} sx={OUTLINED}>
          Common Area Finishing
        </Button>
      </Group>

      <Divider />

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

      <Divider />

      <Group label="Reports">
        <ReportButton label="PDF Report" onClick={onPdf} icon={<PictureAsPdfRounded sx={{ fontSize: 21, color: '#dc2626' }} />} />
        <ReportButton label="Excel Report" onClick={onExcel} icon={<TableChartRounded sx={{ fontSize: 21, color: '#16a34a' }} />} />
      </Group>
    </Box>
  );
}
