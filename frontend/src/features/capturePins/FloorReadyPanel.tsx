import React from 'react';
import { Box, Typography } from '@mui/material';
import { CameraAltRounded, AutorenewRounded, HistoryRounded, ChevronRightRounded } from '@mui/icons-material';
import { Link } from 'react-router-dom';

interface Props {
  floorLabel: string;
  /** How many capture points on this floor already have photos. */
  pointsWithCaptures: number;
  /** Continue the normal capture workflow. */
  onCapture: () => void;
  /** Start a recapture session: add new photos at existing points, keeping every previous capture. */
  onRecapture: () => void;
  /** Where "View previous captures" goes. */
  historyHref: string;
}

const BLUE = '#2563eb';
const BLUE_DARK = '#1d4ed8';

/**
 * Shown right after a floor is chosen. Always says where the person is. With no previous captures there is one
 * choice (the existing capture mode); once the floor has captures there are two clearly different ones: carry on
 * capturing, or recapture the floor (new photos at the existing points, nothing replaced).
 */
export default function FloorReadyPanel({ floorLabel, pointsWithCaptures, onCapture, onRecapture, historyHref }: Props) {
  const hasPrevious = pointsWithCaptures > 0;

  const option = (opts: {
    testId: string; onClick: () => void; icon: React.ReactNode; title: string; text: string; accent: string; tint: string;
  }) => (
    <Box
      role="button"
      data-testid={opts.testId}
      onClick={opts.onClick}
      sx={{
        flex: '1 1 260px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.75, p: 2, borderRadius: '18px',
        cursor: 'pointer', userSelect: 'none', textAlign: 'left', backgroundColor: '#fff',
        border: `1.5px solid ${opts.accent}33`, boxShadow: '0 2px 10px rgba(15,23,42,0.06)',
        transition: 'transform 160ms, box-shadow 160ms, border-color 160ms',
        '&:hover': { transform: 'translateY(-2px)', borderColor: opts.accent, boxShadow: `0 8px 22px ${opts.accent}2e` },
        '&:active': { transform: 'scale(0.99)' },
      }}
    >
      <Box sx={{ width: 48, height: 48, borderRadius: '14px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: opts.tint, color: opts.accent }}>
        {opts.icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: '#111827', lineHeight: 1.25 }}>{opts.title}</Typography>
        <Typography sx={{ fontSize: '0.8125rem', color: '#6b7280', lineHeight: 1.4, mt: 0.375 }}>{opts.text}</Typography>
      </Box>
      <ChevronRightRounded sx={{ fontSize: 22, color: opts.accent, flexShrink: 0 }} />
    </Box>
  );

  return (
    <Box
      data-testid="floor-ready-panel"
      sx={{ py: { xs: 4, sm: 6 }, px: 2, textAlign: 'center', border: '1.5px solid #e5e7eb', borderRadius: '18px', backgroundColor: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <Box sx={{ width: 64, height: 64, borderRadius: '16px', background: `linear-gradient(135deg,${BLUE},${BLUE_DARK})`, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2, boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}>
        <CameraAltRounded sx={{ fontSize: 32, color: '#fff' }} />
      </Box>
      <Typography sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, fontWeight: 800, color: '#111827', mb: 0.75 }}>
        You are in {floorLabel} and ready to capture
      </Typography>
      <Typography sx={{ fontSize: '0.875rem', color: '#6b7280', mb: 3, maxWidth: 460 }}>
        {hasPrevious
          ? `${pointsWithCaptures} capture point${pointsWithCaptures === 1 ? '' : 's'} on this floor already ${pointsWithCaptures === 1 ? 'has' : 'have'} photos. Choose how you want to continue.`
          : 'No captures yet on this floor. Open capture mode, then tap a point to start.'}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', width: '100%', maxWidth: 680, justifyContent: 'center' }}>
        {option({
          testId: 'go-to-capture-mode',
          onClick: onCapture,
          accent: BLUE, tint: '#eff6ff',
          icon: <CameraAltRounded sx={{ fontSize: 26 }} />,
          title: 'Go to Capture Mode',
          text: hasPrevious ? 'Continue with the usual capture workflow on this floor.' : 'Start capturing on this floor.',
        })}
        {hasPrevious && option({
          testId: 'recapture-floor',
          onClick: onRecapture,
          accent: '#059669', tint: '#ecfdf5',
          icon: <AutorenewRounded sx={{ fontSize: 26 }} />,
          title: 'Recapture the Floor',
          text: 'Add new photos at the existing capture points to track progress. Every previous capture is kept.',
        })}
      </Box>

      <Box
        component={Link}
        to={historyHref}
        sx={{ mt: 2.5, display: 'inline-flex', alignItems: 'center', gap: 0.5, color: '#9ca3af', fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', '&:hover': { color: BLUE } }}
      >
        <HistoryRounded sx={{ fontSize: 14 }} /> View previous captures
      </Box>
    </Box>
  );
}
