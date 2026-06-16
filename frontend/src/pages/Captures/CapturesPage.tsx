import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Chip, InputBase } from '@mui/material';
import {
  CameraAltRounded, ViewInArRounded, SearchRounded, FolderRounded,
  HomeRounded, LayersRounded, GridViewRounded, ViewListRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  mockCaptures, mockProjects, mockTours, statusConfig,
  getRoomHistory, type MockCapture,
} from '@/data/mockData';

// 7F — Project-aware capture gallery. Captures are grouped Project → Tower → Floor,
// thumbnails are prominent, and per-card metadata is intentionally light.

const STATUS_FILTERS = ['All', 'Processed', 'In Review', 'Rejected'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function CaptureCard({ capture }: { capture: MockCapture }) {
  const st = statusConfig.capture[capture.status];
  const history = getRoomHistory(capture.id);
  const hasTour = mockTours.some(t => t.captureId === capture.id);

  return (
    <Box
      component={Link}
      to={`/captures/${capture.id}`}
      sx={{
        display: 'block', textDecoration: 'none',
        borderRadius: '16px', backgroundColor: colors.card, overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
        transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}`,
        '&:hover': { boxShadow: '0 10px 36px rgba(15,23,42,0.12)', transform: 'translateY(-3px)' },
        '&:hover .cap-overlay': { opacity: 1 },
      }}
    >
      {/* Prominent thumbnail */}
      <Box sx={{ height: 156, background: capture.gradient, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CameraAltRounded sx={{ color: 'rgba(255,255,255,0.22)', fontSize: 40 }} />

        {/* hover CTA */}
        <Box className="cap-overlay" sx={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, opacity: 0, transition: `opacity ${motion.durationFast}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.625, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)' }}>
            <ViewInArRounded sx={{ color: '#fff', fontSize: 15 }} />
            <Typography sx={{ fontSize: '0.75rem', color: '#fff', fontWeight: 600 }}>{hasTour ? 'View tour' : 'Open capture'}</Typography>
          </Box>
        </Box>

        {/* status + tour badges */}
        <Box sx={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {hasTour
            ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, px: 0.875, py: 0.25, borderRadius: '5px', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}><ViewInArRounded sx={{ fontSize: 11, color: '#fff' }} /><Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: '#fff' }}>TOUR</Typography></Box>
            : <Box />}
          <Chip label={st.label} size="small" sx={{ height: 20, fontSize: '0.5625rem', fontWeight: 700, color: st.color, backgroundColor: st.bg, borderRadius: '5px' }} />
        </Box>

        {/* capture-count chip (room series) */}
        {history && history.captureCount > 1 && (
          <Box sx={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', alignItems: 'center', gap: 0.375, px: 0.875, py: 0.25, borderRadius: '5px', backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}>
            <CameraAltRounded sx={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }} />
            <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: '#fff' }}>{history.captureCount}</Typography>
          </Box>
        )}
      </Box>

      {/* Light metadata */}
      <Box sx={{ px: 1.75, pt: 1.25, pb: 1.5 }}>
        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em' }}>{capture.roomName}</Typography>
        <Typography noWrap sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.25 }}>
          {history ? `Updated ${history.latest.dateLabel}` : capture.uploadedAt}
        </Typography>
      </Box>
    </Box>
  );
}

export default function CapturesPage() {
  const [filter, setFilter] = useState<StatusFilter>('All');
  const [query, setQuery] = useState('');
  const [grouped, setGrouped] = useState(true);

  const filtered = useMemo(() => {
    return mockCaptures.filter(c => {
      const matchesStatus = filter === 'All' || statusConfig.capture[c.status]?.label === filter;
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || c.roomName.toLowerCase().includes(q) || c.projectName.toLowerCase().includes(q) || c.towerName.toLowerCase().includes(q) || c.floorLabel.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [filter, query]);

  // Group: project → tower → floor
  const groups = useMemo(() => {
    const byProject = new Map<string, { project: typeof mockProjects[0] | undefined; towers: Map<string, { towerName: string; floors: Map<string, MockCapture[]> }> }>();
    for (const c of filtered) {
      if (!byProject.has(c.projectId)) {
        byProject.set(c.projectId, { project: mockProjects.find(p => p.id === c.projectId), towers: new Map() });
      }
      const proj = byProject.get(c.projectId)!;
      if (!proj.towers.has(c.towerId)) proj.towers.set(c.towerId, { towerName: c.towerName, floors: new Map() });
      const tower = proj.towers.get(c.towerId)!;
      if (!tower.floors.has(c.floorLabel)) tower.floors.set(c.floorLabel, []);
      tower.floors.get(c.floorLabel)!.push(c);
    }
    return byProject;
  }, [filtered]);

  const pendingCount = mockCaptures.filter(c => c.status === 'review').length;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>
          Capture Gallery
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          {mockCaptures.length} captures across {mockProjects.length} projects · {pendingCount} pending review
        </Typography>
      </Box>

      {/* Toolbar: search + filters + layout toggle */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.875, borderRadius: '10px', backgroundColor: colors.card, boxShadow: '0 1px 3px rgba(15,23,42,0.06)', flex: { xs: '1 1 100%', sm: '0 1 320px' } }}>
          <SearchRounded sx={{ fontSize: 18, color: colors.textSubdued }} />
          <InputBase placeholder="Search room, project, tower…" value={query} onChange={e => setQuery(e.target.value)} sx={{ flex: 1, fontSize: '0.875rem', '& input::placeholder': { color: colors.textSubdued, opacity: 1 } }} />
        </Box>

        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(f => (
            <Box key={f} onClick={() => setFilter(f)} sx={{ px: 1.5, py: 0.75, borderRadius: '8px', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: filter === f ? 600 : 400, backgroundColor: filter === f ? colors.ink : colors.card, color: filter === f ? colors.white : colors.textSecondary, boxShadow: filter === f ? 'none' : '0 1px 3px rgba(15,23,42,0.06)', transition: `all ${motion.durationFast}`, '&:hover': { color: filter === f ? colors.white : colors.textStrong } }}>
              {f}
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, p: 0.375, borderRadius: '10px', backgroundColor: colors.bgDeep, ml: { sm: 'auto' } }}>
          {([['grouped', <GridViewRounded sx={{ fontSize: 16 }} />], ['flat', <ViewListRounded sx={{ fontSize: 16 }} />]] as const).map(([mode, icon]) => (
            <Box key={mode} onClick={() => setGrouped(mode === 'grouped')} sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.625, borderRadius: '8px', cursor: 'pointer', color: (grouped ? 'grouped' : 'flat') === mode ? colors.textStrong : colors.textMuted, backgroundColor: (grouped ? 'grouped' : 'flat') === mode ? '#fff' : 'transparent', boxShadow: (grouped ? 'grouped' : 'flat') === mode ? '0 1px 3px rgba(15,23,42,0.10)' : 'none', transition: `all ${motion.durationFast}` }}>
              {icon}
            </Box>
          ))}
        </Box>
      </Box>

      {/* Empty state */}
      {filtered.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 10 }}>
          <Box sx={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
            <CameraAltRounded sx={{ fontSize: 28, color: colors.textSubdued }} />
          </Box>
          <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: colors.textSecondary, mb: 0.5 }}>No captures found</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>Try a different search or status filter.</Typography>
        </Box>
      )}

      {/* Grouped gallery */}
      {filtered.length > 0 && grouped && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Array.from(groups.values()).map(({ project, towers }) => (
            <Box key={project?.id}>
              {/* Project heading */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: '10px', background: project?.gradient, flexShrink: 0 }} />
                <Box sx={{ flex: 1 }}>
                  <Box component={Link} to={`/projects/${project?.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.625, textDecoration: 'none' }}>
                    <FolderRounded sx={{ fontSize: 15, color: colors.textSubdued }} />
                    <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em', '&:hover': { color: colors.primary } }}>{project?.name}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{project?.location}</Typography>
                </Box>
              </Box>

              {/* Towers → floors */}
              {Array.from(towers.values()).map(({ towerName, floors }) => (
                <Box key={towerName} sx={{ mb: 2.5, pl: { md: 1.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.625, mb: 1.5 }}>
                    <HomeRounded sx={{ fontSize: 13, color: colors.textSubdued }} />
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textSecondary }}>{towerName}</Typography>
                  </Box>
                  {Array.from(floors.entries()).map(([floorLabel, captures]) => (
                    <Box key={floorLabel} sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.25, pl: { md: 1.5 } }}>
                        <LayersRounded sx={{ fontSize: 12, color: colors.textSubdued }} />
                        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{floorLabel}</Typography>
                        <Box sx={{ flex: 1, height: 1, backgroundColor: colors.borderLight, ml: 1 }} />
                        <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{captures.length} {captures.length === 1 ? 'room' : 'rooms'}</Typography>
                      </Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(5, 1fr)' }, gap: 2, pl: { md: 1.5 } }}>
                        {captures.map(c => <CaptureCard key={c.id} capture={c} />)}
                      </Box>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}

      {/* Flat gallery */}
      {filtered.length > 0 && !grouped && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(5, 1fr)' }, gap: 2 }}>
          {filtered.map(c => <CaptureCard key={c.id} capture={c} />)}
        </Box>
      )}
    </Box>
  );
}
