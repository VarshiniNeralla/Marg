import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, InputBase, Menu, MenuItem } from '@mui/material';
import {
  ViewInArRounded, PlayArrowRounded, CameraAltRounded,
  KeyboardArrowDownRounded, CheckRounded, SearchRounded, ArrowBackRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { statusConfig } from '@/data/mockData';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore } from '@store/authStore';

const STATUS_DOT: Record<string, string> = {
  published:  colors.success,
  in_review:  colors.warning,
  processing: colors.info ?? '#0891b2',
  draft:      colors.textSubdued,
};

const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;
const P = {
  border:   '#e4e7ec',
  muted:    '#6b7280',
  subtle:   '#9ca3af',
  strong:   '#111827',
  blue:     '#2563eb',
  blueSoft: 'rgba(37,99,235,0.08)',
  white:    '#ffffff',
  bg:       '#f7f8fa',
};

export default function ToursPage() {
  const user = useAuthStore(s => s.user);
  const [projectId, setProjectId]     = useState<string>('all');
  const [query, setQuery]             = useState('');
  const [menuAnchor, setMenuAnchor]   = useState<null | HTMLElement>(null);
  const [statusAnchor, setStatusAnchor] = useState<null | HTMLElement>(null);
  const [statusFilter, setStatusFilter] = useState<string>('All');

  const allTours    = useWorkflowStore(s => s.tours);
  const allProjects = useWorkflowStore(s => s.projects);

  const projects = useMemo(() => allProjects.filter(p => !p.archived), [allProjects]);

  const filtered = useMemo(() => allTours.filter(t => {
    const matchProject = projectId === 'all' || t.projectId === projectId;
    const matchStatus  = statusFilter === 'All' || t.status === statusFilter;
    const q = query.trim().toLowerCase();
    const matchQuery = !q || t.roomName.toLowerCase().includes(q) || t.projectName.toLowerCase().includes(q) || t.towerName.toLowerCase().includes(q);
    return matchProject && matchStatus && matchQuery;
  }), [allTours, projectId, statusFilter, query]);

  const selectedProject = projects.find(p => p.id === projectId);
  const selectedCount   = projectId === 'all' ? allTours.length : allTours.filter(t => t.projectId === projectId).length;

  const STATUS_OPTIONS = ['All', 'published', 'in_review', 'processing', 'draft'];
  const STATUS_LABELS: Record<string, string> = {
    All: 'All status', published: 'Published', in_review: 'In Review',
    processing: 'Processing', draft: 'Draft',
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>
      {/* Back to overview (all roles) */}
      <Box component={Link} to={`/dashboard/${user?.role === 'field_engineer' ? 'engineer' : user?.role ?? 'admin'}`} sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${P.border}`, color: P.muted,
        fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
        transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
      }}>
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
      </Box>

      {/* Heading */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>
          Virtual Tours
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
          {allTours.length} tour{allTours.length !== 1 ? 's' : ''} · {projects.length} project{projects.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, mb: 3, flexWrap: 'wrap' }}>
        {/* Project pill */}
        <Box
          onClick={e => setMenuAnchor(e.currentTarget)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${menuAnchor ? P.blue : P.border}`,
            backgroundColor: menuAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            flex: { xs: '1 1 0%', sm: 'initial' }, justifyContent: 'space-between', order: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
            <Box sx={{ width: 18, height: 18, borderRadius: '5px', background: selectedProject ? selectedProject.gradient : `linear-gradient(135deg,${P.subtle},${P.muted})`, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedProject ? selectedProject.name : 'All projects'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
            <Box sx={{ px: 0.75, py: 0.25, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted }}>
              {selectedCount}
            </Box>
            <KeyboardArrowDownRounded sx={{ fontSize: 16, color: P.muted, transform: menuAnchor ? 'rotate(180deg)' : 'none', transition: T }} />
          </Box>
        </Box>

        <Box sx={{ flex: 1, order: 2, display: { xs: 'none', sm: 'block' } }} />

        {/* Search */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          width: { xs: '100%', sm: 220 }, px: 1.25, py: 0.75,
          borderRadius: '10px', backgroundColor: P.white,
          border: `1.5px solid ${P.border}`, transition: T,
          '&:focus-within': { borderColor: P.blue }, order: 3,
        }}>
          <SearchRounded sx={{ fontSize: 16, color: P.subtle, flexShrink: 0 }} />
          <InputBase placeholder="Search tours…" value={query} onChange={e => setQuery(e.target.value)} sx={{ flex: 1, fontSize: '0.8125rem', '& input::placeholder': { color: P.subtle, opacity: 1 } }} />
        </Box>

        {/* Status pill */}
        <Box
          onClick={e => setStatusAnchor(e.currentTarget)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${statusAnchor ? P.blue : P.border}`,
            backgroundColor: statusAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            flex: { xs: '1 1 0%', sm: 'initial' }, justifyContent: 'space-between',
            order: { xs: 2, sm: 4 },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: STATUS_DOT[statusFilter] ?? P.subtle, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
              {STATUS_LABELS[statusFilter]}
            </Typography>
          </Box>
          <KeyboardArrowDownRounded sx={{ fontSize: 16, color: P.muted, transform: statusAnchor ? 'rotate(180deg)' : 'none', transition: T, flexShrink: 0 }} />
        </Box>
      </Box>

      {/* Project menu */}
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1, width: { xs: menuAnchor ? menuAnchor.offsetWidth : 'auto', sm: 280 }, minWidth: { sm: 280 }, maxWidth: 'calc(100vw - 32px)', borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {[{ id: 'all', name: 'All projects', gradient: `linear-gradient(135deg,${P.subtle},${P.muted})`, count: allTours.length },
          ...projects.map(p => ({ id: p.id, name: p.name, gradient: p.gradient, count: allTours.filter(t => t.projectId === p.id).length }))]
          .map(opt => {
            const isActive = projectId === opt.id;
            return (
              <MenuItem key={opt.id} onClick={() => { setProjectId(opt.id); setMenuAnchor(null); }}
                sx={{ borderRadius: '10px', py: 1, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
              >
                <Box sx={{ width: 22, height: 22, borderRadius: '7px', background: opt.gradient, flexShrink: 0 }} />
                <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong }}>
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
      <Menu anchorEl={statusAnchor} open={!!statusAnchor} onClose={() => setStatusAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 180, maxWidth: 'calc(100vw - 32px)', borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {STATUS_OPTIONS.map(s => {
          const isActive = statusFilter === s;
          return (
            <MenuItem key={s} onClick={() => { setStatusFilter(s); setStatusAnchor(null); }}
              sx={{ borderRadius: '10px', py: 0.875, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATUS_DOT[s] ?? P.subtle, flexShrink: 0 }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong }}>
                {STATUS_LABELS[s]}
              </Typography>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <ViewInArRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>No tours found</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Try a different project, search, or filter.</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)' }, gap: 2 }}>
          {filtered.map(tour => {
            const st = (statusConfig.tour as Record<string, { label: string; color: string; bg: string }>)[tour.status] ?? statusConfig.tour.draft;
            const dot = STATUS_DOT[tour.status] ?? P.subtle;
            return (
              <Box
                key={tour.id}
                component={Link}
                to={`/tours/${tour.id}`}
                sx={{
                  display: 'block', textDecoration: 'none',
                  transition: `transform ${motion.durationNormal} ${motion.easeOut}`,
                  '&:hover': { transform: 'translateY(-3px)' },
                  '&:hover .tour-thumb': { boxShadow: '0 12px 32px rgba(15,23,42,0.14)' },
                  '&:hover .tour-play': { opacity: 1, transform: 'scale(1)' },
                }}
              >
                {/* Thumbnail */}
                <Box
                  className="tour-thumb"
                  sx={{
                    position: 'relative', aspectRatio: '4 / 3', borderRadius: '14px', overflow: 'hidden',
                    background: tour.gradient,
                    boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
                    transition: `box-shadow ${motion.durationNormal} ${motion.easeOut}`,
                  }}
                >
                  {/* Play button on hover */}
                  <Box className="tour-play" sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transform: 'scale(0.85)', transition: `opacity ${motion.durationNormal} ${motion.easeOut}, transform ${motion.durationNormal} ${motion.easeOut}` }}>
                    <Box sx={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PlayArrowRounded sx={{ color: '#fff', fontSize: 24 }} />
                    </Box>
                  </Box>
                  {/* 360° badge */}
                  <Box sx={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 0.5, px: 0.875, py: 0.375, borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }}>
                    <ViewInArRounded sx={{ color: '#fff', fontSize: 11 }} />
                    <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>360°</Typography>
                  </Box>
                  {/* Status badge */}
                  <Box sx={{ position: 'absolute', top: 8, right: 8, px: 1, py: 0.375, borderRadius: '5px', backgroundColor: st.bg, fontSize: '0.5625rem', fontWeight: 700, color: st.color }}>
                    {st.label}
                  </Box>
                </Box>

                {/* Metadata */}
                <Box sx={{ pt: 1.25, px: 0.25 }}>
                  <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em' }}>
                    {tour.roomName}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.375 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
                    <Typography noWrap sx={{ fontSize: '0.75rem', color: P.muted }}>
                      {tour.towerName} · {tour.floorLabel}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.375, color: P.subtle }}>
                    <CameraAltRounded sx={{ fontSize: 11 }} />
                    <Typography sx={{ fontSize: '0.6875rem', color: 'inherit' }}>{tour.captures} captures</Typography>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
