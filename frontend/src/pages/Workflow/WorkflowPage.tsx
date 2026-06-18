import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, TextField, MenuItem, Select } from '@mui/material';
import {
  FolderRounded, ApartmentRounded, LayersRounded, MeetingRoomRounded,
  CameraAltRounded, ViewInArRounded, ChevronRightRounded, AddRounded,
  EditRounded, DeleteOutlineRounded, ArchiveRounded, OpenInNewRounded,
  CheckRounded, CloseRounded, ReplayRounded, PublishRounded, UnpublishedRounded,
  AutoAwesomeRounded, MapRounded, PersonAddRounded, CloudUploadRounded, HistoryRounded,
  HomeWorkRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore, type FlatType, type WfFlat, type WfFloor, type WfRoom } from '@store/workflowStore';
import { statusConfig, mockUsers, type MockCapture, type MockTour } from '@/data/mockData';

const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.dng', '.insp', '.insv'];
const RAW_EXTENSIONS = ['.dng', '.insp', '.insv'];

function fileExt(name: string) { return name.slice(name.lastIndexOf('.')).toLowerCase(); }
function fileBadge(name: string) {
  const ext = fileExt(name);
  const map: Record<string, { label: string; color: string }> = {
    '.jpg': { label: 'JPEG', color: '#2563eb' }, '.jpeg': { label: 'JPEG', color: '#2563eb' },
    '.png': { label: 'PNG', color: '#0891b2' }, '.dng': { label: 'RAW', color: '#7c3aed' },
    '.insp': { label: 'INSP', color: '#d97706' }, '.insv': { label: 'INSV', color: '#d97706' },
  };
  return map[ext] ?? { label: ext.replace('.', '').toUpperCase() || 'FILE', color: '#64748b' };
}

interface PickedFile { file: File; id: string; preview: string | null; }

// ── Real capture upload modal: drag-and-drop + file picker ──────────────────────
function UploadCaptureModal({ roomName, title = 'Upload Capture', onUpload, onClose }: {
  roomName: string; title?: string; onUpload: (count: number) => void; onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [dragging, setDragging] = useState(false);

  function addFiles(list: FileList) {
    const next = Array.from(list)
      .filter(f => f.type.startsWith('image/') || ACCEPTED_EXTENSIONS.includes(fileExt(f.name)))
      .map(f => ({ file: f, id: `${f.name}-${f.size}`, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null }));
    setFiles(prev => {
      const seen = new Set(prev.map(p => p.id));
      return [...prev, ...next.filter(n => !seen.has(n.id))];
    });
  }
  function removeFile(id: string) { setFiles(prev => prev.filter(f => f.id !== id)); }

  return (
    <Box sx={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box sx={{ width: '100%', maxWidth: 520, maxHeight: '88vh', borderRadius: '18px', backgroundColor: colors.card, boxShadow: '0 24px 64px rgba(15,23,42,0.2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 3, py: 2.25, borderBottom: `1px solid ${colors.borderLight}` }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>{title}</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mt: 0.25 }}>{roomName} · 360° panoramic images</Typography>
        </Box>

        <Box sx={{ p: 3, overflowY: 'auto' }}>
          {/* Drop zone */}
          <Box
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            sx={{ borderRadius: '14px', border: `2px dashed ${dragging ? colors.primary : colors.border}`, backgroundColor: dragging ? colors.primarySoft : colors.bg, p: 3.5, textAlign: 'center', cursor: 'pointer', transition: `all ${motion.durationFast}`, '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft } }}
          >
            <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.dng,.insp,.insv,image/*" multiple style={{ display: 'none' }} onChange={e => e.target.files && addFiles(e.target.files)} />
            <CloudUploadRounded sx={{ fontSize: 36, color: dragging ? colors.primary : colors.textSubdued, mb: 1 }} />
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.25 }}>Drop panoramic images here</Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1.25 }}>or click to browse</Typography>
            <Box sx={{ display: 'flex', gap: 0.625, justifyContent: 'center', flexWrap: 'wrap' }}>
              {[['JPG', '#2563eb'], ['PNG', '#0891b2'], ['DNG', '#7c3aed'], ['INSP', '#d97706'], ['INSV', '#d97706']].map(([l, c]) => (
                <Box key={l} sx={{ px: 0.875, py: 0.25, borderRadius: '4px', backgroundColor: `${c}15`, fontSize: '0.625rem', fontWeight: 700, color: c }}>{l}</Box>
              ))}
            </Box>
          </Box>

          {/* File list */}
          {files.length > 0 && (
            <Box sx={{ mt: 2.5, borderRadius: '12px', border: `1px solid ${colors.borderLight}`, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${colors.borderLight}`, backgroundColor: colors.bg }}>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>{files.length} file{files.length === 1 ? '' : 's'} selected</Typography>
              </Box>
              <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
                {files.map(f => {
                  const badge = fileBadge(f.file.name);
                  const isRaw = RAW_EXTENSIONS.includes(fileExt(f.file.name));
                  return (
                    <Box key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
                      {f.preview ? (
                        <Box sx={{ width: 38, height: 38, borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                          <Box component="img" src={f.preview} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </Box>
                      ) : (
                        <Box sx={{ width: 38, height: 38, borderRadius: '8px', backgroundColor: colors.bgDeep, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <CameraAltRounded sx={{ fontSize: 17, color: colors.textSubdued }} />
                        </Box>
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textStrong, flex: 1, minWidth: 0 }}>{f.file.name}</Typography>
                          <Box sx={{ px: 0.75, py: 0.125, borderRadius: '4px', fontSize: '0.5625rem', fontWeight: 700, color: badge.color, backgroundColor: `${badge.color}18`, flexShrink: 0 }}>{badge.label}</Box>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
                          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>{(f.file.size / 1024 / 1024).toFixed(1)} MB</Typography>
                          {isRaw && <Typography sx={{ fontSize: '0.625rem', fontWeight: 600, color: '#7c3aed' }}>· pipeline required</Typography>}
                        </Box>
                      </Box>
                      <Box onClick={() => removeFile(f.id)} sx={{ color: colors.textSubdued, cursor: 'pointer', display: 'flex', '&:hover': { color: colors.danger } }}>
                        <CloseRounded sx={{ fontSize: 16 }} />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </Box>

        <Box sx={{ px: 3, py: 2.25, borderTop: `1px solid ${colors.borderLight}`, display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
          <Box onClick={onClose} sx={{ px: 2.25, py: 1, borderRadius: '10px', border: `1px solid ${colors.border}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', '&:hover': { backgroundColor: colors.bg } }}>Cancel</Box>
          <Box
            onClick={() => { if (files.length) { onUpload(files.length); onClose(); } }}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2.25, py: 1, borderRadius: '10px', backgroundColor: files.length ? colors.textStrong : colors.bgDeep, color: files.length ? '#fff' : colors.textSubdued, fontSize: '0.875rem', fontWeight: 600, cursor: files.length ? 'pointer' : 'not-allowed', '&:hover': files.length ? { backgroundColor: '#000' } : {} }}
          >
            <CloudUploadRounded sx={{ fontSize: 16 }} /> Upload{files.length ? ` ${files.length} file${files.length === 1 ? '' : 's'}` : ''}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

type NodeType = 'project' | 'tower' | 'floor' | 'flat' | 'room' | 'capture' | 'review' | 'publish' | 'tour';
interface Selection { type: NodeType; id: string; }
const FLAT_TYPES: FlatType[] = ['1 BHK', '2 BHK', '3 BHK', '4 BHK'];

// ── Action button ───────────────────────────────────────────────────────────────
function Action({ label, icon, onClick, tone = 'default', to }: {
  label: string; icon: React.ReactNode; onClick?: () => void; tone?: 'default' | 'primary' | 'danger' | 'success'; to?: string;
}) {
  const palette = {
    default: { color: colors.textStrong, bg: colors.card, border: colors.border, hover: colors.bg },
    primary: { color: '#fff', bg: colors.textStrong, border: colors.textStrong, hover: '#000' },
    danger: { color: colors.danger, bg: colors.card, border: colors.border, hover: colors.dangerBg },
    success: { color: colors.success, bg: colors.card, border: colors.border, hover: colors.successBg },
  }[tone];
  const sx = {
    display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 1.125, borderRadius: '10px',
    border: `1px solid ${palette.border}`, backgroundColor: palette.bg, color: palette.color,
    fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'none', letterSpacing: '-0.01em',
    transition: `all ${motion.durationFast}`, '&:hover': { backgroundColor: palette.hover },
    '& svg': { fontSize: 17 },
  };
  if (to) return <Box component={Link} to={to} sx={sx}>{icon}{label}</Box>;
  return <Box onClick={onClick} sx={sx}>{icon}{label}</Box>;
}

// ── Tree row ──────────────────────────────────────────────────────────────────
function TreeRow({ depth, icon, label, sub, active, expandable, expanded, onToggle, onSelect, dot }: {
  depth: number; icon: React.ReactNode; label: string; sub?: string; active: boolean;
  expandable?: boolean; expanded?: boolean; onToggle?: () => void; onSelect: () => void; dot?: string;
}) {
  return (
    <Box
      onClick={onSelect}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, py: 0.875, pr: 1, borderRadius: '8px', cursor: 'pointer',
        pl: `${8 + depth * 16}px`,
        backgroundColor: active ? colors.primarySoft : 'transparent',
        '&:hover': { backgroundColor: active ? colors.primarySoft : colors.bg },
        transition: `background ${motion.durationFast}`,
      }}
    >
      <Box
        onClick={(e) => { if (expandable) { e.stopPropagation(); onToggle?.(); } }}
        sx={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: colors.textSubdued }}
      >
        {expandable && <ChevronRightRounded sx={{ fontSize: 16, transform: expanded ? 'rotate(90deg)' : 'none', transition: `transform ${motion.durationFast}` }} />}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', color: active ? colors.primary : colors.textMuted, flexShrink: 0, '& svg': { fontSize: 16 } }}>{icon}</Box>
      <Typography noWrap sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: active ? 600 : 500, color: active ? colors.primary : colors.textStrong, letterSpacing: '-0.01em' }}>{label}</Typography>
      {dot && <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />}
      {sub && <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, flexShrink: 0 }}>{sub}</Typography>}
    </Box>
  );
}

// ── Prompt modal (create / edit text) ─────────────────────────────────────────
function PromptModal({ title, fields, onSave, onClose }: {
  title: string;
  fields: { key: string; label: string; value: string; type?: 'text' | 'number' | 'select'; options?: { value: string; label: string }[] }[];
  onSave: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(fields.map(f => [f.key, f.value])));
  return (
    <Box sx={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box sx={{ width: '100%', maxWidth: 420, borderRadius: '18px', backgroundColor: colors.card, boxShadow: '0 24px 64px rgba(15,23,42,0.2)', overflow: 'hidden' }}>
        <Box sx={{ px: 3, py: 2.25, borderBottom: `1px solid ${colors.borderLight}` }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>{title}</Typography>
        </Box>
        <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {fields.map(f => (
            <Box key={f.key}>
              <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: colors.textSecondary, mb: 0.75 }}>{f.label}</Typography>
              {f.type === 'select' ? (
                <Select fullWidth size="small" value={vals[f.key]} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))} sx={{ borderRadius: '10px', fontSize: '0.875rem' }}>
                  {f.options?.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </Select>
              ) : (
                <TextField fullWidth size="small" type={f.type ?? 'text'} value={vals[f.key]} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px', fontSize: '0.875rem' } }} autoFocus={f === fields[0]} />
              )}
            </Box>
          ))}
        </Box>
        <Box sx={{ px: 3, py: 2.25, borderTop: `1px solid ${colors.borderLight}`, display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
          <Box onClick={onClose} sx={{ px: 2.25, py: 1, borderRadius: '10px', border: `1px solid ${colors.border}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', '&:hover': { backgroundColor: colors.bg } }}>Cancel</Box>
          <Box onClick={() => { onSave(vals); onClose(); }} sx={{ px: 2.25, py: 1, borderRadius: '10px', backgroundColor: colors.textStrong, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', '&:hover': { backgroundColor: '#000' } }}>Save</Box>
        </Box>
      </Box>
    </Box>
  );
}

// ── Panel shell ─────────────────────────────────────────────────────────────────
function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1.5 }}>{title}</Typography>
      {children}
    </Box>
  );
}

export default function WorkflowPage() {
  const store = useWorkflowStore();
  const [sel, setSel] = useState<Selection | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<React.ReactNode>(null);

  const activeProjects = store.projects.filter(p => !p.archived);

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  const isOpen = (key: string) => expanded.has(key);

  // Lookups for the selected node
  const selProject = sel?.type === 'project' ? store.projects.find(p => p.id === sel.id) : undefined;
  const selTower = sel?.type === 'tower' ? store.towers.find(t => t.id === sel.id) : undefined;
  const selFloor = sel?.type === 'floor' ? store.floors.find(f => f.id === sel.id) : undefined;
  const selFlat = sel?.type === 'flat' ? store.flats.find(f => f.id === sel.id) : undefined;
  const selRoom = sel?.type === 'room' ? store.rooms.find(r => r.id === sel.id) : undefined;
  const selCapture = (sel?.type === 'capture' || sel?.type === 'review' || sel?.type === 'publish') ? store.captures.find(c => c.id === sel.id) : undefined;
  const selTour = sel?.type === 'tour' ? store.tours.find(t => t.id === sel.id) : undefined;

  // ── Tree builders ──────────────────────────────────────────────────────────
  function renderTree() {
    return activeProjects.map(p => {
      const pKey = `p:${p.id}`;
      const towers = store.towers.filter(t => t.projectId === p.id);
      return (
        <Box key={p.id}>
          <TreeRow depth={0} icon={<FolderRounded />} label={p.name} sub={`${towers.length}`} active={sel?.type === 'project' && sel.id === p.id}
            expandable={towers.length >= 0} expanded={isOpen(pKey)} onToggle={() => toggle(pKey)} onSelect={() => { setSel({ type: 'project', id: p.id }); toggle(pKey); }} dot={statusConfig.project[p.status].color} />
          {isOpen(pKey) && towers.map(t => {
            const tKey = `t:${t.id}`;
            const floors = store.floors.filter(f => f.towerId === t.id).sort((a, b) => b.number - a.number);
            return (
              <Box key={t.id}>
                <TreeRow depth={1} icon={<ApartmentRounded />} label={t.name} sub={`${floors.length}`} active={sel?.type === 'tower' && sel.id === t.id}
                  expandable expanded={isOpen(tKey)} onToggle={() => toggle(tKey)} onSelect={() => { setSel({ type: 'tower', id: t.id }); toggle(tKey); }} />
                {isOpen(tKey) && floors.map(f => {
                  const fKey = `f:${f.id}`;
                  const flats = store.flats.filter(fl => fl.floorId === f.id);
                  const floorRooms = store.rooms.filter(r => r.floorId === f.id);
                  return (
                    <Box key={f.id}>
                      <TreeRow depth={2} icon={<LayersRounded />} label={f.label} sub={`${flats.length} flats · ${floorRooms.length} rooms`} active={sel?.type === 'floor' && sel.id === f.id}
                        expandable expanded={isOpen(fKey)} onToggle={() => toggle(fKey)} onSelect={() => { setSel({ type: 'floor', id: f.id }); toggle(fKey); }} />
                      {isOpen(fKey) && flats.map(flat => {
                        const flatKey = `flat:${flat.id}`;
                        const rooms = store.rooms.filter(r => r.flatId === flat.id);
                        return (
                          <Box key={flat.id}>
                            <TreeRow depth={3} icon={<HomeWorkRounded />} label={`${flat.number} (${flat.type})`} sub={`${rooms.length} rooms`} active={sel?.type === 'flat' && sel.id === flat.id}
                              expandable expanded={isOpen(flatKey)} onToggle={() => toggle(flatKey)} onSelect={() => { setSel({ type: 'flat', id: flat.id }); toggle(flatKey); }} />
                            {isOpen(flatKey) && rooms.map(r => {
                              const rKey = `r:${r.id}`;
                              const caps = store.captures.filter(c => c.roomId === r.id);
                              const tour = store.tours.find(tr => caps.some(c => c.id === tr.captureId));
                              return (
                                <Box key={r.id}>
                                  <TreeRow depth={4} icon={<MeetingRoomRounded />} label={r.name} sub={`${caps.length} captures${tour ? ' · tour' : ''}`} active={sel?.type === 'room' && sel.id === r.id}
                                    expandable expanded={isOpen(rKey)} onToggle={() => toggle(rKey)} onSelect={() => { setSel({ type: 'room', id: r.id }); toggle(rKey); }} dot={tour ? statusConfig.tour[tour.status].color : undefined} />
                                  {isOpen(rKey) && (
                                    <>
                                      {caps.map(c => (
                                        <TreeRow key={c.id} depth={5} icon={<CameraAltRounded />} label={`Capture · ${c.fileCount} files`} active={sel?.id === c.id && (sel?.type === 'capture')}
                                          onSelect={() => setSel({ type: 'capture', id: c.id })} dot={statusConfig.capture[c.status].color} />
                                      ))}
                                      {caps.length === 0 && (
                                        <TreeRow depth={5} icon={<CameraAltRounded />} label="No capture yet" active={false} onSelect={() => setSel({ type: 'room', id: r.id })} />
                                      )}
                                      {tour && (
                                        <TreeRow depth={5} icon={<ViewInArRounded />} label="Tour" active={sel?.type === 'tour' && sel.id === tour.id}
                                          onSelect={() => setSel({ type: 'tour', id: tour.id })} dot={statusConfig.tour[tour.status].color} />
                                      )}
                                    </>
                                  )}
                                </Box>
                              );
                            })}
                          </Box>
                        );
                      })}
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      );
    });
  }

  // ── Context panel ────────────────────────────────────────────────────────────
  function renderPanel() {
    if (!sel) {
      return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 4 }}>
          <Box sx={{ width: 56, height: 56, borderRadius: '16px', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2.5 }}>
            <AutoAwesomeRounded sx={{ fontSize: 26, color: colors.textSubdued }} />
          </Box>
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em', mb: 0.75 }}>Select an item to begin</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, maxWidth: 320, lineHeight: 1.6 }}>
            Pick a project, tower, floor, room, capture or tour from the navigator to manage it — or create a new project to start the lifecycle.
          </Typography>
          <Box sx={{ mt: 3 }}>
            <Action label="Create Project" icon={<AddRounded />} tone="primary" onClick={openCreateProject} />
          </Box>
        </Box>
      );
    }

    return (
      <Box sx={{ p: 3 }}>
        {selProject && <ProjectPanel />}
        {selTower && <TowerPanel tower={selTower} />}
        {selFloor && <FloorPanel floor={selFloor} />}
        {selFlat && <FlatPanel flat={selFlat} />}
        {selRoom && <RoomPanel room={selRoom} />}
        {selCapture && <CapturePanel capture={selCapture} />}
        {selTour && <TourPanel tour={selTour} />}
      </Box>
    );
  }

  // ── Headers ──
  function PanelHeader({ kind, title, sub, dot }: { kind: string; title: string; sub?: string; dot?: string }) {
    return (
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.primary, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.5 }}>{kind}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {dot && <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dot }} />}
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em' }}>{title}</Typography>
        </Box>
        {sub && <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mt: 0.5 }}>{sub}</Typography>}
      </Box>
    );
  }

  // ── Create modals ──
  function openCreateProject() {
    setModal(<PromptModal title="Create Project" fields={[{ key: 'name', label: 'Project name', value: '' }, { key: 'city', label: 'City', value: 'Hyderabad' }]}
      onSave={v => { const id = store.createProject({ name: v.name || 'Untitled Project', city: v.city }); setSel({ type: 'project', id }); setExpanded(p => new Set(p).add(`p:${id}`)); }} onClose={() => setModal(null)} />);
  }

  // ── Project panel ──
  function ProjectPanel() {
    if (!selProject) return null;
    const p = selProject;
    const towers = store.towers.filter(t => t.projectId === p.id);
    return (
      <>
        <PanelHeader kind="Project" title={p.name} sub={`${p.location} · ${towers.length} towers · ${p.captures} captures`} dot={statusConfig.project[p.status].color} />
        <PanelSection title="Actions">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Action label="Create Tower" icon={<AddRounded />} tone="primary" onClick={() => setModal(
              <PromptModal title="Create Tower" fields={[{ key: 'name', label: 'Tower name', value: `Tower ${String.fromCharCode(65 + towers.length)}` }]}
                onSave={v => { const id = store.createTower(p.id, v.name || 'New Tower'); setSel({ type: 'tower', id }); setExpanded(s => new Set(s).add(`p:${p.id}`).add(`t:${id}`)); }} onClose={() => setModal(null)} />
            )} />
            <Action label="Edit Project" icon={<EditRounded />} onClick={() => setModal(
              <PromptModal title="Edit Project" fields={[{ key: 'name', label: 'Project name', value: p.name }, { key: 'city', label: 'City', value: p.city }]}
                onSave={v => store.updateProject(p.id, { name: v.name, city: v.city, location: `${v.city}, ${p.state}` })} onClose={() => setModal(null)} />
            )} />
            <Action label="Open Project" icon={<OpenInNewRounded />} to={`/projects/${p.id}`} />
            <Action label={p.archived ? 'Unarchive' : 'Archive Project'} icon={<ArchiveRounded />} tone="danger" onClick={() => store.archiveProject(p.id)} />
          </Box>
        </PanelSection>
        <PanelSection title="Towers">
          {towers.length === 0 ? <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>No towers yet. Create one to continue.</Typography> : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {towers.map(t => (
                <Box key={t.id} onClick={() => setSel({ type: 'tower', id: t.id })} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '10px', cursor: 'pointer', border: `1px solid ${colors.borderLight}`, '&:hover': { borderColor: colors.border, backgroundColor: colors.bg } }}>
                  <ApartmentRounded sx={{ fontSize: 16, color: colors.textMuted }} />
                  <Typography sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>{t.name}</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{t.floors} floors</Typography>
                </Box>
              ))}
            </Box>
          )}
        </PanelSection>
      </>
    );
  }

  // ── Tower panel ──
  function TowerPanel({ tower }: { tower: typeof store.towers[number] }) {
    const floors = store.floors.filter(f => f.towerId === tower.id).sort((a, b) => b.number - a.number);
    const project = store.projects.find(p => p.id === tower.projectId);
    const nextNum = (floors[0]?.number ?? 0) + 1;
    return (
      <>
        <PanelHeader kind="Tower" title={tower.name} sub={`${project?.name} · ${floors.length} floors`} />
        <PanelSection title="Actions">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Action label="Create Floor" icon={<AddRounded />} tone="primary" onClick={() => setModal(
              <PromptModal title="Create Floor" fields={[{ key: 'number', label: 'Floor number', value: String(nextNum), type: 'number' }]}
                onSave={v => { const id = store.createFloor(tower.id, parseInt(v.number, 10) || nextNum); setSel({ type: 'floor', id }); setExpanded(s => new Set(s).add(`t:${tower.id}`).add(`f:${id}`)); }} onClose={() => setModal(null)} />
            )} />
            <Action label="Edit Tower" icon={<EditRounded />} onClick={() => setModal(
              <PromptModal title="Edit Tower" fields={[{ key: 'name', label: 'Tower name', value: tower.name }]} onSave={v => store.updateTower(tower.id, { name: v.name })} onClose={() => setModal(null)} />
            )} />
            <Action label="Delete Tower" icon={<DeleteOutlineRounded />} tone="danger" onClick={() => { store.deleteTower(tower.id); setSel({ type: 'project', id: tower.projectId }); }} />
          </Box>
        </PanelSection>
        <PanelSection title="Floors">
          {floors.length === 0 ? <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>No floors yet.</Typography> : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {floors.map(f => (
                <Box key={f.id} onClick={() => setSel({ type: 'floor', id: f.id })} sx={{ px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer', border: `1px solid ${colors.borderLight}`, fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong, '&:hover': { borderColor: colors.primary, color: colors.primary } }}>{f.label}</Box>
              ))}
            </Box>
          )}
        </PanelSection>
      </>
    );
  }

  // ── Floor panel ──
  function FloorPanel({ floor }: { floor: WfFloor }) {
    const flats = store.flats.filter(f => f.floorId === floor.id);
    const rooms = store.rooms.filter(r => r.floorId === floor.id);
    const tower = store.towers.find(t => t.id === floor.towerId);
    return (
      <>
        <PanelHeader kind="Floor" title={floor.label} sub={`${tower?.name} · ${flats.length} flats · ${rooms.length} rooms`} />
        <PanelSection title="Actions">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Action label="Create Flat" icon={<AddRounded />} tone="primary" onClick={() => setModal(
              <PromptModal title="Create Flat / Unit" fields={[
                { key: 'number', label: 'Flat number', value: `${floor.number}01` },
                { key: 'type', label: 'Flat type', value: '3 BHK', type: 'select', options: FLAT_TYPES.map(t => ({ value: t, label: t })) },
              ]} onSave={v => { const id = store.createFlat(floor.id, v.number || `${floor.number}01`, v.type as FlatType); setSel({ type: 'flat', id }); setExpanded(s => new Set(s).add(`f:${floor.id}`).add(`flat:${id}`)); }} onClose={() => setModal(null)} />
            )} />
            <Action label="Edit Floor" icon={<EditRounded />} onClick={() => setModal(
              <PromptModal title="Edit Floor" fields={[{ key: 'label', label: 'Floor label', value: floor.label }]} onSave={v => store.updateFloor(floor.id, { label: v.label })} onClose={() => setModal(null)} />
            )} />
            <Action label="Delete Floor" icon={<DeleteOutlineRounded />} tone="danger" onClick={() => { store.deleteFloor(floor.id); setSel({ type: 'tower', id: floor.towerId }); }} />
          </Box>
        </PanelSection>
        <PanelSection title="Flats / Units">
          {flats.length === 0 ? <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>No flats yet.</Typography> : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {flats.map(flat => {
                const flatRooms = store.rooms.filter(r => r.flatId === flat.id);
                return (
                <Box key={flat.id} onClick={() => setSel({ type: 'flat', id: flat.id })} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '10px', cursor: 'pointer', border: `1px solid ${colors.borderLight}`, '&:hover': { borderColor: colors.border, backgroundColor: colors.bg } }}>
                  <HomeWorkRounded sx={{ fontSize: 16, color: colors.textMuted }} />
                  <Typography sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>{flat.number}</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{flat.type} · {flatRooms.length} rooms</Typography>
                </Box>
                );
              })}
            </Box>
          )}
        </PanelSection>
      </>
    );
  }

  // ── Flat panel ──
  function FlatPanel({ flat }: { flat: WfFlat }) {
    const rooms = store.rooms.filter(r => r.flatId === flat.id);
    const floor = store.floors.find(f => f.id === flat.floorId);
    const captureCount = store.captures.filter(c => rooms.some(r => r.id === c.roomId)).length;
    return (
      <>
        <PanelHeader kind="Flat / Unit" title={`${flat.number} (${flat.type})`} sub={`${floor?.label ?? ''} · ${rooms.length} rooms · ${captureCount} captures`} />
        <PanelSection title="Actions">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Action label="Edit Flat" icon={<EditRounded />} onClick={() => setModal(
              <PromptModal title="Edit Flat" fields={[
                { key: 'number', label: 'Flat number', value: flat.number },
                { key: 'type', label: 'Flat type', value: flat.type, type: 'select', options: FLAT_TYPES.map(t => ({ value: t, label: t })) },
              ]} onSave={v => store.updateFlat(flat.id, { number: v.number, type: v.type as FlatType })} onClose={() => setModal(null)} />
            )} />
            <Action label="View Room List" icon={<MeetingRoomRounded />} onClick={() => setExpanded(s => new Set(s).add(`flat:${flat.id}`))} />
            <Action label="Generate Standard Rooms" icon={<AutoAwesomeRounded />} tone="primary" onClick={() => store.generateStandardRooms(flat.id)} />
            <Action label="Create Room" icon={<AddRounded />} onClick={() => setModal(
              <PromptModal title="Create Room" fields={[
                { key: 'name', label: 'Room name', value: `Room ${rooms.length + 1}` },
                { key: 'type', label: 'Type', value: 'living', type: 'select', options: ['living', 'bedroom', 'kitchen', 'bathroom', 'balcony', 'utility', 'dining', 'office', 'lounge', 'custom'].map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })) },
              ]} onSave={v => { const id = store.createRoom(flat.id, v.name || 'New Room', v.type as WfRoom['type']); setSel({ type: 'room', id }); setExpanded(s => new Set(s).add(`flat:${flat.id}`).add(`r:${id}`)); }} onClose={() => setModal(null)} />
            )} />
            <Action label="Delete Flat" icon={<DeleteOutlineRounded />} tone="danger" onClick={() => { store.deleteFlat(flat.id); setSel({ type: 'floor', id: flat.floorId }); }} />
          </Box>
        </PanelSection>
        <PanelSection title="Rooms">
          {rooms.length === 0 ? <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>No rooms yet. Generate standard rooms or create one manually.</Typography> : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {rooms.map(r => {
                const caps = store.captures.filter(c => c.roomId === r.id);
                const tour = store.tours.find(t => caps.some(c => c.id === t.captureId));
                return (
                  <Box key={r.id} onClick={() => setSel({ type: 'room', id: r.id })} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '10px', cursor: 'pointer', border: `1px solid ${colors.borderLight}`, '&:hover': { borderColor: colors.border, backgroundColor: colors.bg } }}>
                    <MeetingRoomRounded sx={{ fontSize: 16, color: colors.textMuted }} />
                    <Typography sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>{r.name}</Typography>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{caps.length} captures{tour ? ' · tour' : ''}</Typography>
                  </Box>
                );
              })}
            </Box>
          )}
        </PanelSection>
      </>
    );
  }

  // ── Room panel ──
  function RoomPanel({ room }: { room: WfRoom }) {
    const caps = store.captures.filter(c => c.roomId === room.id);
    const flat = store.flats.find(f => f.id === room.flatId);
    return (
      <>
        <PanelHeader kind="Room" title={room.name} sub={`${flat?.number ?? 'Flat'} · ${caps.length} capture${caps.length === 1 ? '' : 's'} · ${room.type}`} />
        <PanelSection title="Capture">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Action label="Upload Capture" icon={<CloudUploadRounded />} tone="primary" onClick={() => setModal(
              <UploadCaptureModal roomName={room.name}
                onUpload={count => { const id = store.uploadCapture(room.id, count); setSel({ type: 'capture', id }); setExpanded(s => new Set(s).add(`r:${room.id}`)); }} onClose={() => setModal(null)} />
            )} />
          </Box>
        </PanelSection>
        <PanelSection title="Room Actions">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Action label="Edit Room" icon={<EditRounded />} onClick={() => setModal(
              <PromptModal title="Edit Room" fields={[{ key: 'name', label: 'Room name', value: room.name }]} onSave={v => store.updateRoom(room.id, { name: v.name })} onClose={() => setModal(null)} />
            )} />
            <Action label="Assign Floor Plan" icon={<MapRounded />} onClick={() => store.assignFloorPlan(room.id, `fp-${room.floorId}`)} />
            <Action label="Delete Room" icon={<DeleteOutlineRounded />} tone="danger" onClick={() => { store.deleteRoom(room.id); setSel({ type: 'flat', id: room.flatId }); }} />
          </Box>
        </PanelSection>
        {caps.length > 0 && (
          <PanelSection title="Captures">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {caps.map(c => (
                <Box key={c.id} onClick={() => setSel({ type: 'capture', id: c.id })} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '10px', cursor: 'pointer', border: `1px solid ${colors.borderLight}`, '&:hover': { borderColor: colors.border, backgroundColor: colors.bg } }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: statusConfig.capture[c.status].color }} />
                  <Typography sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>{c.fileCount} files · {c.uploadedAt}</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{statusConfig.capture[c.status].label}</Typography>
                </Box>
              ))}
            </Box>
          </PanelSection>
        )}
      </>
    );
  }

  // ── Capture panel (capture + review + publish + tour) ──
  function CapturePanel({ capture }: { capture: MockCapture }) {
    const rs = statusConfig.reviewStatus[capture.reviewStatus];
    const tour = store.tours.find(t => t.captureId === capture.id);
    const isPublished = capture.reviewStatus === 'published';
    return (
      <>
        <PanelHeader kind="Capture" title={capture.roomName} sub={`${capture.fileCount} files · uploaded ${capture.uploadedAt}`} dot={statusConfig.capture[capture.status].color} />

        <Box sx={{ mb: 3, p: 1.75, borderRadius: '12px', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: rs.color }} />
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>Review status: {rs.label}</Typography>
          {capture.assignedTo && <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, ml: 'auto' }}>Reviewer: {capture.assignedTo}</Typography>}
        </Box>

        <PanelSection title="Capture Actions">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Action label="View Capture" icon={<OpenInNewRounded />} to={`/captures/${capture.id}`} />
            <Action label="Replace Capture" icon={<ReplayRounded />} onClick={() => setModal(
              <UploadCaptureModal roomName={capture.roomName} title="Replace Capture" onUpload={count => store.replaceCapture(capture.id, count)} onClose={() => setModal(null)} />
            )} />
            <Action label="Delete Capture" icon={<DeleteOutlineRounded />} tone="danger" onClick={() => { store.deleteCapture(capture.id); setSel({ type: 'room', id: capture.roomId }); }} />
          </Box>
        </PanelSection>

        <PanelSection title="Review">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Action label="Approve" icon={<CheckRounded />} tone="success" onClick={() => store.reviewCapture(capture.id, 'approve')} />
            <Action label="Request Changes" icon={<ReplayRounded />} onClick={() => store.reviewCapture(capture.id, 'request_changes')} />
            <Action label="Reject" icon={<CloseRounded />} tone="danger" onClick={() => store.reviewCapture(capture.id, 'reject')} />
            <Action label="Assign Reviewer" icon={<PersonAddRounded />} onClick={() => setModal(
              <PromptModal title="Assign Reviewer" fields={[{ key: 'reviewer', label: 'Reviewer', value: mockUsers[0].name, type: 'select', options: mockUsers.map(u => ({ value: u.name, label: u.name })) }]} onSave={v => store.assignReviewer(capture.id, v.reviewer)} onClose={() => setModal(null)} />
            )} />
            <Action label="Add Comment" icon={<EditRounded />} onClick={() => setModal(
              <PromptModal title="Add Comment" fields={[{ key: 'note', label: 'Comment', value: capture.reviewNotes ?? '' }]} onSave={v => store.reviewCapture(capture.id, 'request_changes', v.note)} onClose={() => setModal(null)} />
            )} />
          </Box>
        </PanelSection>

        <PanelSection title="Publish">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {!isPublished
              ? <Action label="Publish Capture" icon={<PublishRounded />} tone="primary" onClick={() => store.publishCapture(capture.id)} />
              : <Action label="Unpublish Capture" icon={<UnpublishedRounded />} onClick={() => store.unpublishCapture(capture.id)} />}
            <Action label="Published History" icon={<HistoryRounded />} to={`/captures/${capture.id}`} />
          </Box>
        </PanelSection>

        <PanelSection title="Tour">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {!tour
              ? <Action label="Generate Tour" icon={<AutoAwesomeRounded />} tone="primary" onClick={() => { const id = store.generateTour(capture.id); setSel({ type: 'tour', id }); }} />
              : <>
                  <Action label="Open Tour" icon={<ViewInArRounded />} to={`/tours/${tour.id}`} />
                  <Action label="View Tour Node" icon={<OpenInNewRounded />} onClick={() => setSel({ type: 'tour', id: tour.id })} />
                </>}
          </Box>
        </PanelSection>
      </>
    );
  }

  // ── Tour panel ──
  function TourPanel({ tour }: { tour: MockTour }) {
    const ts = statusConfig.tour[tour.status];
    return (
      <>
        <PanelHeader kind="Tour" title={tour.roomName} sub={`${tour.captures} panoramas · ${tour.viewCount} views`} dot={ts.color} />
        <Box sx={{ mb: 3, p: 1.75, borderRadius: '12px', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: ts.color }} />
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>Tour status: {ts.label}</Typography>
        </Box>
        <PanelSection title="Tour Actions">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Action label="Open Tour" icon={<ViewInArRounded />} tone="primary" to={`/tours/${tour.id}`} />
            <Action label="Edit Tour" icon={<EditRounded />} onClick={() => setModal(
              <PromptModal title="Edit Tour" fields={[{ key: 'room', label: 'Tour name', value: tour.roomName }]} onSave={v => store.updateTour(tour.id, { roomName: v.room })} onClose={() => setModal(null)} />
            )} />
            {tour.status !== 'published'
              ? <Action label="Publish Tour" icon={<PublishRounded />} tone="success" onClick={() => store.publishTour(tour.id)} />
              : <Typography sx={{ alignSelf: 'center', fontSize: '0.8125rem', color: colors.success, fontWeight: 600 }}>✓ Published</Typography>}
          </Box>
        </PanelSection>
      </>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 4 }}>
        <Box>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.05, mb: 1 }}>
            Construction Workflow
          </Typography>
          <Typography sx={{ fontSize: '1rem', color: colors.textMuted, maxWidth: 540, lineHeight: 1.5 }}>
            Manage the complete construction documentation lifecycle from a single workspace.
          </Typography>
        </Box>
        <Action label="New Project" icon={<AddRounded />} tone="primary" onClick={openCreateProject} />
      </Box>

      {/* Two-pane workspace */}
      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' }, alignItems: 'flex-start' }}>
        {/* Navigator */}
        <Box sx={{ width: { xs: '100%', md: 340 }, flexShrink: 0, borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, overflow: 'hidden' }}>
          <Box sx={{ px: 2.25, py: 1.75, borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '0.02em' }}>Workflow Navigator</Typography>
            <Box onClick={openCreateProject} title="New project" sx={{ width: 26, height: 26, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: colors.textMuted, '&:hover': { backgroundColor: colors.bg, color: colors.primary } }}>
              <AddRounded sx={{ fontSize: 17 }} />
            </Box>
          </Box>
          <Box sx={{ p: 1, maxHeight: { md: 'calc(100vh - 220px)' }, overflowY: 'auto' }}>
            {activeProjects.length === 0
              ? <Typography sx={{ p: 2, fontSize: '0.8125rem', color: colors.textMuted, textAlign: 'center' }}>No projects yet.</Typography>
              : renderTree()}
          </Box>
        </Box>

        {/* Context panel */}
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 480, borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}` }}>
          {renderPanel()}
        </Box>
      </Box>

      {modal}
    </Box>
  );
}
