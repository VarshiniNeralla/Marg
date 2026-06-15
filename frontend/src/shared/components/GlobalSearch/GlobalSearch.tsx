import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, IconButton } from '@mui/material';
import { SearchRounded, FolderRounded, LayersRounded, MeetingRoomRounded, CameraAltRounded, ViewInArRounded, PeopleRounded, CloseRounded } from '@mui/icons-material';
import { colors, motion, zIndex } from '@theme/tokens';
import { mockProjects, mockTowers, mockCaptures, mockTours, mockUsers, getFloors } from '@/data/mockData';

type SearchResult = { id: string; type: string; title: string; sub: string; link: string; icon: React.ReactNode; };

const typeIcon: Record<string, React.ReactNode> = {
  project:  <FolderRounded sx={{ fontSize: 14 }} />,
  tower:    <LayersRounded sx={{ fontSize: 14 }} />,
  floor:    <LayersRounded sx={{ fontSize: 14 }} />,
  room:     <MeetingRoomRounded sx={{ fontSize: 14 }} />,
  capture:  <CameraAltRounded sx={{ fontSize: 14 }} />,
  tour:     <ViewInArRounded sx={{ fontSize: 14 }} />,
  user:     <PeopleRounded sx={{ fontSize: 14 }} />,
};
const typeColor: Record<string, string> = {
  project: '#2563eb', tower: '#7c3aed', floor: '#0891b2', room: '#059669',
  capture: '#d97706', tour: '#16a34a', user: '#64748b',
};

function buildIndex(): SearchResult[] {
  const results: SearchResult[] = [];
  mockProjects.forEach(p => results.push({ id: p.id, type: 'project', title: p.name, sub: p.location, link: `/projects/${p.id}`, icon: typeIcon.project }));
  mockTowers.forEach(t => {
    const p = mockProjects.find(pr => pr.id === t.projectId);
    results.push({ id: t.id, type: 'tower', title: `${t.name}`, sub: p?.name ?? '', link: `/projects/${t.projectId}/towers/${t.id}`, icon: typeIcon.tower });
  });
  mockCaptures.forEach(c => results.push({ id: c.id, type: 'capture', title: c.roomName, sub: `${c.projectName} · ${c.towerName} · ${c.floorLabel}`, link: `/captures/${c.id}`, icon: typeIcon.capture }));
  mockTours.forEach(t => results.push({ id: t.id, type: 'tour', title: t.roomName, sub: `${t.projectName} · ${t.floorLabel}`, link: `/tours/${t.id}`, icon: typeIcon.tour }));
  mockUsers.forEach(u => results.push({ id: u.id, type: 'user', title: u.name, sub: `${u.designation} · ${u.email}`, link: `/users`, icon: typeIcon.user }));
  return results;
}

const searchIndex = buildIndex();

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o); }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
    else setQuery('');
  }, [open]);

  const results = query.trim().length < 2 ? [] : searchIndex.filter(r =>
    r.title.toLowerCase().includes(query.toLowerCase()) ||
    r.sub.toLowerCase().includes(query.toLowerCase()) ||
    r.type.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 12);

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  return (
    <>
      {/* Trigger button */}
      <Box onClick={() => setOpen(true)} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.625, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, backgroundColor: colors.card, cursor: 'pointer', minWidth: { xs: 'auto', sm: 200 }, '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft } }}>
        <SearchRounded sx={{ fontSize: 15, color: colors.textSubdued }} />
        <Typography sx={{ fontSize: '0.8125rem', color: colors.textSubdued, flex: 1, display: { xs: 'none', sm: 'block' } }}>Search…</Typography>
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.25, alignItems: 'center' }}>
          <Box sx={{ px: 0.5, py: 0.125, borderRadius: '4px', border: `1px solid ${colors.borderLight}`, fontSize: '0.5625rem', color: colors.textSubdued, fontWeight: 600 }}>Ctrl</Box>
          <Box sx={{ px: 0.5, py: 0.125, borderRadius: '4px', border: `1px solid ${colors.borderLight}`, fontSize: '0.5625rem', color: colors.textSubdued, fontWeight: 600 }}>K</Box>
        </Box>
      </Box>

      {/* Modal overlay */}
      {open && (
        <Box sx={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)', zIndex: zIndex.modal, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', pt: { xs: 4, md: 10 }, px: 2 }}
          onClick={() => setOpen(false)}>
          <Box onClick={e => e.stopPropagation()} sx={{ width: '100%', maxWidth: 580, borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 24px 64px rgba(15,23,42,0.20)', overflow: 'hidden' }}>
            {/* Search input */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: `1px solid ${colors.borderLight}` }}>
              <SearchRounded sx={{ fontSize: 18, color: colors.textMuted, flexShrink: 0 }} />
              <Box
                ref={inputRef}
                component="input"
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                placeholder="Search projects, captures, tours, users…"
                sx={{ flex: 1, border: 'none', outline: 'none', fontSize: '0.9375rem', color: colors.textStrong, backgroundColor: 'transparent', '&::placeholder': { color: colors.textSubdued } }}
              />
              <IconButton size="small" onClick={() => setOpen(false)} sx={{ color: colors.textMuted }}>
                <CloseRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>

            {/* Results */}
            <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
              {query.length < 2 && (
                <Box sx={{ py: 6, textAlign: 'center', color: colors.textMuted }}>
                  <SearchRounded sx={{ fontSize: 32, color: colors.border, mb: 1 }} />
                  <Typography sx={{ fontSize: '0.875rem' }}>Type at least 2 characters to search</Typography>
                </Box>
              )}
              {query.length >= 2 && results.length === 0 && (
                <Box sx={{ py: 6, textAlign: 'center', color: colors.textMuted }}>
                  <Typography sx={{ fontSize: '0.875rem' }}>No results for "{query}"</Typography>
                </Box>
              )}
              {Object.entries(grouped).map(([type, items]) => (
                <Box key={type}>
                  <Typography sx={{ px: 2.5, pt: 1.5, pb: 0.5, fontSize: '0.625rem', fontWeight: 700, color: colors.textSubdued, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{type}s</Typography>
                  {items.map(r => (
                    <Box key={r.id} component={Link} to={r.link} onClick={() => setOpen(false)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.25, textDecoration: 'none', transition: `background ${motion.durationFast}`, '&:hover': { backgroundColor: colors.bg } }}>
                      <Box sx={{ width: 28, height: 28, borderRadius: '7px', backgroundColor: `${typeColor[r.type]}15`, color: typeColor[r.type], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{r.icon}</Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{r.title}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{r.sub}</Typography>
                      </Box>
                      <Box sx={{ px: 0.875, py: 0.125, borderRadius: '5px', backgroundColor: `${typeColor[r.type]}12`, fontSize: '0.5625rem', fontWeight: 700, color: typeColor[r.type], textTransform: 'capitalize', flexShrink: 0 }}>{r.type}</Box>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>

            {/* Footer */}
            <Box sx={{ px: 2.5, py: 1.25, borderTop: `1px solid ${colors.borderLight}`, display: 'flex', gap: 2, alignItems: 'center' }}>
              {[['↵', 'Select'], ['↑↓', 'Navigate'], ['Esc', 'Close']].map(([key, label]) => (
                <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ px: 0.75, py: 0.125, borderRadius: '4px', border: `1px solid ${colors.borderLight}`, fontSize: '0.625rem', color: colors.textSubdued, fontWeight: 600 }}>{key}</Box>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{label}</Typography>
                </Box>
              ))}
              {results.length > 0 && <Typography sx={{ ml: 'auto', fontSize: '0.6875rem', color: colors.textSubdued }}>{results.length} result{results.length !== 1 ? 's' : ''}</Typography>}
            </Box>
          </Box>
        </Box>
      )}
    </>
  );
}
