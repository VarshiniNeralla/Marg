import React, { useState, useRef, useCallback } from 'react';
import { Box, Typography, Grid, LinearProgress } from '@mui/material';
import {
  FolderRounded, DomainRounded, LayersRounded, PhotoCameraRounded,
  CheckCircleRounded, ArrowForwardRounded, ArrowBackRounded,
  CloudUploadRounded, AddLocationAltRounded, ZoomInRounded, ZoomOutRounded,
  CenterFocusStrongRounded, MyLocationRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { getFloorPlanByFloor, getFloorsByTower } from '@store/workflowSelectors';
import PageHeader from '@shared/components/PageHeader/PageHeader';

type Step = 'project' | 'tower' | 'floor' | 'capture';

const STEPS: { key: Step; label: string; icon: React.ReactNode; num: number }[] = [
  { key: 'project', label: 'Project', icon: <FolderRounded sx={{ fontSize: 18 }} />, num: 1 },
  { key: 'tower',   label: 'Tower',   icon: <DomainRounded sx={{ fontSize: 18 }} />, num: 2 },
  { key: 'floor',   label: 'Floor',   icon: <LayersRounded sx={{ fontSize: 18 }} />, num: 3 },
  { key: 'capture', label: 'Capture', icon: <PhotoCameraRounded sx={{ fontSize: 18 }} />, num: 4 },
];

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepIndicator({ current, selections }: { current: Step; selections: Partial<Record<Step, string>> }) {
  const currentIdx = STEPS.findIndex(s => s.key === current);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 5 }}>
      {STEPS.map((s, i) => {
        const isDone   = i < currentIdx;
        const isActive = s.key === current;
        const isFuture = i > currentIdx;
        return (
          <React.Fragment key={s.key}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, minWidth: 72 }}>
              <Box sx={{
                width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: `all 0.2s`,
                backgroundColor: isActive ? colors.primary : isDone ? 'rgba(37,99,235,0.1)' : colors.bgDeep,
                border: `2px solid ${isActive ? colors.primary : isDone ? colors.primary : colors.borderLight}`,
                color: isActive ? '#fff' : isDone ? colors.primary : colors.textSubdued,
                boxShadow: isActive ? '0 4px 16px rgba(37,99,235,0.35)' : 'none',
              }}>
                {isDone ? <CheckCircleRounded sx={{ fontSize: 20 }} /> : s.icon}
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography sx={{ fontSize: '0.6875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : isDone ? colors.textSecondary : colors.textSubdued, letterSpacing: '0.02em' }}>
                  {s.label}
                </Typography>
                {isDone && selections[s.key] && (
                  <Typography noWrap sx={{ fontSize: '0.625rem', color: colors.primary, maxWidth: 68, mt: 0.125 }}>
                    {selections[s.key]}
                  </Typography>
                )}
              </Box>
            </Box>
            {i < STEPS.length - 1 && (
              <Box sx={{ flex: 1, height: 2, mx: 0.5, mb: 4.5, borderRadius: 1, backgroundColor: isDone ? colors.primary : colors.borderLight, transition: 'background 0.2s' }} />
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );
}

// ── Project card ───────────────────────────────────────────────────────────────
function ProjectCard({ name, location, gradient, accent, towers, onClick }: { name: string; location: string; gradient: string; accent: string; towers: number; onClick: () => void }) {
  return (
    <Box onClick={onClick} sx={{
      p: 0, borderRadius: '16px', border: `1.5px solid ${colors.borderLight}`, overflow: 'hidden',
      backgroundColor: colors.card, cursor: 'pointer',
      transition: `all ${motion.durationFast}`,
      '&:hover': { borderColor: accent, transform: 'translateY(-2px)', boxShadow: `0 12px 32px ${accent}18` },
    }}>
      <Box sx={{ height: 6, background: gradient }} />
      <Box sx={{ p: 2.25, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: '10px', background: gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FolderRounded sx={{ color: '#fff', fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em' }}>{name}</Typography>
          <Typography noWrap sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{location}</Typography>
        </Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: accent }}>{towers} towers</Typography>
          <ArrowForwardRounded sx={{ fontSize: 16, color: colors.textSubdued, mt: 0.25 }} />
        </Box>
      </Box>
    </Box>
  );
}

// ── Tower card ─────────────────────────────────────────────────────────────────
function TowerCard({ name, floors, onClick }: { name: string; floors: number; onClick: () => void }) {
  return (
    <Box onClick={onClick} sx={{
      p: 2.5, borderRadius: '14px', border: `1.5px solid ${colors.borderLight}`,
      backgroundColor: colors.card, cursor: 'pointer',
      transition: `all ${motion.durationFast}`,
      '&:hover': { borderColor: colors.primary, transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(37,99,235,0.10)', backgroundColor: colors.primarySoft },
      display: 'flex', alignItems: 'center', gap: 2,
    }}>
      <Box sx={{ width: 42, height: 42, borderRadius: '12px', backgroundColor: 'rgba(37,99,235,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <DomainRounded sx={{ fontSize: 22, color: colors.primary }} />
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>{name}</Typography>
        <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{floors} floors</Typography>
      </Box>
      <Box sx={{ width: 28, height: 28, borderRadius: '8px', backgroundColor: colors.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ArrowForwardRounded sx={{ fontSize: 16, color: colors.textSubdued }} />
      </Box>
    </Box>
  );
}

// ── Floor grid card ────────────────────────────────────────────────────────────
function FloorCard({ label, number, onClick }: { label: string; number: number; onClick: () => void }) {
  return (
    <Box onClick={onClick} sx={{
      p: 2.5, borderRadius: '14px', border: `1.5px solid ${colors.borderLight}`,
      backgroundColor: colors.card, cursor: 'pointer', textAlign: 'center',
      transition: `all ${motion.durationFast}`,
      '&:hover': { borderColor: colors.primary, backgroundColor: colors.primarySoft, transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(37,99,235,0.10)' },
      '&:hover .floor-num': { color: colors.primary },
    }}>
      <Typography className="floor-num" sx={{ fontSize: '1.375rem', fontWeight: 800, color: colors.textStrong, lineHeight: 1, letterSpacing: '-0.04em', transition: 'color 0.15s' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 500, color: colors.textSubdued, mt: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Floor {number}</Typography>
    </Box>
  );
}

// ── Floor plan viewer with pin ─────────────────────────────────────────────────
function FloorPlanWithPin({ floorPlan, onPinPlace }: { floorPlan: Record<string, unknown> | null; onPinPlace: (x: number, y: number) => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const zoom = useCallback((dir: 1 | -1) => setScale(s => Math.min(4, Math.max(0.5, s + dir * 0.25))), []);
  const resetView = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

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
    const y = ((e.clientY - rect.top  - offset.y) / scale) / rect.height * 100;
    const clamped = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    setPin(clamped);
    onPinPlace(clamped.x, clamped.y);
  }

  const imageUrl = floorPlan
    ? ((floorPlan as any).fileUrl ?? (floorPlan as any).file_url ?? ((floorPlan as any).mediaAssets as any)?.[0]?.original_url ?? null)
    : null;

  return (
    <Box sx={{ borderRadius: '20px', overflow: 'hidden', border: `1.5px solid ${colors.borderLight}`, backgroundColor: '#0f172a', position: 'relative', aspectRatio: '16/9', boxShadow: '0 8px 40px rgba(15,23,42,0.18)' }}>
      {/* Top status bar */}
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, px: 2, py: 1.25, background: 'linear-gradient(180deg,rgba(15,23,42,0.85) 0%,transparent 100%)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: pin ? '#22c55e' : '#f59e0b', boxShadow: pin ? '0 0 6px #22c55e' : '0 0 6px #f59e0b' }} />
          <Typography sx={{ fontSize: '0.8125rem', color: '#fff', fontWeight: 600 }}>
            {pin ? 'Capture point placed' : 'Tap to place capture point'}
          </Typography>
        </Box>
        {/* Zoom controls */}
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {[
            { icon: <ZoomInRounded sx={{ fontSize: 16 }} />, fn: () => zoom(1), title: 'Zoom in' },
            { icon: <ZoomOutRounded sx={{ fontSize: 16 }} />, fn: () => zoom(-1), title: 'Zoom out' },
            { icon: <CenterFocusStrongRounded sx={{ fontSize: 16 }} />, fn: resetView, title: 'Reset' },
          ].map((b, i) => (
            <Box key={i} title={b.title} onClick={(e) => { e.stopPropagation(); b.fn(); }} sx={{ width: 30, height: 30, borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', '&:hover': { backgroundColor: 'rgba(37,99,235,0.6)' } }}>
              {b.icon}
            </Box>
          ))}
        </Box>
      </Box>

      {/* Canvas */}
      <Box
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={onClick}
        sx={{ width: '100%', height: '100%', overflow: 'hidden', cursor: isDragging ? 'grabbing' : 'crosshair', position: 'relative', userSelect: 'none' }}
      >
        <Box sx={{ position: 'absolute', inset: 0, transform: `translate(${offset.x}px,${offset.y}px) scale(${scale})`, transformOrigin: '0 0', transition: isDragging ? 'none' : 'transform 0.1s' }}>
          {imageUrl ? (
            <Box component="img" src={imageUrl} alt="Floor plan" draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          ) : (
            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ width: 72, height: 72, borderRadius: '20px', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <LayersRounded sx={{ fontSize: 36, color: 'rgba(255,255,255,0.2)' }} />
              </Box>
              <Typography sx={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.9375rem', fontWeight: 600 }}>No floor plan uploaded</Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.8125rem', textAlign: 'center', maxWidth: 280 }}>
                Place your capture point on this blank canvas — the admin can upload a floor plan later.
              </Typography>
            </Box>
          )}
          {/* Pin */}
          {pin && (
            <Box sx={{ position: 'absolute', left: `${pin.x}%`, top: `${pin.y}%`, transform: 'translate(-50%,-100%)', pointerEvents: 'none' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))' }}>
                <Box sx={{ width: 36, height: 36, borderRadius: '50% 50% 50% 0', backgroundColor: '#22c55e', border: '3px solid #fff', transform: 'rotate(-45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MyLocationRounded sx={{ fontSize: 14, color: '#fff', transform: 'rotate(45deg)' }} />
                </Box>
                <Box sx={{ width: 2, height: 10, backgroundColor: '#22c55e', mt: '-1px' }} />
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22c55e', opacity: 0.4 }} />
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* Bottom hint when no pin */}
      {!pin && (
        <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, px: 2, py: 1.25, background: 'linear-gradient(0deg,rgba(15,23,42,0.85) 0%,transparent 100%)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <AddLocationAltRounded sx={{ fontSize: 16, color: '#f59e0b' }} />
          <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>Click anywhere on the plan to drop your capture point</Typography>
        </Box>
      )}
    </Box>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
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

  function goBack() {
    const prev = STEPS[stepIdx - 1];
    if (prev) {
      setStep(prev.key);
      if (prev.key === 'project') { setProject(''); setTower(''); setFloor(''); }
      if (prev.key === 'tower')   { setTower(''); setFloor(''); }
      if (prev.key === 'floor')   { setFloor(''); setPinPos(null); }
    }
  }

  function reset() {
    setStep('project'); setProject(''); setTower(''); setFloor(''); setPinPos(null); setUploaded(false);
  }

  return (
    <Box sx={{ maxWidth: 860, mx: 'auto' }}>
      <PageHeader
        title="New Capture"
        subtitle={`${user?.name?.split(' ')[0] ?? 'Engineer'} · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
        breadcrumbs={[{ label: 'Capture Workflow' }]}
        actions={
          step !== 'project' && !uploaded ? (
            <Box onClick={goBack} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '10px', border: `1px solid ${colors.border}`, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500, color: colors.textSecondary, '&:hover': { borderColor: colors.primary, color: colors.primary } }}>
              <ArrowBackRounded sx={{ fontSize: 16 }} /> Back
            </Box>
          ) : undefined
        }
      />

      {/* Step indicator */}
      <StepIndicator current={step} selections={selections} />

      {/* ── Project ─────────────────────────────────────────────────────────── */}
      {step === 'project' && (
        <Box>
          <Box sx={{ mb: 3 }}>
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.03em' }}>Select Project</Typography>
            <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, mt: 0.5 }}>Which site are you visiting today?</Typography>
          </Box>
          {myProjects.length === 0 ? (
            <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${colors.borderLight}`, borderRadius: '20px', backgroundColor: colors.card }}>
              <FolderRounded sx={{ fontSize: 48, color: colors.textSubdued, mb: 1.5 }} />
              <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: colors.textSecondary }}>No projects assigned</Typography>
              <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mt: 0.5 }}>Contact your admin to get assigned to a project.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {myProjects.map(p => (
                <ProjectCard
                  key={p.id}
                  name={p.name}
                  location={p.location}
                  gradient={p.gradient}
                  accent={p.accent}
                  towers={p.towers}
                  onClick={() => { setProject(p.id); setStep('tower'); }}
                />
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* ── Tower ───────────────────────────────────────────────────────────── */}
      {step === 'tower' && (
        <Box>
          <Box sx={{ mb: 3, p: 2.5, borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: '10px', background: selectedProjectObj?.gradient, flexShrink: 0 }} />
            <Box>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Selected Project</Typography>
              <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>{selectedProjectObj?.name}</Typography>
            </Box>
          </Box>
          <Box sx={{ mb: 3 }}>
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.03em' }}>Select Tower</Typography>
            <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, mt: 0.5 }}>Which tower are you capturing today?</Typography>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {myTowers.map(t => (
              <TowerCard key={t.id} name={t.name} floors={t.floors} onClick={() => { setTower(t.id); setStep('floor'); }} />
            ))}
            {myTowers.length === 0 && (
              <Box sx={{ py: 6, textAlign: 'center', border: `1.5px dashed ${colors.borderLight}`, borderRadius: '16px' }}>
                <Typography sx={{ color: colors.textMuted }}>No towers found for this project.</Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── Floor ───────────────────────────────────────────────────────────── */}
      {step === 'floor' && (
        <Box>
          <Box sx={{ mb: 3, p: 2.5, borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, display: 'flex', gap: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Project</Typography>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>{selectedProjectObj?.name}</Typography>
            </Box>
            <Box sx={{ width: 1, backgroundColor: colors.borderLight, mx: 0.5 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Tower</Typography>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>{selectedTowerObj?.name}</Typography>
            </Box>
          </Box>
          <Box sx={{ mb: 3 }}>
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.03em' }}>Select Floor</Typography>
            <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, mt: 0.5 }}>Which floor are you capturing?</Typography>
          </Box>
          <Grid container spacing={1.5}>
            {myFloors.map(f => (
              <Grid key={f.id} size={{ xs: 4, sm: 3, md: 2 }}>
                <FloorCard label={f.label} number={f.number} onClick={() => { setFloor(f.id); setStep('capture'); }} />
              </Grid>
            ))}
            {myFloors.length === 0 && (
              <Grid size={{ xs: 12 }}>
                <Box sx={{ py: 6, textAlign: 'center', border: `1.5px dashed ${colors.borderLight}`, borderRadius: '16px' }}>
                  <Typography sx={{ color: colors.textMuted }}>No floors found for this tower.</Typography>
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      )}

      {/* ── Capture ─────────────────────────────────────────────────────────── */}
      {step === 'capture' && !uploaded && (
        <Box>
          {/* Context bar */}
          <Box sx={{ mb: 3, p: 2, borderRadius: '14px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
            {[
              { label: 'Project', value: selectedProjectObj?.name },
              { label: 'Tower',   value: selectedTowerObj?.name },
              { label: 'Floor',   value: selectedFloorObj?.label },
            ].map((item, i) => (
              <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                {i > 0 && <Box sx={{ width: 1, height: 28, backgroundColor: colors.borderLight }} />}
                <Box>
                  <Typography sx={{ fontSize: '0.625rem', color: colors.textSubdued, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{item.label}</Typography>
                  <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>{item.value ?? '—'}</Typography>
                </Box>
              </Box>
            ))}
          </Box>

          {/* Floor plan */}
          <Box sx={{ mb: 2.5 }}>
            <FloorPlanWithPin
              floorPlan={(floorPlan as unknown) as Record<string, unknown> | null}
              onPinPlace={(x, y) => setPinPos({ x, y })}
            />
          </Box>

          {/* Upload */}
          <Box
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length > 0 && pinPos) setUploaded(true); }}
            sx={{
              borderRadius: '16px', p: 3.5, textAlign: 'center',
              border: `2px dashed ${dragging ? colors.primary : pinPos ? colors.primary + '40' : colors.borderLight}`,
              backgroundColor: dragging ? colors.primarySoft : pinPos ? 'rgba(37,99,235,0.02)' : colors.bgDeep,
              transition: `all ${motion.durationFast}`,
              cursor: pinPos ? 'pointer' : 'default',
            }}
          >
            {pinPos ? (
              <>
                <Box sx={{ width: 56, height: 56, borderRadius: '16px', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5, boxShadow: '0 8px 20px rgba(37,99,235,0.3)' }}>
                  <CloudUploadRounded sx={{ fontSize: 28, color: '#fff' }} />
                </Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong, mb: 0.5 }}>Upload Capture Image</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, mb: 2 }}>Drag & drop here or browse files</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued, mb: 2.5 }}>Supported: .jpg .jpeg .png .dng .insp</Typography>
                <Box component="label" htmlFor="capture-file-input" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 3, py: 1.125, borderRadius: '10px', background: colors.primaryGradient, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 700, color: '#fff', boxShadow: '0 4px 14px rgba(37,99,235,0.3)', '&:hover': { opacity: 0.9 } }}>
                  <PhotoCameraRounded sx={{ fontSize: 17 }} /> Browse & Upload
                </Box>
                <Box component="input" id="capture-file-input" type="file" accept=".jpg,.jpeg,.png,.dng,.insp" onChange={() => { if (pinPos) setUploaded(true); }} sx={{ display: 'none' }} />
              </>
            ) : (
              <>
                <Box sx={{ width: 56, height: 56, borderRadius: '16px', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5 }}>
                  <AddLocationAltRounded sx={{ fontSize: 28, color: colors.textSubdued }} />
                </Box>
                <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textSecondary, mb: 0.5 }}>Place a capture point first</Typography>
                <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>Tap anywhere on the floor plan above to mark your location</Typography>
              </>
            )}
          </Box>
        </Box>
      )}

      {/* ── Success ─────────────────────────────────────────────────────────── */}
      {step === 'capture' && uploaded && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Box sx={{ position: 'relative', width: 88, height: 88, mx: 'auto', mb: 3 }}>
            <Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', backgroundColor: 'rgba(34,197,94,0.12)', animation: 'ping 1.5s ease-out 1' }} />
            <Box sx={{ width: 88, height: 88, borderRadius: '50%', backgroundColor: 'rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <CheckCircleRounded sx={{ fontSize: 48, color: '#22c55e' }} />
            </Box>
          </Box>
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', mb: 0.75 }}>Capture Submitted!</Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, maxWidth: 360, mx: 'auto', mb: 1 }}>
            Your image for <strong>{selectedFloorObj?.label}</strong> in <strong>{selectedTowerObj?.name}</strong> has been sent for review.
          </Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: colors.textSubdued, mb: 4 }}>A manager will review it shortly.</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Box onClick={reset} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 3, py: 1.125, borderRadius: '10px', border: `1.5px solid ${colors.border}`, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: colors.textSecondary, '&:hover': { backgroundColor: colors.bg, borderColor: colors.primary, color: colors.primary } }}>
              <PhotoCameraRounded sx={{ fontSize: 16 }} /> Capture Another
            </Box>
            <Box component="a" href="/my-captures" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 3, py: 1.125, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
              View My Captures <ArrowForwardRounded sx={{ fontSize: 16 }} />
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
