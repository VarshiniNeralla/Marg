import React from 'react';
import { Box, Typography, Grid, Chip } from '@mui/material';
import {
  ViewInArRounded,
  PlayArrowRounded,
  CameraAltRounded,
  AccessTimeRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';

// ── Mock data ──────────────────────────────────────────────────────────────────

const mockTours = [
  {
    id: '1',
    room: 'B2-F14-Room 1402',
    project: 'My Home Udyan',
    floor: 'Floor 14',
    lastCapture: '2 hours ago',
    captures: 12,
    status: 'published',
    gradient: colors.projectA,
  },
  {
    id: '2',
    room: 'A1-F08-Room 0803',
    project: 'My Home Udyan',
    floor: 'Floor 8',
    lastCapture: '1 day ago',
    captures: 8,
    status: 'published',
    gradient: colors.projectA,
  },
  {
    id: '3',
    room: 'T1-F05-Room 0512',
    project: 'My Home Grava Residences',
    floor: 'Floor 5',
    lastCapture: '3 days ago',
    captures: 6,
    status: 'review',
    gradient: colors.projectC,
  },
  {
    id: '4',
    room: 'A2-F03-Room 0301',
    project: 'My Home Apas',
    floor: 'Floor 3',
    lastCapture: '1 week ago',
    captures: 14,
    status: 'published',
    gradient: colors.projectB,
  },
  {
    id: '5',
    room: 'B4-F18-Room 1803',
    project: 'My Home Udyan',
    floor: 'Floor 18',
    lastCapture: '5 hours ago',
    captures: 9,
    status: 'processing',
    gradient: colors.projectA,
  },
  {
    id: '6',
    room: 'P1-F12-Room 1207',
    project: 'My Home Grava Residences',
    floor: 'Floor 12',
    lastCapture: '2 days ago',
    captures: 18,
    status: 'published',
    gradient: colors.projectC,
  },
];

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  published:  { label: 'Published',  color: colors.success, bg: colors.successBg },
  review:     { label: 'In Review',  color: colors.warning, bg: colors.warningBg },
  processing: { label: 'Processing', color: colors.info,    bg: colors.infoBg },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function ToursPage() {
  return (
    <Box>
      <Box sx={{ mb: 5 }}>
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
          Virtual Tours
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          {mockTours.length} tours · across 3 projects
        </Typography>
      </Box>

      <Grid container spacing={2}>
        {mockTours.map((tour) => {
          const st = statusConfig[tour.status] ?? statusConfig.processing;
          return (
            <Grid key={tour.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Box
                sx={{
                  borderRadius: '18px',
                  backgroundColor: colors.card,
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
                  cursor: 'pointer',
                  transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}`,
                  '&:hover': {
                    boxShadow: '0 8px 32px rgba(15,23,42,0.10)',
                    transform: 'translateY(-2px)',
                  },
                  '&:hover .tour-play': { opacity: 1, transform: 'scale(1)' },
                }}
              >
                {/* Thumbnail */}
                <Box
                  sx={{
                    height: 160,
                    background: tour.gradient,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Box
                    className="tour-play"
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      backgroundColor: 'rgba(255,255,255,0.18)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255,255,255,0.28)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      transform: 'scale(0.85)',
                      transition: `opacity ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}`,
                    }}
                  >
                    <PlayArrowRounded sx={{ color: colors.white, fontSize: 26 }} />
                  </Box>

                  {/* 360 badge */}
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 12,
                      left: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      px: 1,
                      py: 0.375,
                      borderRadius: '6px',
                      backgroundColor: 'rgba(0,0,0,0.4)',
                      backdropFilter: 'blur(6px)',
                    }}
                  >
                    <ViewInArRounded sx={{ color: colors.white, fontSize: 12 }} />
                    <Typography sx={{ fontSize: '0.625rem', fontWeight: 700, color: colors.white, letterSpacing: '0.05em' }}>
                      360°
                    </Typography>
                  </Box>

                  {/* Status chip */}
                  <Box sx={{ position: 'absolute', top: 12, right: 12 }}>
                    <Chip
                      label={st.label}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.625rem',
                        fontWeight: 600,
                        color: st.color,
                        backgroundColor: st.bg,
                        borderRadius: '5px',
                      }}
                    />
                  </Box>
                </Box>

                {/* Body */}
                <Box sx={{ px: 2, pt: 2, pb: 2 }}>
                  <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>
                    {tour.room}
                  </Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1.5 }}>
                    {tour.project}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: colors.textSubdued }}>
                      <CameraAltRounded sx={{ fontSize: 12 }} />
                      <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>{tour.captures} captures</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textSubdued }}>
                      <AccessTimeRounded sx={{ fontSize: 11 }} />
                      <Typography sx={{ fontSize: '0.6875rem', color: 'inherit' }}>{tour.lastCapture}</Typography>
                    </Box>
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
