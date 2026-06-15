import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Box, Typography, Chip, LinearProgress } from '@mui/material';
import { ArrowBackRounded, LayersRounded, MeetingRoomRounded, ViewInArRounded, ArrowForwardRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { getProjectById, mockTowers, getFloors } from '@/data/mockData';

export default function FloorListPage() {
  const { projectId, towerId } = useParams<{ projectId: string; towerId: string }>();
  const project = getProjectById(projectId ?? '');
  const tower = mockTowers.find(t => t.id === towerId);
  const floors = getFloors(towerId ?? '');

  if (!project || !tower) return <Box sx={{ p: 4, color: colors.textMuted }}>Tower not found.</Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 5 }}>
        <Box component={Link} to={`/projects/${project.id}/towers`} sx={{ color: colors.textMuted, textDecoration: 'none', display: 'flex', alignItems: 'center', '&:hover': { color: colors.textStrong } }}>
          <ArrowBackRounded sx={{ fontSize: 20 }} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 0.25 }}>{project.name} · {tower.name}</Typography>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.5rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1 }}>
            Floors
          </Typography>
        </Box>
      </Box>

      <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
        <Box sx={{ px: 3, pt: 2.5, pb: 2, borderBottom: `1px solid ${colors.borderLight}` }}>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{tower.name}</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{floors.length} floors · {tower.rooms} total rooms</Typography>
        </Box>
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {floors.map(floor => {
            const pct = Math.round((floor.mapped / Math.max(floor.rooms, 1)) * 100);
            const complete = floor.mapped === floor.rooms;
            return (
              <Box
                key={floor.id}
                component={Link}
                to={`/projects/${project.id}/towers/${tower.id}/floors/${floor.id}`}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 2, p: 1.75, borderRadius: '12px', textDecoration: 'none',
                  '&:hover': { backgroundColor: colors.bg },
                  '&:hover .fl-arrow': { opacity: 1, transform: 'translateX(3px)' },
                  transition: `background ${motion.durationFast}`,
                }}
              >
                {/* Thumbnail */}
                <Box sx={{ width: 64, height: 48, borderRadius: '8px', background: project.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: floor.mapped > 0 ? 1 : 0.3 }}>
                  <LayersRounded sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 20 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{floor.label}</Typography>
                    {complete && (
                      <Box sx={{ px: 0.75, py: 0.125, borderRadius: '4px', backgroundColor: 'rgba(22,163,74,0.08)', fontSize: '0.5625rem', fontWeight: 700, color: '#16a34a' }}>Complete</Box>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textMuted }}>
                      <MeetingRoomRounded sx={{ fontSize: 12 }} />
                      <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>{floor.mapped}/{floor.rooms} rooms</Typography>
                    </Box>
                    {floor.mapped > 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, color: colors.textMuted }}>
                        <ViewInArRounded sx={{ fontSize: 12 }} />
                        <Typography sx={{ fontSize: '0.75rem', color: 'inherit' }}>{floor.mapped} tours</Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
                <Box sx={{ width: 80, flexShrink: 0 }}>
                  <Box sx={{ height: 4, borderRadius: '99px', backgroundColor: colors.bgDeep, mb: 0.5 }}>
                    <Box sx={{ height: '100%', width: `${pct}%`, borderRadius: '99px', backgroundColor: complete ? '#16a34a' : project.accent }} />
                  </Box>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, textAlign: 'right' }}>{pct}%</Typography>
                </Box>
                <ArrowForwardRounded className="fl-arrow" sx={{ fontSize: 15, color: colors.textSubdued, opacity: 0, transition: `opacity ${motion.durationFast}, transform ${motion.durationFast}`, flexShrink: 0 }} />
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
