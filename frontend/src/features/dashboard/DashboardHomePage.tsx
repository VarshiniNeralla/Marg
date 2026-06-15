import React from 'react';
import { Box, Typography, Grid, Chip, LinearProgress, Divider } from '@mui/material';
import {
  FolderRounded,
  DomainRounded,
  MeetingRoomRounded,
  CameraAltRounded,
  RateReviewRounded,
  AddRounded,
  CloudUploadRounded,
  ViewInArRounded,
  ArrowForwardRounded,
  CheckCircleRounded,
  AccessTimeRounded,
  WarningAmberRounded,
  TrendingUpRounded,
  LayersRounded,
  PlayArrowRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';

// ── Mock data ──────────────────────────────────────────────────────────────────

const stats = [
  { label: 'Projects',        value: '4',   sub: '2 active',          color: colors.primary },
  { label: 'Towers',          value: '10',  sub: 'across 4 projects',  color: '#0891b2' },
  { label: 'Rooms',           value: '482', sub: '126 mapped',         color: '#7c3aed' },
  { label: 'Captures',        value: '210', sub: '48 this week',       color: '#059669' },
  { label: 'Pending Reviews', value: '7',   sub: 'needs attention',    color: '#d97706' },
];

const projectProgress = [
  { name: 'My Home Udyan',            towers: 3, progress: 68, captures: 89, total: 131, status: 'active',  color: colors.primary,       gradient: colors.projectA },
  { name: 'My Home Apas',             towers: 1, progress: 100,captures: 48, total: 48,  status: 'done',    color: '#059669',            gradient: colors.projectB },
  { name: 'My Home Grava Residences', towers: 2, progress: 72, captures: 61, total: 84,  status: 'review',  color: '#d97706',            gradient: colors.projectC },
  { name: 'My Home Vyoma',            towers: 4, progress: 5,  captures: 12, total: 224, status: 'draft',   color: colors.textSubdued,   gradient: colors.projectD },
];

const recentUploads = [
  { name: 'B2-F14-Room 1402',  project: 'My Home Udyan',            time: '12 min ago', status: 'processed' },
  { name: 'A1-F08-Room 0803',  project: 'My Home Udyan',            time: '1h ago',     status: 'processed' },
  { name: 'T1-F05-Room 0512',  project: 'My Home Grava Residences', time: '3h ago',     status: 'review' },
  { name: 'A2-F03-Room 0301',  project: 'My Home Apas',             time: '1d ago',     status: 'processed' },
  { name: 'B3-F22-Room 2207',  project: 'My Home Udyan',            time: '2d ago',     status: 'rejected' },
];

const pendingReviews = [
  { room: 'T1-F05-Room 0512', project: 'My Home Grava Residences', uploaded: '3h ago' },
  { room: 'B4-F18-Room 1803', project: 'My Home Udyan',            uploaded: '5h ago' },
  { room: 'A1-F11-Room 1104', project: 'My Home Udyan',            uploaded: '1d ago' },
];

const uploadStatusConfig: Record<string, { label: string; color: string }> = {
  processed: { label: 'Processed', color: colors.success },
  review:    { label: 'In Review', color: colors.warning },
  rejected:  { label: 'Rejected',  color: colors.danger },
};

const progressStatusConfig: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Active',    color: colors.success,  bg: colors.successBg },
  done:   { label: 'Complete',  color: colors.primary,  bg: colors.primarySoft },
  review: { label: 'In Review', color: colors.warning,  bg: colors.warningBg },
  draft:  { label: 'Draft',     color: colors.textMuted, bg: colors.bgDeep },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function DashboardHomePage() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const greeting = getGreeting();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── HERO ──────────────────────────────────────────────────────────────── */}
      <Box
        sx={{
          borderRadius: '20px',
          background: colors.ink,
          overflow: 'hidden',
          mb: 5,
          position: 'relative',
        }}
      >
        {/* Subtle radial glow behind content */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse 70% 80% at 10% 60%, rgba(37,99,235,0.18) 0%, transparent 70%),
                         radial-gradient(ellipse 50% 60% at 90% 20%, rgba(124,58,237,0.12) 0%, transparent 60%)`,
            pointerEvents: 'none',
          }}
        />

        <Box sx={{ position: 'relative', p: { xs: 3, md: 5 } }}>
          <Grid container spacing={4} alignItems="center">

            {/* Left: greeting + context */}
            <Grid size={{ xs: 12, md: 7 }}>
              <Typography
                sx={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: colors.inkSubdued,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  mb: 1.5,
                }}
              >
                {greeting}
              </Typography>
              <Typography
                sx={{
                  fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
                  fontSize: { xs: '1.75rem', md: '2.25rem' },
                  fontWeight: 700,
                  color: colors.white,
                  letterSpacing: '-0.04em',
                  lineHeight: 1.1,
                  mb: 2,
                }}
              >
                {firstName}.
              </Typography>

              {/* Current project context */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  p: 2,
                  borderRadius: '14px',
                  backgroundColor: colors.inkBorder,
                  border: `1px solid ${colors.inkBorder}`,
                  backdropFilter: 'blur(8px)',
                  mb: 3,
                  maxWidth: 480,
                }}
              >
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: '12px',
                    background: colors.projectA,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FolderRounded sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 22 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.inkMuted, mb: 0.25 }}>
                    Last visited project
                  </Typography>
                  <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.white, lineHeight: 1.2 }}>
                    My Home Udyan
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.inkMuted, mt: 0.25 }}>
                    68% captured · B2-F14-Room 1402
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, flexShrink: 0 }}>
                  <Box
                    component={Link}
                    to="/tours"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      px: 1.5,
                      py: 0.625,
                      borderRadius: '8px',
                      background: colors.primary,
                      color: colors.white,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                      '&:hover': { opacity: 0.88 },
                      transition: `opacity ${motion.durationFast}`,
                    }}
                  >
                    <PlayArrowRounded sx={{ fontSize: 14 }} />
                    Continue
                  </Box>
                  <Box
                    component={Link}
                    to="/projects/1"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.5,
                      px: 1.5,
                      py: 0.625,
                      borderRadius: '8px',
                      backgroundColor: colors.inkBorder,
                      border: `1px solid rgba(255,255,255,0.12)`,
                      color: colors.inkMuted,
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      textDecoration: 'none',
                      '&:hover': { color: colors.white },
                      transition: `color ${motion.durationFast}`,
                    }}
                  >
                    Open
                  </Box>
                </Box>
              </Box>

              {/* Org badge */}
              <Typography sx={{ fontSize: '0.8125rem', color: colors.inkSubdued }}>
                {user?.org_name ?? 'My Home Constructions'} · Construction Intelligence Platform
              </Typography>
            </Grid>

            {/* Right: snapshot stats */}
            <Grid size={{ xs: 12, md: 5 }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 1.5,
                }}
              >
                {stats.slice(0, 4).map(({ label, value, sub, color }) => (
                  <Box
                    key={label}
                    sx={{
                      p: 2,
                      borderRadius: '14px',
                      backgroundColor: colors.inkBorder,
                      border: `1px solid rgba(255,255,255,0.06)`,
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: '1.75rem',
                        fontWeight: 700,
                        letterSpacing: '-0.04em',
                        color: colors.white,
                        lineHeight: 1,
                        mb: 0.375,
                      }}
                    >
                      {value}
                    </Typography>
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.inkMuted }}>
                      {label}
                    </Typography>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.inkSubdued, mt: 0.125 }}>
                      {sub}
                    </Typography>
                    <Box
                      sx={{
                        width: 20,
                        height: 2,
                        borderRadius: '1px',
                        backgroundColor: color,
                        mt: 1.25,
                        opacity: 0.7,
                      }}
                    />
                  </Box>
                ))}
              </Box>

              {/* Pending reviews callout */}
              {stats[4].value !== '0' && (
                <Box
                  component={Link}
                  to="/captures"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    mt: 1.5,
                    p: 1.5,
                    borderRadius: '14px',
                    backgroundColor: 'rgba(217,119,6,0.12)',
                    border: '1px solid rgba(217,119,6,0.25)',
                    textDecoration: 'none',
                    '&:hover': { backgroundColor: 'rgba(217,119,6,0.18)' },
                    transition: `background ${motion.durationFast}`,
                  }}
                >
                  <WarningAmberRounded sx={{ color: '#d97706', fontSize: 18, flexShrink: 0 }} />
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fbbf24' }}>
                      {stats[4].value} captures pending review
                    </Typography>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.inkMuted }}>
                      Assigned to you · tap to review
                    </Typography>
                  </Box>
                  <ArrowForwardRounded sx={{ fontSize: 14, color: '#d97706', flexShrink: 0 }} />
                </Box>
              )}
            </Grid>

          </Grid>
        </Box>
      </Box>

      {/* ── SECTION LABEL ─────────────────────────────────────────────────────── */}
      <Typography
        sx={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: colors.textSubdued,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          mb: 2.5,
        }}
      >
        Project Overview
      </Typography>

      {/* ── MIDDLE ROW ────────────────────────────────────────────────────────── */}
      <Grid container spacing={2.5} alignItems="flex-start" sx={{ mb: 5 }}>

        {/* Project progress */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box>
            {projectProgress.map((proj, i) => {
              const st = progressStatusConfig[proj.status];
              const isLast = i === projectProgress.length - 1;
              return (
                <Box key={proj.name}>
                  <Box
                    sx={{
                      py: 2,
                      '&:hover .proj-arrow': { opacity: 1, transform: 'translateX(3px)' },
                      cursor: 'pointer',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      {/* Color swatch */}
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: '10px',
                          background: proj.gradient,
                          flexShrink: 0,
                        }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>
                            {proj.name}
                          </Typography>
                          <Chip
                            label={st.label}
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: '0.625rem',
                              fontWeight: 600,
                              color: st.color,
                              backgroundColor: st.bg,
                              borderRadius: '5px',
                              flexShrink: 0,
                            }}
                          />
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2.5, mb: 1 }}>
                          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
                            <span style={{ color: colors.textSecondary, fontWeight: 600 }}>{proj.towers}</span> towers
                          </Typography>
                          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
                            <span style={{ color: colors.textSecondary, fontWeight: 600 }}>{proj.captures}/{proj.total}</span> captures
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <LinearProgress
                            variant="determinate"
                            value={proj.progress}
                            sx={{
                              flex: 1,
                              height: 4,
                              borderRadius: '99px',
                              backgroundColor: `${proj.color}18`,
                              '& .MuiLinearProgress-bar': {
                                borderRadius: '99px',
                                background: proj.color,
                              },
                            }}
                          />
                          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: proj.color, flexShrink: 0, minWidth: 36, textAlign: 'right' }}>
                            {proj.progress}%
                          </Typography>
                        </Box>
                      </Box>
                      <ArrowForwardRounded
                        className="proj-arrow"
                        sx={{
                          fontSize: 15,
                          color: colors.textSubdued,
                          opacity: 0,
                          transition: `opacity ${motion.durationFast} ${motion.easeOut}, transform ${motion.durationFast} ${motion.easeOut}`,
                          flexShrink: 0,
                        }}
                      />
                    </Box>
                  </Box>
                  {!isLast && <Divider sx={{ borderColor: colors.borderLight }} />}
                </Box>
              );
            })}

            <Box sx={{ mt: 2 }}>
              <Box
                component={Link}
                to="/projects"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  color: colors.primary,
                  textDecoration: 'none',
                  '&:hover': { opacity: 0.75 },
                }}
              >
                View all projects <ArrowForwardRounded sx={{ fontSize: 14 }} />
              </Box>
            </Box>
          </Box>
        </Grid>

        {/* Quick actions */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box
            sx={{
              borderRadius: '16px',
              backgroundColor: colors.card,
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
            }}
          >
            <Box sx={{ px: 2.5, pt: 2.5, pb: 1.5 }}>
              <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                Quick Actions
              </Typography>
            </Box>
            {[
              { icon: <AddRounded />,          label: 'Create Project',   desc: 'Start a new project',    href: '/projects', color: colors.primary },
              { icon: <CloudUploadRounded />,   label: 'Upload Captures',  desc: 'Add 360° images',        href: '/captures', color: '#0891b2' },
              { icon: <ViewInArRounded />,      label: 'Open Viewer',      desc: 'Browse virtual tours',   href: '/tours',    color: '#7c3aed' },
            ].map((action, i, arr) => (
              <React.Fragment key={action.label}>
                <Box
                  component={Link}
                  to={action.href}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2.5,
                    py: 1.5,
                    textDecoration: 'none',
                    '&:hover': { backgroundColor: colors.bg },
                    '&:hover .qa-arrow': { opacity: 1, transform: 'translateX(3px)' },
                    transition: `background ${motion.durationFast}`,
                  }}
                >
                  <Box
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: '9px',
                      backgroundColor: `${action.color}14`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: action.color,
                      flexShrink: 0,
                      '& svg': { fontSize: 18 },
                    }}
                  >
                    {action.icon}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{action.label}</Typography>
                    <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{action.desc}</Typography>
                  </Box>
                  <ArrowForwardRounded
                    className="qa-arrow"
                    sx={{ fontSize: 14, color: colors.textSubdued, opacity: 0, transition: `opacity ${motion.durationFast}, transform ${motion.durationFast}`, flexShrink: 0 }}
                  />
                </Box>
                {i < arr.length - 1 && <Divider sx={{ borderColor: colors.borderLight, mx: 2.5 }} />}
              </React.Fragment>
            ))}
            <Box sx={{ p: 1.5, pt: 1 }} />
          </Box>
        </Grid>
      </Grid>

      {/* ── SECTION LABEL ─────────────────────────────────────────────────────── */}
      <Typography
        sx={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: colors.textSubdued,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          mb: 2.5,
        }}
      >
        Activity
      </Typography>

      {/* ── BOTTOM ROW ────────────────────────────────────────────────────────── */}
      <Grid container spacing={2.5}>

        {/* Recent Uploads */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>
                Recent Uploads
              </Typography>
              <Box
                component={Link}
                to="/captures"
                sx={{ fontSize: '0.8125rem', color: colors.primary, fontWeight: 500, textDecoration: 'none', '&:hover': { opacity: 0.75 } }}
              >
                View all
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {recentUploads.map((item, i) => {
                const st = uploadStatusConfig[item.status];
                const isLast = i === recentUploads.length - 1;
                return (
                  <Box key={i}>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        py: 1.5,
                        '&:hover': { backgroundColor: colors.bgDeep, borderRadius: '10px', px: 1.25, mx: -1.25 },
                        transition: `background ${motion.durationFast}`,
                      }}
                    >
                      <Box
                        sx={{
                          width: 36,
                          height: 36,
                          borderRadius: '9px',
                          backgroundColor: `${st.color}12`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <CameraAltRounded sx={{ fontSize: 16, color: st.color }} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>
                          {item.name}
                        </Typography>
                        <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
                          {item.project}
                        </Typography>
                      </Box>
                      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                        <Chip
                          label={st.label}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.625rem',
                            fontWeight: 600,
                            color: st.color,
                            backgroundColor: `${st.color}12`,
                            borderRadius: '5px',
                            mb: 0.25,
                            display: 'flex',
                          }}
                        />
                        <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{item.time}</Typography>
                      </Box>
                    </Box>
                    {!isLast && <Divider sx={{ borderColor: colors.borderLight }} />}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Grid>

        {/* Pending Reviews */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>
                  Pending Review
                </Typography>
                <Box
                  sx={{
                    minWidth: 20,
                    height: 20,
                    borderRadius: '99px',
                    backgroundColor: colors.warning,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    px: 0.75,
                  }}
                >
                  {pendingReviews.length}
                </Box>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, mb: 2 }}>
              {pendingReviews.map((item, i) => {
                const isLast = i === pendingReviews.length - 1;
                return (
                  <Box key={i}>
                    <Box
                      sx={{
                        py: 1.5,
                        cursor: 'pointer',
                        '&:hover': { backgroundColor: colors.bgDeep, borderRadius: '10px', px: 1.25, mx: -1.25 },
                        transition: `background ${motion.durationFast}`,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>
                            {item.room}
                          </Typography>
                          <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>
                            {item.project}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                          <WarningAmberRounded sx={{ fontSize: 15, color: colors.warning }} />
                          <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, mt: 0.25 }}>{item.uploaded}</Typography>
                        </Box>
                      </Box>
                    </Box>
                    {!isLast && <Divider sx={{ borderColor: colors.borderLight }} />}
                  </Box>
                );
              })}
            </Box>

            <Box
              component={Link}
              to="/captures"
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.75,
                py: 1,
                borderRadius: '10px',
                backgroundColor: `rgba(217,119,6,0.1)`,
                color: colors.warning,
                fontWeight: 600,
                fontSize: '0.8125rem',
                textDecoration: 'none',
                '&:hover': { backgroundColor: `rgba(217,119,6,0.16)` },
                transition: `background ${motion.durationFast}`,
              }}
            >
              <CheckCircleRounded sx={{ fontSize: 16 }} />
              Review {pendingReviews.length} pending captures
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
