import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, Typography, IconButton } from '@mui/material';
import {
  SearchRounded, FolderRounded, LayersRounded, MeetingRoomRounded,
  CameraAltRounded, ViewInArRounded, PeopleRounded, CloseRounded,
  AddRounded, CloudUploadRounded, HistoryRounded,
} from '@mui/icons-material';
import { colors, motion, zIndex } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useSettingsStore } from '@store/settingsStore';

type SearchResult = {
  id: string; type: string; title: string; sub: string; link: string; icon: React.ReactNode;
};

const typeIcon: Record<string, React.ReactNode> = {
  project: <FolderRounded sx={{ fontSize: 14 }} />,
  tower: <LayersRounded sx={{ fontSize: 14 }} />,
  floor: <LayersRounded sx={{ fontSize: 14 }} />,
  room: <MeetingRoomRounded sx={{ fontSize: 14 }} />,
  capture: <CameraAltRounded sx={{ fontSize: 14 }} />,
  tour: <ViewInArRounded sx={{ fontSize: 14 }} />,
  user: <PeopleRounded sx={{ fontSize: 14 }} />,
  action: <AddRounded sx={{ fontSize: 14 }} />,
};

const typeColor: Record<string, string> = {
  project: '#2563eb', tower: '#7c3aed', floor: '#0891b2', room: '#059669',
  capture: '#d97706', tour: '#16a34a', user: '#64748b', action: colors.primary,
};

const QUICK_ACTIONS: SearchResult[] = [
  { id: 'qa-new-project', type: 'action', title: 'Create new project', sub: 'Start a construction project', link: '/projects/new', icon: typeIcon.action },
  { id: 'qa-upload', type: 'action', title: 'Upload capture', sub: 'Add 360° panoramic images', link: '/captures/upload', icon: <CloudUploadRounded sx={{ fontSize: 14 }} /> },
  { id: 'qa-workflow', type: 'action', title: 'Open workflow', sub: 'Construction workflow board', link: '/workflow', icon: <LayersRounded sx={{ fontSize: 14 }} /> },
];

function useSearchIndex() {
  const projects = useWorkflowStore(s => s.projects);
  const towers = useWorkflowStore(s => s.towers);
  const floors = useWorkflowStore(s => s.floors);
  const rooms = useWorkflowStore(s => s.rooms);
  const captures = useWorkflowStore(s => s.captures);
  const tours = useWorkflowStore(s => s.tours);
  const users = useWorkflowStore(s => s.users);

  return useMemo(() => {
    const results: SearchResult[] = [...QUICK_ACTIONS];
    projects.filter(p => !p.archived).forEach(p =>
      results.push({ id: p.id, type: 'project', title: p.name, sub: p.location, link: `/projects/${p.id}`, icon: typeIcon.project })
    );
    towers.forEach(t => {
      const p = projects.find(pr => pr.id === t.projectId);
      results.push({ id: t.id, type: 'tower', title: t.name, sub: p?.name ?? '', link: `/projects/${t.projectId}/towers/${t.id}`, icon: typeIcon.tower });
    });
    floors.forEach(f => {
      const t = towers.find(tw => tw.id === f.towerId);
      const p = t ? projects.find(pr => pr.id === t.projectId) : undefined;
      results.push({ id: f.id, type: 'floor', title: f.label, sub: `${p?.name ?? ''} · ${t?.name ?? ''}`, link: `/floor-plans/${p?.id}/${f.towerId}/${f.id}`, icon: typeIcon.floor });
    });
    rooms.forEach(r => {
      const p = projects.find(pr => pr.id === r.projectId);
      const t = towers.find(tw => tw.id === r.towerId);
      const f = floors.find(fl => fl.id === r.floorId);
      results.push({ id: r.id, type: 'room', title: r.name, sub: `${p?.name ?? ''} · ${f?.label ?? ''}`, link: `/projects/${r.projectId}/towers/${r.towerId}/floors/${r.floorId}`, icon: typeIcon.room });
    });
    captures.forEach(c =>
      results.push({ id: c.id, type: 'capture', title: c.roomName, sub: `${c.projectName} · ${c.towerName} · ${c.floorLabel}`, link: `/captures/${c.id}`, icon: typeIcon.capture })
    );
    tours.forEach(t =>
      results.push({ id: t.id, type: 'tour', title: t.roomName, sub: `${t.projectName} · ${t.floorLabel}`, link: `/tours/${t.id}`, icon: typeIcon.tour })
    );
    users.forEach(u =>
      results.push({ id: u.id, type: 'user', title: u.name, sub: `${u.designation} · ${u.email}`, link: '/users', icon: typeIcon.user })
    );
    return results;
  }, [projects, towers, floors, rooms, captures, tours, users]);
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const recentSearches = useSettingsStore(s => s.recentSearches);
  const addRecentSearch = useSettingsStore(s => s.addRecentSearch);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const searchIndex = useSearchIndex();

  const results = useMemo(() => {
    if (query.trim().length < 2) return [];
    const q = query.toLowerCase();
    return searchIndex.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.sub.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q)
    ).slice(0, 14);
  }, [query, searchIndex]);

  const flatResults = results;
  const showRecent = query.trim().length < 2 && recentSearches.length > 0;

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
    else {
      setQuery('');
      setActiveIdx(0);
    }
  }, [open]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  const selectResult = useCallback((r: SearchResult) => {
    if (query.trim().length >= 2) addRecentSearch(query.trim());
    setOpen(false);
    navigate(r.link);
  }, [query, navigate, addRecentSearch]);

  function handleKeyDown(e: React.KeyboardEvent) {
    const list = flatResults;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(list.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && list[activeIdx]) {
      e.preventDefault();
      selectResult(list[activeIdx]);
    }
  }

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  let flatIdx = -1;

  return (
    <>
      <Box onClick={() => setOpen(true)} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.625, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, backgroundColor: colors.card, cursor: 'pointer', minWidth: { xs: 'auto', sm: 200 }, '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft } }}>
        <SearchRounded sx={{ fontSize: 15, color: colors.textSubdued }} />
        <Typography sx={{ fontSize: '0.8125rem', color: colors.textSubdued, flex: 1, display: { xs: 'none', sm: 'block' } }}>Search…</Typography>
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.25, alignItems: 'center' }}>
          <Box sx={{ px: 0.5, py: 0.125, borderRadius: '4px', border: `1px solid ${colors.borderLight}`, fontSize: '0.5625rem', color: colors.textSubdued, fontWeight: 600 }}>Ctrl</Box>
          <Box sx={{ px: 0.5, py: 0.125, borderRadius: '4px', border: `1px solid ${colors.borderLight}`, fontSize: '0.5625rem', color: colors.textSubdued, fontWeight: 600 }}>K</Box>
        </Box>
      </Box>

      {open && (
        <Box sx={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)', zIndex: zIndex.modal, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', pt: { xs: 4, md: 10 }, px: 2 }}
          onClick={() => setOpen(false)}>
          <Box onClick={e => e.stopPropagation()} sx={{ width: '100%', maxWidth: 580, borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 24px 64px rgba(15,23,42,0.20)', overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: `1px solid ${colors.borderLight}` }}>
              <SearchRounded sx={{ fontSize: 18, color: colors.textMuted, flexShrink: 0 }} />
              <Box
                ref={inputRef}
                component="input"
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search projects, towers, floors, rooms, captures, tours, users…"
                sx={{ flex: 1, border: 'none', outline: 'none', fontSize: '0.9375rem', color: colors.textStrong, backgroundColor: 'transparent', '&::placeholder': { color: colors.textSubdued } }}
              />
              <IconButton size="small" onClick={() => setOpen(false)} sx={{ color: colors.textMuted }}>
                <CloseRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>

            <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
              {query.length < 2 && (
                <>
                  <Typography sx={{ px: 2.5, pt: 1.5, pb: 0.5, fontSize: '0.625rem', fontWeight: 700, color: colors.textSubdued, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Quick actions</Typography>
                  {QUICK_ACTIONS.map((r, i) => (
                    <Box key={r.id} component={Link} to={r.link} onClick={() => setOpen(false)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.25, textDecoration: 'none', '&:hover': { backgroundColor: colors.bg } }}>
                      <Box sx={{ width: 28, height: 28, borderRadius: '7px', backgroundColor: `${typeColor.action}15`, color: typeColor.action, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.icon}</Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{r.title}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{r.sub}</Typography>
                      </Box>
                    </Box>
                  ))}
                  {showRecent && (
                    <>
                      <Typography sx={{ px: 2.5, pt: 1.5, pb: 0.5, fontSize: '0.625rem', fontWeight: 700, color: colors.textSubdued, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <HistoryRounded sx={{ fontSize: 12 }} /> Recent searches
                      </Typography>
                      {recentSearches.map(q => (
                        <Box key={q} onClick={() => setQuery(q)} sx={{ px: 2.5, py: 1, cursor: 'pointer', fontSize: '0.875rem', color: colors.textSecondary, '&:hover': { backgroundColor: colors.bg, color: colors.textStrong } }}>
                          {q}
                        </Box>
                      ))}
                    </>
                  )}
                  {query.length < 2 && !showRecent && (
                    <Box sx={{ py: 4, textAlign: 'center', color: colors.textMuted }}>
                      <Typography sx={{ fontSize: '0.875rem' }}>Type at least 2 characters to search</Typography>
                    </Box>
                  )}
                </>
              )}

              {query.length >= 2 && results.length === 0 && (
                <Box sx={{ py: 6, textAlign: 'center', color: colors.textMuted }}>
                  <Typography sx={{ fontSize: '0.875rem' }}>No results for "{query}"</Typography>
                </Box>
              )}

              {Object.entries(grouped).map(([type, items]) => (
                <Box key={type}>
                  <Typography sx={{ px: 2.5, pt: 1.5, pb: 0.5, fontSize: '0.625rem', fontWeight: 700, color: colors.textSubdued, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{type}s</Typography>
                  {items.map(r => {
                    flatIdx += 1;
                    const idx = flatIdx;
                    const isActive = idx === activeIdx;
                    return (
                      <Box key={r.id} onClick={() => selectResult(r)}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.25, cursor: 'pointer',
                          backgroundColor: isActive ? colors.primarySoft : 'transparent',
                          transition: `background ${motion.durationFast}`,
                          '&:hover': { backgroundColor: isActive ? colors.primarySoft : colors.bg },
                        }}>
                        <Box sx={{ width: 28, height: 28, borderRadius: '7px', backgroundColor: `${typeColor[r.type]}15`, color: typeColor[r.type], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{r.icon}</Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{r.title}</Typography>
                          <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{r.sub}</Typography>
                        </Box>
                        <Box sx={{ px: 0.875, py: 0.125, borderRadius: '5px', backgroundColor: `${typeColor[r.type]}12`, fontSize: '0.5625rem', fontWeight: 700, color: typeColor[r.type], textTransform: 'capitalize', flexShrink: 0 }}>{r.type}</Box>
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>

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
