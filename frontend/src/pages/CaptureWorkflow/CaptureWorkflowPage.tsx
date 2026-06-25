import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import {
  FolderRounded, DomainRounded, LayersRounded, PhotoCameraRounded,
  CheckCircleRounded, ArrowForwardRounded, ArrowBackRounded,
  CloudUploadRounded, AddLocationAltRounded, ZoomInRounded, ZoomOutRounded,
  CenterFocusStrongRounded, MyLocationRounded, FullscreenRounded, FullscreenExitRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { getFloorPlanByFloor, getFloorsByTower } from '@store/workflowSelectors';

/* ── palette ────────────────────────────────────────────────────────────── */
const P = {
  border:    '#e4e7ec',
  muted:     '#6b7280',
  subtle:    '#9ca3af',
  strong:    '#111827',
  blue:      '#2563eb',
  blueHover: '#1d4ed8',
  blueSoft:  'rgba(37,99,235,0.08)',
  blueRing:  'rgba(37,99,235,0.18)',
  red:       '#dc2626',
  white:     '#ffffff',
  bg:        '#f7f8fa',
  ink:       '#111318',
};
const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

type Step = 'project' | 'tower' | 'floor' | 'capture';
const STEPS: { key: Step; label: string; num: number }[] = [
  { key: 'project', label: 'Project', num: 1 },
  { key: 'tower',   label: 'Tower',   num: 2 },
  { key: 'floor',   label: 'Floor',   num: 3 },
  { key: 'capture', label: 'Capture', num: 4 },
];

/* ── Step indicator — clickable to go back ──────────────────────────────── */
function StepIndicator({
  current, selections, onStepClick,
}: {
  current: Step;
  selections: Partial<Record<Step, string>>;
  onStepClick: (step: Step) => void;
}) {
  const currentIdx = STEPS.findIndex(s => s.key === current);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', mb: { xs: 3, md: 4 } }}>
      {STEPS.map((s, i) => {
        const isDone   = i < currentIdx;
        const isActive = s.key === current;
        const canClick = isDone; // only completed steps are clickable
        return (
          <React.Fragment key={s.key}>
            <Box
              onClick={() => canClick && onStepClick(s.key)}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 0.5, minWidth: { xs: 48, sm: 64 },
                cursor: canClick ? 'pointer' : 'default',
              }}
            >
              <Box sx={{
                width: { xs: 32, sm: 38 }, height: { xs: 32, sm: 38 }, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: T,
                backgroundColor: isActive ? P.blue : isDone ? P.blueSoft : P.bg,
                border: `2px solid ${isActive ? P.blue : isDone ? P.blue : P.border}`,
                color: isActive ? P.white : isDone ? P.blue : P.subtle,
                boxShadow: isActive ? '0 4px 14px rgba(37,99,235,0.32)' : 'none',
                ...(canClick ? { '&:hover': { backgroundColor: P.blue, color: P.white, borderColor: P.blue } } : {}),
              }}>
                {isDone
                  ? <CheckCircleRounded sx={{ fontSize: { xs: 15, sm: 18 } }} />
                  : <Typography sx={{ fontSize: { xs: '0.6875rem', sm: '0.8125rem' }, fontWeight: 700 }}>{s.num}</Typography>}
              </Box>
              <Typography sx={{
                fontSize: { xs: '0.5rem', sm: '0.625rem' },
                fontWeight: isActive ? 700 : 500,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                color: isActive ? P.blue : isDone ? P.muted : P.subtle,
                maxWidth: { xs: 44, sm: 60 }, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center',
              }}>
                {isDone && selections[s.key] ? selections[s.key] : s.label}
              </Typography>
            </Box>
            {i < STEPS.length - 1 && (
              <Box sx={{ flex: 1, height: 2, mx: 0.5, mb: 3.5, borderRadius: 1, backgroundColor: isDone ? P.blue : P.border, transition: T }} />
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );
}

/* ── Context breadcrumb bar ──────────────────────────────────────────────── */
function ContextBar({ items }: { items: { label: string; value: string | undefined }[] }) {
  const visible = items.filter(i => i.value);
  if (!visible.length) return null;
  return (
    <Box sx={{ mb: 3, px: 2.5, py: 1.75, borderRadius: '12px', backgroundColor: P.white, border: `1.5px solid ${P.border}`, display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
      {visible.map((item, idx) => (
        <React.Fragment key={item.label}>
          {idx > 0 && <Box sx={{ mx: 1.5, color: P.subtle, fontSize: '0.75rem' }}>/</Box>}
          <Box>
            <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: P.subtle, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1 }}>{item.label}</Typography>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{item.value}</Typography>
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

/* ── Section heading ─────────────────────────────────────────────────────── */
function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.25rem', sm: '1.375rem' }, fontWeight: 800, color: P.strong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.5 }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>{sub}</Typography>
    </Box>
  );
}

/* ── Project card ────────────────────────────────────────────────────────── */
function ProjectCard({ name, location, gradient, accent, towers, onClick }: {
  name: string; location: string; gradient: string; accent: string; towers: number; onClick: () => void;
}) {
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', alignItems: 'center', gap: 2,
      px: { xs: 2, sm: 2.5 }, py: { xs: 1.75, sm: 2 }, borderRadius: '14px',
      border: `1.5px solid ${P.border}`, backgroundColor: P.white,
      cursor: 'pointer', transition: T,
      '&:hover': { borderColor: accent + '88', transform: 'translateY(-1px)', boxShadow: `0 6px 20px ${accent}14` },
      '&:hover .proj-arrow': { transform: 'translateX(3px)', color: accent },
    }}>
      <Box sx={{ width: { xs: 40, sm: 44 }, height: { xs: 40, sm: 44 }, borderRadius: '12px', background: gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 12px ${accent}28` }}>
        <FolderRounded sx={{ color: '#fff', fontSize: { xs: 19, sm: 22 } }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: { xs: '0.875rem', sm: '0.9375rem' }, fontWeight: 700, color: P.strong, letterSpacing: '-0.01em' }}>{name}</Typography>
        <Typography noWrap sx={{ fontSize: '0.8125rem', color: P.muted }}>{location}</Typography>
      </Box>
      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: accent, mb: 0.25 }}>{towers} towers</Typography>
        <ArrowForwardRounded className="proj-arrow" sx={{ fontSize: 16, color: P.subtle, transition: T, display: 'block', ml: 'auto' }} />
      </Box>
    </Box>
  );
}

/* ── Tower card — 2-col grid tile ────────────────────────────────────────── */
function TowerCard({ name, floors, index, onClick }: { name: string; floors: number; index: number; onClick: () => void }) {
  const ACCENTS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];
  const accent  = ACCENTS[index % ACCENTS.length];
  return (
    <Box onClick={onClick} sx={{
      position: 'relative', overflow: 'hidden',
      px: 2, pt: 2.25, pb: 2,
      borderRadius: '16px', border: `1.5px solid ${P.border}`,
      backgroundColor: P.white, cursor: 'pointer', transition: T,
      '&:hover': {
        borderColor: `${accent}60`,
        transform: 'translateY(-3px)',
        boxShadow: `0 10px 28px ${accent}18`,
      },
      '&:hover .tw-icon-box': { background: accent, borderColor: accent },
      '&:hover .tw-icon': { color: '#fff' },
      '&:hover .tw-name': { color: accent },
    }}>
      {/* Subtle top accent bar */}
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${accent} 0%, ${accent}44 100%)`, borderRadius: '16px 16px 0 0' }} />

      {/* Icon */}
      <Box className="tw-icon-box" sx={{
        width: 40, height: 40, borderRadius: '11px', mb: 1.5,
        background: `${accent}14`, border: `1.5px solid ${accent}28`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: T,
      }}>
        <DomainRounded className="tw-icon" sx={{ fontSize: 20, color: accent, transition: T }} />
      </Box>

      {/* Name */}
      <Typography className="tw-name" sx={{
        fontSize: '0.9375rem', fontWeight: 700, color: P.strong,
        letterSpacing: '-0.02em', lineHeight: 1.2, mb: 0.375, transition: T,
      }}>{name}</Typography>

      {/* Floor count */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>{floors} floors</Typography>
        <Box sx={{ px: 0.875, py: 0.25, borderRadius: '6px', backgroundColor: `${accent}12` }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: accent }}>{floors}F</Typography>
        </Box>
      </Box>
    </Box>
  );
}

/* ── Floor card — 3-column grid, clean badge style ───────────────────────── */
function FloorCard({ label, number, onClick }: { label: string; number: number; onClick: () => void }) {
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 0.375, py: { xs: 1.75, sm: 2.25 }, px: 1, borderRadius: '14px',
      border: `1.5px solid ${P.border}`, backgroundColor: P.white,
      cursor: 'pointer', transition: T, textAlign: 'center',
      '&:hover': {
        borderColor: P.blue,
        backgroundColor: P.blueSoft,
        transform: 'translateY(-2px)',
        boxShadow: '0 6px 18px rgba(37,99,235,0.12)',
      },
      '&:hover .fl-num': { color: P.blue },
      '&:hover .fl-lbl': { color: P.blue },
    }}>
      <Box sx={{
        width: 34, height: 34, borderRadius: '10px', mb: 0.5,
        backgroundColor: P.bg, border: `1.5px solid ${P.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography className="fl-num" sx={{ fontSize: '0.875rem', fontWeight: 800, color: P.strong, letterSpacing: '-0.03em', transition: T, lineHeight: 1 }}>
          {number}
        </Typography>
      </Box>
      <Typography className="fl-lbl" sx={{ fontSize: { xs: '0.6875rem', sm: '0.75rem' }, fontWeight: 600, color: P.muted, transition: T, lineHeight: 1.1 }}>
        {label}
      </Typography>
    </Box>
  );
}

/* ── Floor plan viewer with pin + fullscreen ─────────────────────────────── */
function FloorPlanWithPin({ floorPlan, onPinPlace }: { floorPlan: Record<string, unknown> | null; onPinPlace: (x: number, y: number) => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const zoom = useCallback((dir: 1 | -1) => setScale(s => Math.min(4, Math.max(0.5, s + dir * 0.25))), []);
  const resetView = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setOffset({ x: dragStart.current.ox + e.clientX - dragStart.current.x, y: dragStart.current.oy + e.clientY - dragStart.current.y });
  }
  function onMouseUp() { setIsDragging(false); }
  function onClick(e: React.MouseEvent) {
    if (!containerRef.current || isDragging) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left - offset.x) / scale) / rect.width * 100;
    const y = ((e.clientY - rect.top - offset.y) / scale) / rect.height * 100;
    const clamped = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    setPin(clamped);
    onPinPlace(clamped.x, clamped.y);
  }

  const imageUrl = floorPlan
    ? ((floorPlan as any).fileUrl ?? (floorPlan as any).file_url ?? ((floorPlan as any).mediaAssets as any)?.[0]?.original_url ?? null)
    : null;

  const controls = (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {[
        { icon: <ZoomInRounded sx={{ fontSize: 15 }} />, fn: () => zoom(1) },
        { icon: <ZoomOutRounded sx={{ fontSize: 15 }} />, fn: () => zoom(-1) },
        { icon: <CenterFocusStrongRounded sx={{ fontSize: 15 }} />, fn: resetView },
        { icon: fullscreen ? <FullscreenExitRounded sx={{ fontSize: 15 }} /> : <FullscreenRounded sx={{ fontSize: 15 }} />, fn: () => setFullscreen(f => !f) },
      ].map((b, i) => (
        <Box key={i} onClick={(e) => { e.stopPropagation(); b.fn(); }} sx={{ width: 28, height: 28, borderRadius: '7px', backgroundColor: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', transition: T, '&:hover': { backgroundColor: 'rgba(37,99,235,0.7)' } }}>
          {b.icon}
        </Box>
      ))}
    </Box>
  );

  const viewer = (
    <Box sx={{
      borderRadius: fullscreen ? 0 : '18px', overflow: 'hidden',
      border: fullscreen ? 'none' : `1.5px solid ${P.border}`,
      backgroundColor: '#0f172a', position: 'relative',
      width: '100%', height: '100%',
      boxShadow: fullscreen ? 'none' : '0 8px 32px rgba(15,23,42,0.16)',
    }}>
      {/* Top bar */}
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, px: 2, py: 1.25, background: 'linear-gradient(180deg,rgba(10,12,20,0.92) 0%,transparent 100%)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {fullscreen && (
            <Box onClick={() => setFullscreen(false)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, mr: 1.5, px: 1.25, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', cursor: 'pointer', color: 'rgba(255,255,255,0.85)', fontSize: '0.8125rem', fontWeight: 600, transition: T, '&:hover': { backgroundColor: 'rgba(255,255,255,0.15)' } }}>
              <ArrowBackRounded sx={{ fontSize: 14 }} /> Back
            </Box>
          )}
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: pin ? '#22c55e' : '#f59e0b', boxShadow: pin ? '0 0 6px #22c55e' : '0 0 6px #f59e0b', flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.95)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {pin ? 'Point placed' : 'Select location'}
          </Typography>
        </Box>
        {controls}
      </Box>

      {/* Canvas */}
      <Box ref={containerRef} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onClick={onClick}
        sx={{ width: '100%', height: '100%', overflow: 'hidden', cursor: isDragging ? 'grabbing' : 'crosshair', position: 'relative', userSelect: 'none' }}>
        <Box sx={{ position: 'absolute', inset: 0, transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`, transformOrigin: '0 0', transition: isDragging ? 'none' : 'transform 0.1s' }}>
          {imageUrl ? (
            <Box component="img" src={imageUrl} alt="Floor plan" draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          ) : (
            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ width: 64, height: 64, borderRadius: '18px', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <LayersRounded sx={{ fontSize: 32, color: 'rgba(255,255,255,0.18)' }} />
              </Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9375rem', fontWeight: 600 }}>No floor plan uploaded yet</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.22)', fontSize: '0.8125rem', textAlign: 'center', maxWidth: 260 }}>Place your capture point on this blank canvas</Typography>
            </Box>
          )}
          {pin && (
            <Box sx={{ position: 'absolute', left: `${pin.x}%`, top: `${pin.y}%`, transform: 'translate(-50%,-100%)', pointerEvents: 'none' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))' }}>
                <Box sx={{ width: 34, height: 34, borderRadius: '50% 50% 50% 0', backgroundColor: '#22c55e', border: '3px solid #fff', transform: 'rotate(-45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MyLocationRounded sx={{ fontSize: 14, color: '#fff', transform: 'rotate(45deg)' }} />
                </Box>
                <Box sx={{ width: 2, height: 8, backgroundColor: '#22c55e', mt: '-1px' }} />
                <Box sx={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: '#22c55e', opacity: 0.4 }} />
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {!pin && (
        <Box sx={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', px: 2, py: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)', borderRadius: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, width: 'max-content', maxWidth: '90%' }}>
          <AddLocationAltRounded sx={{ fontSize: 18, color: '#f59e0b' }} />
          <Typography sx={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.95)', fontWeight: 500, textAlign: 'center' }}>Tap anywhere to drop pin</Typography>
        </Box>
      )}

      {/* Escape hint — fullscreen only */}
      {fullscreen && (
        <Box sx={{ position: 'absolute', bottom: 16, right: 16, px: 1.25, py: 0.5, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)', zIndex: 10 }}>
          <Typography sx={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.4)', fontWeight: 500, letterSpacing: '0.02em' }}>Press Esc to exit</Typography>
        </Box>
      )}
    </Box>
  );

  /* Normal aspect-ratio wrapper */
  if (!fullscreen) {
    return <Box sx={{ aspectRatio: '16/9' }}>{viewer}</Box>;
  }

  /* Full-screen overlay */
  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 1400, backgroundColor: '#0a0c14' }}>
      {viewer}
    </Box>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════════════ */
export default function CaptureWorkflowPage() {
  const user       = useAuthStore(s => s.user);
  const projects   = useWorkflowStore(s => s.projects);
  const towers     = useWorkflowStore(s => s.towers);
  const floors     = useWorkflowStore(s => s.floors);
  const floorPlans = useWorkflowStore(s => s.floorPlans);

  const [step, setStep]               = useState<Step>('project');
  const [selectedProject, setProject] = useState<string>('');
  const [selectedTower, setTower]     = useState<string>('');
  const [selectedFloor, setFloor]     = useState<string>('');
  const [pinPos, setPinPos]           = useState<{ x: number; y: number } | null>(null);
  const [uploaded, setUploaded]       = useState(false);
  const [dragging, setDragging]       = useState(false);

  const assignedIds = new Set(user?.assignedProjectIds ?? []);
  const myProjects  = assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived);

  const myTowers = [...towers.filter(t => t.projectId === selectedProject)]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const myFloors = [...getFloorsByTower(floors, selectedTower)]
    .sort((a, b) => a.number - b.number);

  const floorPlan = getFloorPlanByFloor(floorPlans, selectedTower, selectedFloor);

  const stepIdx = STEPS.findIndex(s => s.key === step);
  const selectedProjectObj = projects.find(p => p.id === selectedProject);
  const selectedTowerObj   = towers.find(t => t.id === selectedTower);
  const selectedFloorObj   = floors.find(f => f.id === selectedFloor);

  const selections: Partial<Record<Step, string>> = {
    project: selectedProjectObj?.name,
    tower:   selectedTowerObj?.name,
    floor:   selectedFloorObj?.label,
  };

  /* navigate back via step indicator or Back button */
  function jumpToStep(target: Step) {
    const targetIdx = STEPS.findIndex(s => s.key === target);
    if (targetIdx >= stepIdx) return; // can't jump forward
    setStep(target);
    if (targetIdx <= 0) { setProject(''); setTower(''); setFloor(''); setPinPos(null); }
    else if (targetIdx <= 1) { setTower(''); setFloor(''); setPinPos(null); }
    else if (targetIdx <= 2) { setFloor(''); setPinPos(null); }
  }

  function goBack() {
    const prev = STEPS[stepIdx - 1];
    if (prev) jumpToStep(prev.key);
  }

  function reset() {
    setStep('project'); setProject(''); setTower(''); setFloor(''); setPinPos(null); setUploaded(false);
  }

  const BackBtn = step !== 'project' && !uploaded ? (
    <Box onClick={goBack} sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.75,
      px: 1.75, py: 0.875, borderRadius: '10px',
      border: `1.5px solid ${P.border}`, cursor: 'pointer',
      fontSize: '0.875rem', fontWeight: 600, color: P.muted,
      transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
    }}>
      <ArrowBackRounded sx={{ fontSize: 16 }} /> Back
    </Box>
  ) : undefined;

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>

      {/* Back to overview */}
      <Box component={Link} to="/dashboard/engineer" sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${P.border}`, color: P.muted,
        fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
        transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
      }}>
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
      </Box>

      {/* Page heading + Back button */}
      <Box sx={{ mb: 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography sx={{
            fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
            fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
            color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
          }}>New Capture</Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
            {user?.name?.split(' ')[0] ?? 'Engineer'} · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </Typography>
        </Box>
        {BackBtn}
      </Box>

      {/* Step indicator — clickable */}
      <StepIndicator current={step} selections={selections} onStepClick={jumpToStep} />

      {/* ── PROJECT ─────────────────────────────────────────────────────── */}
      {step === 'project' && (
        <Box>
          <SectionHead title="Select Project" sub="Which site are you visiting today?" />
          {myProjects.length === 0 ? (
            <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
              <FolderRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong }}>No projects assigned</Typography>
              <Typography sx={{ fontSize: '0.875rem', color: P.muted, mt: 0.5 }}>Contact your admin to get assigned.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {myProjects.map(p => (
                <ProjectCard key={p.id} name={p.name} location={p.location} gradient={p.gradient} accent={p.accent} towers={p.towers}
                  onClick={() => { setProject(p.id); setStep('tower'); }} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* ── TOWER ───────────────────────────────────────────────────────── */}
      {step === 'tower' && (
        <Box>
          <ContextBar items={[{ label: 'Project', value: selectedProjectObj?.name }]} />
          <SectionHead title="Select Tower" sub="Which tower are you capturing today?" />
          {myTowers.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '16px' }}>
              <Typography sx={{ color: P.muted }}>No towers found for this project.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', sm: 'repeat(3,1fr)', md: 'repeat(4,1fr)' }, gap: 1.25 }}>
              {myTowers.map((t, i) => (
                <TowerCard key={t.id} name={t.name} floors={t.floors} index={i}
                  onClick={() => { setTower(t.id); setStep('floor'); }} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* ── FLOOR ───────────────────────────────────────────────────────── */}
      {step === 'floor' && (
        <Box>
          <ContextBar items={[
            { label: 'Project', value: selectedProjectObj?.name },
            { label: 'Tower',   value: selectedTowerObj?.name },
          ]} />
          <SectionHead title="Select Floor" sub="Which floor are you capturing?" />
          {myFloors.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '16px' }}>
              <Typography sx={{ color: P.muted }}>No floors found for this tower.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3,1fr)', sm: 'repeat(4,1fr)', md: 'repeat(5,1fr)' }, gap: 1 }}>
              {myFloors.map(f => (
                <FloorCard key={f.id} label={f.label} number={f.number}
                  onClick={() => { setFloor(f.id); setStep('capture'); }} />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* ── CAPTURE ─────────────────────────────────────────────────────── */}
      {step === 'capture' && !uploaded && (
        <Box>
          <ContextBar items={[
            { label: 'Project', value: selectedProjectObj?.name },
            { label: 'Tower',   value: selectedTowerObj?.name },
            { label: 'Floor',   value: selectedFloorObj?.label },
          ]} />
          <Box sx={{ mb: 2.5 }}>
            <FloorPlanWithPin
              floorPlan={(floorPlan as unknown) as Record<string, unknown> | null}
              onPinPlace={(x, y) => setPinPos({ x, y })}
            />
          </Box>
          {/* Upload zone */}
          <Box
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length > 0 && pinPos) setUploaded(true); }}
            sx={{
              borderRadius: '16px', p: { xs: 2.5, sm: 3.5 }, textAlign: 'center',
              border: `2px dashed ${dragging ? P.blue : pinPos ? P.blue + '55' : P.border}`,
              backgroundColor: dragging ? P.blueSoft : pinPos ? 'rgba(37,99,235,0.02)' : P.bg,
              transition: T, cursor: pinPos ? 'pointer' : 'default',
            }}
          >
            {pinPos ? (
              <>
                <Box sx={{ width: 52, height: 52, borderRadius: '14px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5, boxShadow: '0 6px 18px rgba(37,99,235,0.3)' }}>
                  <CloudUploadRounded sx={{ fontSize: 26, color: P.white }} />
                </Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>Upload Capture Image</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: P.muted, mb: 1.75 }}>Drag & drop or click to browse</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: P.subtle, mb: 2.5 }}>Supported: .jpg .jpeg .png .dng .insp</Typography>
                <Box component="label" htmlFor="capture-file-input" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.75, py: 1.125, borderRadius: '10px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 700, color: P.white, boxShadow: '0 4px 14px rgba(37,99,235,0.3)', '&:hover': { opacity: 0.9 } }}>
                  <PhotoCameraRounded sx={{ fontSize: 17 }} /> Browse & Upload
                </Box>
                <Box component="input" id="capture-file-input" type="file" accept=".jpg,.jpeg,.png,.dng,.insp" onChange={() => { if (pinPos) setUploaded(true); }} sx={{ display: 'none' }} />
              </>
            ) : (
              <>
                <Box sx={{ width: 52, height: 52, borderRadius: '14px', backgroundColor: P.bg, border: `1.5px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5 }}>
                  <AddLocationAltRounded sx={{ fontSize: 26, color: P.subtle }} />
                </Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>Place a capture point first</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Tap anywhere on the floor plan above to mark your location</Typography>
              </>
            )}
          </Box>
        </Box>
      )}

      {/* ── SUCCESS ─────────────────────────────────────────────────────── */}
      {step === 'capture' && uploaded && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Box sx={{ width: 80, height: 80, borderRadius: '50%', backgroundColor: 'rgba(34,197,94,0.1)', border: '2px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 3 }}>
            <CheckCircleRounded sx={{ fontSize: 44, color: '#22c55e' }} />
          </Box>
          <Typography sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, fontWeight: 800, color: P.strong, letterSpacing: '-0.04em', mb: 0.75 }}>Capture Submitted!</Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: P.muted, maxWidth: 340, mx: 'auto', mb: 1 }}>
            Your image for <strong>{selectedFloorObj?.label}</strong> in <strong>{selectedTowerObj?.name}</strong> has been sent for review.
          </Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: P.subtle, mb: 4 }}>A manager will review it shortly.</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Box onClick={reset} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.75, py: 1.125, borderRadius: '10px', border: `1.5px solid ${P.border}`, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 700, color: P.muted, transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } }}>
              <PhotoCameraRounded sx={{ fontSize: 16 }} /> Capture Another
            </Box>
            <Box component={Link} to="/my-captures" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2.75, py: 1.125, borderRadius: '10px', background: `linear-gradient(135deg,${P.blue},${P.blueHover})`, color: P.white, fontSize: '0.875rem', fontWeight: 700, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
              View History <ArrowForwardRounded sx={{ fontSize: 16 }} />
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
