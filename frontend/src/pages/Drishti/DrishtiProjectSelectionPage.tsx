import { useMemo, useState } from 'react';
import { Box, Typography, TextField, CircularProgress, InputAdornment } from '@mui/material';
import { SearchRounded, AutoAwesomeRounded, InsightsRounded, ApartmentRounded } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useDrishtiProjects } from '@/hooks/useDrishti';

function ProjectCard({
  projectId, projectName, towerCount, floorCount, overallProgressPct, onClick,
}: {
  projectId: string; projectName: string; towerCount: number; floorCount: number;
  overallProgressPct: number | null; onClick: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 2.5, borderRadius: '14px', border: `1px solid ${colors.border}`,
        backgroundColor: colors.card, cursor: 'pointer',
        transition: `all ${motion.durationFast}`,
        '&:hover': { borderColor: colors.primary + '55', transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(15,23,42,0.07)' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Box sx={{
          width: 38, height: 38, borderRadius: '10px', backgroundColor: colors.primary + '12',
          color: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ApartmentRounded sx={{ fontSize: 18 }} />
        </Box>
        <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>
          {projectName}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1 }}>
        {towerCount} tower{towerCount === 1 ? '' : 's'} · {floorCount} floor{floorCount === 1 ? '' : 's'}
      </Typography>
      {overallProgressPct !== null ? (
        <Box sx={{
          display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.375, borderRadius: '8px',
          backgroundColor: colors.success + '12', color: colors.success, fontSize: '0.75rem', fontWeight: 700,
        }}>
          {overallProgressPct}% overall progress
        </Box>
      ) : (
        <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>
          Not yet analyzed
        </Typography>
      )}
    </Box>
  );
}

export default function DrishtiProjectSelectionPage() {
  const navigate = useNavigate();
  const { data: projects, isLoading } = useDrishtiProjects();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(p => p.projectName.toLowerCase().includes(q));
  }, [projects, search]);

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 4, mt: 2 }}>
        <Box sx={{
          width: 52, height: 52, borderRadius: '14px', backgroundColor: colors.primary + '12',
          color: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center',
          mx: 'auto', mb: 2,
        }}>
          <AutoAwesomeRounded sx={{ fontSize: 26 }} />
        </Box>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.02em' }}>
          Drishti
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mt: 0.5 }}>
          Construction Intelligence Assistant
        </Typography>
        <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mt: 1.5, maxWidth: 480, mx: 'auto' }}>
          Understand your project progress, finishing status, quality, captures and completion outlook.
          Select a project to get started.
        </Typography>
      </Box>

      <TextField
        fullWidth
        placeholder="Search projects..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="small"
        sx={{ mb: 3 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRounded sx={{ fontSize: 18, color: colors.textSubdued }} />
              </InputAdornment>
            ),
          },
        }}
      />

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : filtered.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <InsightsRounded sx={{ fontSize: 36, color: colors.textSubdued, mb: 1 }} />
          <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>
            {projects?.length ? 'No projects match your search.' : 'No projects available yet. Run a Construction Progress analysis first.'}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
          {filtered.map((p) => (
            <ProjectCard
              key={p.projectId}
              projectId={p.projectId}
              projectName={p.projectName}
              towerCount={p.towerCount}
              floorCount={p.floorCount}
              overallProgressPct={p.overallProgressPct}
              onClick={() => navigate(`/drishti/${p.projectId}`)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
