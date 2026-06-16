import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, InputBase, Menu, MenuItem } from '@mui/material';
import { CameraAltRounded, ViewInArRounded, SearchRounded, KeyboardArrowDownRounded, CheckRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig, getRoomHistory, type MockCapture } from '@/data/mockData';
import { useWorkflowStore } from '@store/workflowStore';

// Capture gallery — project-wise selection, calm minimal cards.

const STATUS_FILTERS = ['All', 'Processed', 'In Review', 'Rejected'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const STATUS_DOT: Record<string, string> = {
  processed: colors.success,
  review: colors.warning,
  rejected: colors.danger,
  uploading: colors.info,
};

function CaptureCard({ capture, hasTour }: { capture: MockCapture; hasTour: boolean }) {
  const st = statusConfig.capture[capture.status];
  const history = getRoomHistory(capture.id);
  const dot = STATUS_DOT[capture.status] ?? colors.textSubdued;

  return (
    <Box
      component={Link}
      to={`/captures/${capture.id}`}
      sx={{
        display: 'block', textDecoration: 'none',
        transition: `transform ${motion.durationNormal} ${motion.easeOut}`,
        '&:hover': { transform: 'translateY(-3px)' },
        '&:hover .cap-thumb': { boxShadow: '0 12px 32px rgba(15,23,42,0.14)' },
        '&:hover .cap-open': { opacity: 1 },
      }}
    >
      {/* Thumbnail — soft, single subtle tint */}
      <Box
        className="cap-thumb"
        sx={{
          position: 'relative', aspectRatio: '4 / 3', borderRadius: '14px', overflow: 'hidden',
          background: capture.gradient,
          boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
          transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}`,
        }}
      >
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CameraAltRounded sx={{ color: 'rgba(255,255,255,0.25)', fontSize: 32 }} />
        </Box>

        {/* hover: single open hint */}
        <Box className="cap-open" sx={{ position: 'absolute', bottom: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', opacity: 0, transition: `opacity ${motion.durationFast}` }}>
          <ViewInArRounded sx={{ color: '#fff', fontSize: 13 }} />
          <Typography sx={{ fontSize: '0.6875rem', color: '#fff', fontWeight: 600 }}>{hasTour ? 'View tour' : 'Open'}</Typography>
        </Box>

        {/* tour marker — one quiet glyph */}
        {hasTour && (
          <Box sx={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: '7px', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ViewInArRounded sx={{ fontSize: 12, color: '#fff' }} />
          </Box>
        )}
      </Box>

      {/* Metadata — name + status dot */}
      <Box sx={{ pt: 1.25, px: 0.25 }}>
        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, letterSpacing: '-0.01em' }}>
          {capture.roomName}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.375 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
          <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
            {capture.towerName} · {capture.floorLabel}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default function CapturesPage() {
  const [projectId, setProjectId] = useState<string>('all');
  const [filter, setFilter] = useState<StatusFilter>('All');
  const [query, setQuery] = useState('');

  // Reactive: read live data from the workflow store.
  const mockCaptures = useWorkflowStore(s => s.captures);
  const allProjects = useWorkflowStore(s => s.projects);
  const tours = useWorkflowStore(s => s.tours);
  const tourCaptureIds = useMemo(() => new Set(tours.map(t => t.captureId)), [tours]);
  const PROJECTS_WITH_CAPTURES = useMemo(
    () => allProjects.filter(p => !p.archived && mockCaptures.some(c => c.projectId === p.id)),
    [allProjects, mockCaptures],
  );

  const filtered = useMemo(() => {
    return mockCaptures.filter(c => {
      const matchesProject = projectId === 'all' || c.projectId === projectId;
      const matchesStatus = filter === 'All' || statusConfig.capture[c.status]?.label === filter;
      const q = query.trim().toLowerCase();
      const matchesQuery = !q || c.roomName.toLowerCase().includes(q) || c.projectName.toLowerCase().includes(q) || c.towerName.toLowerCase().includes(q) || c.floorLabel.toLowerCase().includes(q);
      return matchesProject && matchesStatus && matchesQuery;
    });
  }, [mockCaptures, projectId, filter, query]);

  const pendingCount = mockCaptures.filter(c => c.status === 'review').length;

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [statusAnchor, setStatusAnchor] = useState<null | HTMLElement>(null);
  const selectedProject = PROJECTS_WITH_CAPTURES.find(p => p.id === projectId);
  const selectedCount = projectId === 'all' ? mockCaptures.length : mockCaptures.filter(c => c.projectId === projectId).length;

  // Dot colour for each status filter (All shows neutral).
  const STATUS_FILTER_DOT: Record<StatusFilter, string> = {
    All: colors.textSubdued, Processed: colors.success, 'In Review': colors.warning, Rejected: colors.danger,
  };

  return (
    <Box sx={{ maxWidth: 1160, mx: 'auto' }}>
      {/* ── Heading (untouched) ─────────────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>
          Capture Gallery
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          {mockCaptures.length} captures across {PROJECTS_WITH_CAPTURES.length} projects · {pendingCount} pending review
        </Typography>
      </Box>

      {/* ── Toolbar: project (left) · search + status (right) ───────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 4, flexWrap: 'wrap' }}>
        {/* Project dropdown — left */}
        <Box
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 1.25,
            pl: 1.5, pr: 1.25, py: 1, borderRadius: '999px', cursor: 'pointer',
            border: `1px solid ${menuAnchor ? colors.textStrong : colors.border}`,
            backgroundColor: colors.card,
            boxShadow: menuAnchor ? `0 0 0 3px ${colors.primaryRing}` : '0 1px 2px rgba(15,23,42,0.05)',
            transition: `all ${motion.durationFast} ${motion.easeOut}`,
            '&:hover': { borderColor: colors.textSubdued },
          }}
        >
          <Box sx={{ width: 22, height: 22, borderRadius: '7px', background: selectedProject ? selectedProject.gradient : `linear-gradient(135deg, ${colors.textSubdued} 0%, ${colors.textMuted} 100%)`, flexShrink: 0 }} />
          <Box sx={{ lineHeight: 1.1 }}>
            <Typography sx={{ fontSize: '0.625rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Project</Typography>
            <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em', maxWidth: 180 }}>
              {selectedProject ? selectedProject.name : 'All projects'}
            </Typography>
          </Box>
          <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted, ml: 0.5 }}>
            {selectedCount}
          </Box>
          <KeyboardArrowDownRounded sx={{ fontSize: 20, color: colors.textMuted, transform: menuAnchor ? 'rotate(180deg)' : 'none', transition: `transform ${motion.durationFast}` }} />
        </Box>

        {/* Spacer pushes search + status to the right */}
        <Box sx={{ flex: 1 }} />

        {/* Search — right */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: { xs: '100%', sm: 260 }, px: 1.5, py: 1, borderRadius: '999px', backgroundColor: colors.card, border: `1px solid ${colors.border}`, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', '&:focus-within': { borderColor: colors.textSubdued } }}>
          <SearchRounded sx={{ fontSize: 18, color: colors.textSubdued }} />
          <InputBase placeholder="Search captures…" value={query} onChange={e => setQuery(e.target.value)} sx={{ flex: 1, fontSize: '0.875rem', '& input::placeholder': { color: colors.textSubdued, opacity: 1 } }} />
        </Box>

        {/* Status dropdown — right */}
        <Box
          onClick={(e) => setStatusAnchor(e.currentTarget)}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0,
            pl: 1.5, pr: 1.25, py: 1.125, borderRadius: '999px', cursor: 'pointer',
            border: `1px solid ${statusAnchor ? colors.textStrong : colors.border}`,
            backgroundColor: colors.card,
            boxShadow: statusAnchor ? `0 0 0 3px ${colors.primaryRing}` : '0 1px 2px rgba(15,23,42,0.05)',
            transition: `all ${motion.durationFast} ${motion.easeOut}`,
            '&:hover': { borderColor: colors.textSubdued },
          }}
        >
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: STATUS_FILTER_DOT[filter], flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, letterSpacing: '-0.01em' }}>
            {filter === 'All' ? 'All status' : filter}
          </Typography>
          <KeyboardArrowDownRounded sx={{ fontSize: 18, color: colors.textMuted, transform: statusAnchor ? 'rotate(180deg)' : 'none', transition: `transform ${motion.durationFast}` }} />
        </Box>
      </Box>

      {/* Project menu */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 280, borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {[{ id: 'all', name: 'All projects', gradient: `linear-gradient(135deg, ${colors.textSubdued} 0%, ${colors.textMuted} 100%)`, count: mockCaptures.length },
          ...PROJECTS_WITH_CAPTURES.map(p => ({ id: p.id, name: p.name, gradient: p.gradient, count: mockCaptures.filter(c => c.projectId === p.id).length }))]
          .map(opt => {
            const isActive = projectId === opt.id;
            return (
              <MenuItem
                key={opt.id}
                onClick={() => { setProjectId(opt.id); setMenuAnchor(null); }}
                sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
              >
                <Box sx={{ width: 22, height: 22, borderRadius: '7px', background: opt.gradient, flexShrink: 0 }} />
                <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong, letterSpacing: '-0.01em' }}>
                  {opt.name}
                </Typography>
                <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
                  {opt.count}
                </Box>
                {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
              </MenuItem>
            );
          })}
      </Menu>

      {/* Status menu */}
      <Menu
        anchorEl={statusAnchor}
        open={!!statusAnchor}
        onClose={() => setStatusAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 180, borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {STATUS_FILTERS.map(f => {
          const isActive = filter === f;
          return (
            <MenuItem
              key={f}
              onClick={() => { setFilter(f); setStatusAnchor(null); }}
              sx={{ borderRadius: '10px', py: 0.875, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATUS_FILTER_DOT[f], flexShrink: 0 }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong, letterSpacing: '-0.01em' }}>
                {f === 'All' ? 'All status' : f}
              </Typography>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 12 }}>
          <Box sx={{ width: 56, height: 56, borderRadius: '16px', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
            <CameraAltRounded sx={{ fontSize: 26, color: colors.textSubdued }} />
          </Box>
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 600, color: colors.textSecondary, mb: 0.5 }}>No captures found</Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Try a different project, search, or filter.</Typography>
        </Box>
      ) : (
        /* ── Clean flat grid ──────────────────────────────────────────────── */
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(5, 1fr)' }, gap: 2.5 }}>
          {filtered.map(c => <CaptureCard key={c.id} capture={c} hasTour={tourCaptureIds.has(c.id)} />)}
        </Box>
      )}
    </Box>
  );
}
