import React, { useState } from 'react';
import { Box, Typography, Grid, Chip } from '@mui/material';
import {
  CameraAltRounded,
  ViewInArRounded,
  AccessTimeRounded,
  CheckRounded,
  WarningAmberRounded,
  CloseRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';

// ── Mock data ──────────────────────────────────────────────────────────────────

const mockCaptures = [
  { id: '1', room: 'B2-F14-Room 1402', project: 'My Home Udyan',            time: '12 min ago', status: 'processed', gradient: colors.projectA },
  { id: '2', room: 'A1-F08-Room 0803', project: 'My Home Udyan',            time: '1h ago',     status: 'processed', gradient: colors.projectA },
  { id: '3', room: 'T1-F05-Room 0512', project: 'My Home Grava Residences', time: '3h ago',     status: 'review',    gradient: colors.projectC },
  { id: '4', room: 'A2-F03-Room 0301', project: 'My Home Apas',             time: '1d ago',     status: 'processed', gradient: colors.projectB },
  { id: '5', room: 'B3-F22-Room 2207', project: 'My Home Udyan',            time: '2d ago',     status: 'rejected',  gradient: colors.projectA },
  { id: '6', room: 'B4-F18-Room 1803', project: 'My Home Udyan',            time: '5h ago',     status: 'review',    gradient: colors.projectA },
  { id: '7', room: 'A1-F11-Room 1104', project: 'My Home Udyan',            time: '1d ago',     status: 'review',    gradient: colors.projectA },
  { id: '8', room: 'G2-F07-Room 0704', project: 'My Home Grava Residences', time: '4d ago',     status: 'processed', gradient: colors.projectC },
  { id: '9', room: 'V1-F02-Room 0201', project: 'My Home Vyoma',            time: '1w ago',     status: 'processed', gradient: colors.projectD },
];

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  processed: { label: 'Processed', color: colors.success, bg: colors.successBg },
  review:    { label: 'In Review', color: colors.warning, bg: colors.warningBg },
  rejected:  { label: 'Rejected',  color: colors.danger,  bg: colors.dangerBg },
};

const filters = ['All', 'Processed', 'In Review', 'Rejected'];

// ── Component ──────────────────────────────────────────────────────────────────

export default function CapturesPage() {
  const [filter, setFilter] = useState('All');

  const filtered = filter === 'All'
    ? mockCaptures
    : mockCaptures.filter((c) => statusConfig[c.status]?.label === filter);

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography
          sx={{
            fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
            fontSize: { xs: '1.5rem', md: '2rem' },
            fontWeight: 700,
            color: colors.textStrong,
            letterSpacing: '-0.04em',
            lineHeight: 1.1,
            mb: 0.75,
          }}
        >
          Captures
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          {mockCaptures.length} captures · {mockCaptures.filter(c => c.status === 'review').length} pending review
        </Typography>
      </Box>

      {/* Filter pills */}
      <Box sx={{ display: 'flex', gap: 0.75, mb: 4, flexWrap: 'wrap' }}>
        {filters.map((f) => (
          <Box
            key={f}
            onClick={() => setFilter(f)}
            sx={{
              px: 1.5,
              py: 0.625,
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.8125rem',
              fontWeight: filter === f ? 600 : 400,
              backgroundColor: filter === f ? colors.ink : colors.bgDeep,
              color: filter === f ? colors.white : colors.textSecondary,
              transition: `all ${motion.durationFast}`,
              '&:hover': { backgroundColor: filter === f ? colors.ink : colors.border },
            }}
          >
            {f}
          </Box>
        ))}
      </Box>

      {/* Capture grid */}
      <Grid container spacing={2}>
        {filtered.map((capture) => {
          const st = statusConfig[capture.status];
          return (
            <Grid key={capture.id} size={{ xs: 6, sm: 4, md: 3 }}>
              <Box
                sx={{
                  borderRadius: '16px',
                  backgroundColor: colors.card,
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
                  cursor: 'pointer',
                  transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}`,
                  '&:hover': {
                    boxShadow: '0 8px 32px rgba(15,23,42,0.10)',
                    transform: 'translateY(-2px)',
                  },
                  '&:hover .cap-overlay': { opacity: 1 },
                }}
              >
                {/* Thumbnail */}
                <Box
                  sx={{
                    height: 128,
                    background: capture.gradient,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CameraAltRounded sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 32 }} />

                  <Box
                    className="cap-overlay"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      transition: `opacity ${motion.durationFast}`,
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        px: 1.25,
                        py: 0.5,
                        borderRadius: '8px',
                        backgroundColor: 'rgba(255,255,255,0.18)',
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      <ViewInArRounded sx={{ color: colors.white, fontSize: 14 }} />
                      <Typography sx={{ fontSize: '0.6875rem', color: colors.white, fontWeight: 600 }}>View</Typography>
                    </Box>
                  </Box>

                  {st && (
                    <Chip
                      label={st.label}
                      size="small"
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        height: 20,
                        fontSize: '0.5625rem',
                        fontWeight: 700,
                        color: st.color,
                        backgroundColor: st.bg,
                        borderRadius: '5px',
                      }}
                    />
                  )}
                </Box>

                {/* Info */}
                <Box sx={{ px: 1.5, pt: 1.25, pb: 1.5 }}>
                  <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>
                    {capture.room}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: '0.6875rem', color: colors.textMuted, mb: 0.75 }}>
                    {capture.project}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textSubdued }}>
                    <AccessTimeRounded sx={{ fontSize: 10 }} />
                    <Typography sx={{ fontSize: '0.6875rem', color: 'inherit' }}>{capture.time}</Typography>
                  </Box>
                </Box>
              </Box>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
