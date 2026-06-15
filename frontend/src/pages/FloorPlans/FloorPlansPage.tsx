import React, { useState } from 'react';
import { Box, Typography, Grid } from '@mui/material';
import {
  LayersRounded,
  MeetingRoomRounded,
  ViewInArRounded,
  ArrowForwardRounded,
  NavigateNextRounded,
  NavigateBeforeRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';

// ── Mock data ──────────────────────────────────────────────────────────────────

const projects = [
  {
    id: '1',
    name: 'My Home Udyan',
    gradient: colors.projectA,
    accent: colors.primary,
    towers: [
      {
        id: 't1',
        name: 'Tower A1',
        floors: [
          { number: 14, rooms: 4, mapped: 4, label: 'Floor 14' },
          { number: 13, rooms: 4, mapped: 3, label: 'Floor 13' },
          { number: 12, rooms: 4, mapped: 2, label: 'Floor 12' },
          { number: 11, rooms: 4, mapped: 1, label: 'Floor 11' },
          { number: 10, rooms: 4, mapped: 0, label: 'Floor 10' },
        ],
      },
      {
        id: 't2',
        name: 'Tower B2',
        floors: [
          { number: 8, rooms: 6, mapped: 6, label: 'Floor 8' },
          { number: 7, rooms: 6, mapped: 5, label: 'Floor 7' },
          { number: 6, rooms: 6, mapped: 2, label: 'Floor 6' },
          { number: 5, rooms: 6, mapped: 0, label: 'Floor 5' },
        ],
      },
    ],
  },
  {
    id: '2',
    name: 'My Home Grava Residences',
    gradient: colors.projectC,
    accent: '#d97706',
    towers: [
      {
        id: 't1',
        name: 'Tower T1',
        floors: [
          { number: 5, rooms: 4, mapped: 3, label: 'Floor 5' },
          { number: 4, rooms: 4, mapped: 2, label: 'Floor 4' },
          { number: 3, rooms: 4, mapped: 1, label: 'Floor 3' },
        ],
      },
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function FloorPlansPage() {
  const [selectedProject, setSelectedProject] = useState(projects[0]);
  const [selectedTower, setSelectedTower] = useState(projects[0].towers[0]);

  function handleProjectChange(proj: typeof projects[0]) {
    setSelectedProject(proj);
    setSelectedTower(proj.towers[0]);
  }

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
          Floor Plans
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          Browse floors and room capture status
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Left: project + tower selector */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.5 }}>
              Projects
            </Typography>
            {projects.map((proj) => (
              <Box
                key={proj.id}
                onClick={() => handleProjectChange(proj)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  p: 1.5,
                  borderRadius: '14px',
                  cursor: 'pointer',
                  backgroundColor: selectedProject.id === proj.id ? colors.card : 'transparent',
                  boxShadow: selectedProject.id === proj.id ? '0 2px 8px rgba(15,23,42,0.05)' : 'none',
                  transition: `all ${motion.durationFast} ${motion.easeOut}`,
                  '&:hover': { backgroundColor: colors.card },
                }}
              >
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '10px',
                    background: proj.gradient,
                    flexShrink: 0,
                  }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>
                    {proj.name}
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
                    {proj.towers.length} {proj.towers.length === 1 ? 'tower' : 'towers'}
                  </Typography>
                </Box>
              </Box>
            ))}

            {selectedProject.towers.length > 1 && (
              <Box sx={{ mt: 1 }}>
                <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1 }}>
                  Towers
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {selectedProject.towers.map((t) => (
                    <Box
                      key={t.id}
                      onClick={() => setSelectedTower(t)}
                      sx={{
                        px: 1.5,
                        py: 0.625,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        backgroundColor: selectedTower.id === t.id ? selectedProject.accent : colors.bgDeep,
                        color: selectedTower.id === t.id ? colors.white : colors.textSecondary,
                        fontSize: '0.8125rem',
                        fontWeight: selectedTower.id === t.id ? 600 : 400,
                        transition: `all ${motion.durationFast}`,
                        '&:hover': { backgroundColor: selectedTower.id === t.id ? selectedProject.accent : colors.border },
                      }}
                    >
                      {t.name}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        </Grid>

        {/* Right: floor list */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Box
            sx={{
              borderRadius: '20px',
              backgroundColor: colors.card,
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
            }}
          >
            <Box
              sx={{
                px: 3,
                pt: 2.5,
                pb: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: `1px solid ${colors.borderLight}`,
              }}
            >
              <Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>
                  {selectedTower.name}
                </Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>
                  {selectedProject.name} · {selectedTower.floors.length} floors
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {[NavigateBeforeRounded, NavigateNextRounded].map((Icon, i) => (
                  <Box
                    key={i}
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.bgDeep,
                      cursor: 'pointer',
                      color: colors.textMuted,
                      '&:hover': { backgroundColor: colors.border },
                    }}
                  >
                    <Icon sx={{ fontSize: 18 }} />
                  </Box>
                ))}
              </Box>
            </Box>

            <Box sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {selectedTower.floors.map((floor) => {
                  const pct = Math.round((floor.mapped / floor.rooms) * 100);
                  const isComplete = floor.mapped === floor.rooms;
                  return (
                    <Box
                      key={floor.number}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        p: 1.5,
                        borderRadius: '12px',
                        cursor: 'pointer',
                        '&:hover': { backgroundColor: colors.bg },
                        '&:hover .fp-arrow': { opacity: 1, transform: 'translateX(3px)' },
                        transition: `background ${motion.durationFast}`,
                      }}
                    >
                      <Box
                        sx={{
                          width: 64,
                          height: 48,
                          borderRadius: '8px',
                          background: selectedProject.gradient,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: floor.mapped > 0 ? 1 : 0.35,
                        }}
                      >
                        <LayersRounded sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 20 }} />
                      </Box>

                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>
                            {floor.label}
                          </Typography>
                          {isComplete && (
                            <Box
                              sx={{
                                px: 0.75,
                                py: 0.125,
                                borderRadius: '4px',
                                backgroundColor: colors.successBg,
                                fontSize: '0.625rem',
                                fontWeight: 700,
                                color: colors.success,
                              }}
                            >
                              Complete
                            </Box>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textMuted }}>
                            <MeetingRoomRounded sx={{ fontSize: 12 }} />
                            <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>
                              {floor.mapped}/{floor.rooms} rooms
                            </Typography>
                          </Box>
                          {floor.mapped > 0 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textMuted }}>
                              <ViewInArRounded sx={{ fontSize: 12 }} />
                              <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>
                                {floor.mapped} tours
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      </Box>

                      <Box sx={{ width: 80, flexShrink: 0 }}>
                        <Box sx={{ height: 4, borderRadius: '99px', backgroundColor: colors.bgDeep, mb: 0.5 }}>
                          <Box
                            sx={{
                              height: '100%',
                              width: `${pct}%`,
                              borderRadius: '99px',
                              backgroundColor: isComplete ? colors.success : selectedProject.accent,
                            }}
                          />
                        </Box>
                        <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, textAlign: 'right' }}>
                          {pct}%
                        </Typography>
                      </Box>

                      <ArrowForwardRounded
                        className="fp-arrow"
                        sx={{
                          fontSize: 15,
                          color: colors.textSubdued,
                          opacity: 0,
                          transition: `opacity ${motion.durationFast}, transform ${motion.durationFast}`,
                          flexShrink: 0,
                        }}
                      />
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
