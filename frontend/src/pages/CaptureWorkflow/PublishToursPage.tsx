import React, { useState, useMemo, useEffect } from 'react';
import { Box, Typography, Snackbar, Alert, useMediaQuery, useTheme } from '@mui/material';
import {
  ArrowBackRounded, ArrowForwardRounded, ViewInArRounded, PublishRounded,
  CheckCircleRounded, RadioButtonUncheckedRounded, LayersRounded,
  ChevronLeftRounded, ChevronRightRounded,
  CheckBoxRounded, CheckBoxOutlineBlankRounded, IndeterminateCheckBoxRounded,
} from '@mui/icons-material';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { getFloorsByTower, getFloorPlanByFloor, getCapturePinsByFloorPlan } from '@store/workflowSelectors';
import { resolveCaptureThumbnailUrl } from '@/utils/captureMedia';
import type { MockCapture } from '@/data/mockData';

const P = {
  border: '#e4e7ec', muted: '#6b7280', subtle: '#9ca3af', strong: '#111827',
  blue: '#2563eb', blueHover: '#1d4ed8', blueSoft: 'rgba(37,99,235,0.08)',
  white: '#ffffff', bg: '#f7f8fa',
};
const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

const fieldSx = {
  width: '100%', px: 1.25, py: 0.875, borderRadius: '10px',
  border: `1.5px solid ${P.border}`, fontSize: '0.9375rem', fontFamily: 'inherit',
  color: P.strong, backgroundColor: P.white, outline: 'none', cursor: 'pointer',
  boxSizing: 'border-box' as const,
};

const fieldSxCompact = {
  ...fieldSx,
  px: 1, py: 0.625, fontSize: '0.875rem',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ flex: 1, minWidth: 140 }}>
      <Typography component="label" sx={{ display: 'block', fontSize: '0.6875rem', fontWeight: 700, color: P.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.5 }}>{label}</Typography>
      {children}
    </Box>
  );
}

export default function PublishToursPage() {
  const theme   = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const user       = useAuthStore(s => s.user);
  const projects   = useWorkflowStore(s => s.projects);
  const towers     = useWorkflowStore(s => s.towers);
  const floors     = useWorkflowStore(s => s.floors);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const allPins    = useWorkflowStore(s => s.capturePins);
  const captures   = useWorkflowStore(s => s.captures);
  const tours      = useWorkflowStore(s => s.tours);
  const publishFloorPlanTour = useWorkflowStore(s => s.publishFloorPlanTour);
  const navigate = useNavigate();

  const [projectId, setProjectId] = useState('');
  const [towerId, setTowerId]     = useState('');
  const [floorId, setFloorId]     = useState('');
  const [toast, setToast]         = useState('');
  const [publishing, setPublishing] = useState(false);
  const [pinPage, setPinPage]       = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const PAGE_SIZE = 5;

  const assignedIds = new Set(user?.assignedProjectIds ?? []);
  const myProjects  = assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived);
  const myTowers = [...towers.filter(t => t.projectId === projectId)].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const myFloors = [...getFloorsByTower(floors, towerId)].sort((a, b) => a.number - b.number);

  const floorPlan = getFloorPlanByFloor(floorPlans, towerId, floorId);
  const pins = floorPlan ? getCapturePinsByFloorPlan(allPins, floorPlan.id) : [];
  const pinsWithCapture = pins.filter(p => p.captureIds.length > 0);
  const readyIds = useMemo(() => pinsWithCapture.map(p => p.id), [pinsWithCapture]);
  const readyKey = readyIds.join('|');
  const floorPlanId = floorPlan?.id ?? '';

  // Default-select every ready pin whenever the floor's ready set changes.
  useEffect(() => {
    setSelectedIds(new Set(readyIds));
    setPinPage(0);
  }, [floorPlanId, readyKey]); // eslint-disable-line react-hooks/exhaustive-deps -- readyIds derived from readyKey

  const selectedReady = useMemo(
    () => pinsWithCapture.filter(p => selectedIds.has(p.id)),
    [pinsWithCapture, selectedIds],
  );
  const selectedCount = selectedReady.length;
  const allReadySelected = readyIds.length > 0 && readyIds.every(id => selectedIds.has(id));
  const someReadySelected = readyIds.some(id => selectedIds.has(id));
  const canPublish = selectedCount > 0 && !publishing;

  const totalPinPages = Math.ceil(pins.length / PAGE_SIZE);
  const visiblePins = useMemo(
    () => pins.slice(pinPage * PAGE_SIZE, (pinPage + 1) * PAGE_SIZE),
    [pins, pinPage],
  );

  function toggleSelectAll() {
    if (allReadySelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(readyIds));
  }

  function togglePin(pinId: string, ready: boolean) {
    if (!ready) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(pinId)) next.delete(pinId);
      else next.add(pinId);
      return next;
    });
  }

  function handlePublish() {
    if (!floorPlan || !canPublish) return;
    setPublishing(true);
    const tourIds = publishFloorPlanTour(floorPlan.id, [...selectedIds]);
    setPublishing(false);
    if (tourIds.length) {
      setToast(`Walkthrough published · ${selectedCount} stop${selectedCount !== 1 ? 's' : ''} in pin order`);
      setTimeout(() => navigate(`/tours/${tourIds[0]}`), 600);
    } else {
      setToast('No selected pins with captures to publish yet');
    }
  }

  function pinThumbUrl(pin: { captureIds: string[] }): string | null {
    const latestId = pin.captureIds[pin.captureIds.length - 1];
    if (!latestId) return null;
    const cap = captures.find(c => c.id === latestId);
    if (!cap) return null;
    return resolveCaptureThumbnailUrl(cap as MockCapture & Record<string, unknown>);
  }

  const SelectAllIcon = allReadySelected
    ? CheckBoxRounded
    : someReadySelected
      ? IndeterminateCheckBoxRounded
      : CheckBoxOutlineBlankRounded;

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: { xs: 3, sm: 6 } }}>

      {/* ── Back link ── */}
      <Box component={Link} to="/dashboard/engineer" sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75,
        mb: { xs: 2, sm: 3 },
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${P.border}`, color: P.muted,
        fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
        transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
      }}>
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
      </Box>

      {/* ── Heading ── */}
      <Box sx={{ mb: { xs: 2, sm: 4 } }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>Publish Tours</Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
          Select pins to include, then publish them as a sequential walkthrough tour.
        </Typography>
      </Box>

      {/* ── Selectors ── */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' },
        gap: { xs: 1, sm: 1.5 },
        mb: { xs: 1.5, sm: 3 },
        p: { xs: 1.5, sm: 2.5 },
        borderRadius: '14px',
        border: `1.5px solid ${P.border}`,
        backgroundColor: P.white,
      }}>
        <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
          <Field label="Project">
            <Box component="select" value={projectId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setProjectId(e.target.value); setTowerId(''); setFloorId(''); setPinPage(0); }}
              sx={isMobile ? fieldSxCompact : fieldSx}>
              <option value="">Select project</option>
              {myProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Box>
          </Field>
        </Box>
        <Field label="Tower">
          <Box component="select" value={towerId} disabled={!projectId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setTowerId(e.target.value); setFloorId(''); setPinPage(0); }}
            sx={isMobile ? { ...fieldSxCompact, opacity: projectId ? 1 : 0.5 } : { ...fieldSx, opacity: projectId ? 1 : 0.5 }}>
            <option value="">Select tower</option>
            {myTowers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Box>
        </Field>
        <Field label="Floor">
          <Box component="select" value={floorId} disabled={!towerId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setFloorId(e.target.value); setPinPage(0); }}
            sx={isMobile ? { ...fieldSxCompact, opacity: towerId ? 1 : 0.5 } : { ...fieldSx, opacity: towerId ? 1 : 0.5 }}>
            <option value="">Select floor</option>
            {myFloors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Box>
        </Field>
      </Box>

      {/* ── Pin sequence / empty states ── */}
      {!floorId ? (
        <Box sx={{ py: { xs: 5, sm: 8 }, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <ViewInArRounded sx={{ fontSize: { xs: 34, sm: 44 }, color: P.subtle, mb: 1 }} />
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>Pick a project, tower and floor above.</Typography>
        </Box>
      ) : !floorPlan ? (
        <Box sx={{ py: { xs: 5, sm: 8 }, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <LayersRounded sx={{ fontSize: { xs: 34, sm: 44 }, color: P.subtle, mb: 1 }} />
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }}>No floor plan for this floor</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted, mt: 0.5 }}>A floor plan with capture pins is required.</Typography>
        </Box>
      ) : pins.length === 0 ? (
        <Box sx={{ py: { xs: 5, sm: 8 }, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <ViewInArRounded sx={{ fontSize: { xs: 34, sm: 44 }, color: P.subtle, mb: 1 }} />
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }}>No capture pins placed yet</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted, mt: 0.5 }}>Place pins and attach captures from Capture Workflow first.</Typography>
        </Box>
      ) : (
        <Box>
          {/* Walkthrough order */}
          <Box sx={{ borderRadius: '14px', border: `1.5px solid ${P.border}`, backgroundColor: P.white, overflow: 'hidden', mb: 2 }}>
            {/* Header row with Select all */}
            <Box sx={{ px: { xs: 1.75, sm: 2.5 }, py: { xs: 1.25, sm: 1.75 }, borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}>
              <Box
                onClick={readyIds.length ? toggleSelectAll : undefined}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1,
                  cursor: readyIds.length ? 'pointer' : 'default',
                  userSelect: 'none',
                  minWidth: 0,
                }}
              >
                <SelectAllIcon sx={{
                  fontSize: 22,
                  color: allReadySelected || someReadySelected ? P.blue : P.subtle,
                  flexShrink: 0,
                }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong, lineHeight: 1.2 }}>
                    Walkthrough order
                  </Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: P.muted, fontWeight: 600 }}>
                    {readyIds.length ? (allReadySelected ? 'Deselect all' : 'Select all ready') : 'No ready pins'}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
                <Typography sx={{ fontSize: '0.75rem', color: selectedCount > 0 ? '#16a34a' : P.muted, fontWeight: 600 }}>
                  {selectedCount} of {pinsWithCapture.length} selected
                </Typography>
                {selectedCount > 0 && selectedCount === pinsWithCapture.length && (
                  <CheckCircleRounded sx={{ fontSize: 14, color: '#16a34a' }} />
                )}
              </Box>
            </Box>

            {/* Pin list — paginated */}
            <Box>
              {visiblePins.map((pin, i) => {
                const ready = pin.captureIds.length > 0;
                const selected = selectedIds.has(pin.id);
                const latestCaptureId = pin.captureIds[pin.captureIds.length - 1];
                const thumbUrl = pinThumbUrl(pin);
                const isLast = i === visiblePins.length - 1 && totalPinPages <= 1;
                return (
                  <Box
                    key={pin.id}
                    onClick={() => togglePin(pin.id, ready)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: { xs: 1.25, sm: 1.5 },
                      px: { xs: 1.75, sm: 2.5 }, py: { xs: 1, sm: 1.25 },
                      borderBottom: isLast ? 'none' : `1px solid ${P.border}`,
                      cursor: ready ? 'pointer' : 'default',
                      opacity: ready ? 1 : 0.55,
                      backgroundColor: selected ? 'rgba(37,99,235,0.04)' : 'transparent',
                      transition: T, '&:hover': ready ? { backgroundColor: selected ? 'rgba(37,99,235,0.07)' : P.bg } : {},
                    }}
                  >
                    {ready
                      ? (selected
                        ? <CheckBoxRounded sx={{ fontSize: 22, color: P.blue, flexShrink: 0 }} />
                        : <CheckBoxOutlineBlankRounded sx={{ fontSize: 22, color: P.subtle, flexShrink: 0 }} />)
                      : <RadioButtonUncheckedRounded sx={{ fontSize: 22, color: P.subtle, flexShrink: 0 }} />}

                    {/* Thumbnail (or dashed placeholder) */}
                    <Box
                      onClick={(e) => {
                        if (!latestCaptureId) return;
                        e.stopPropagation();
                        navigate(`/captures/${latestCaptureId}`);
                      }}
                      sx={{
                        width: { xs: 40, sm: 44 }, height: { xs: 40, sm: 44 },
                        borderRadius: '10px', overflow: 'hidden', flexShrink: 0,
                        border: `1.5px solid ${ready ? P.border : P.subtle}`,
                        backgroundColor: P.bg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: latestCaptureId ? 'pointer' : 'default',
                      }}
                    >
                      {thumbUrl ? (
                        <Box
                          component="img"
                          src={thumbUrl}
                          alt=""
                          loading="lazy"
                          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: P.subtle }}>
                          {pin.sequenceNumber}
                        </Typography>
                      )}
                    </Box>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: { xs: '0.8125rem', sm: '0.875rem' }, fontWeight: 600, color: P.strong, lineHeight: 1.3 }}>
                        Pin {pin.sequenceNumber}
                      </Typography>
                      <Typography sx={{ fontSize: '0.6875rem', color: ready ? P.muted : P.subtle, lineHeight: 1.3 }}>
                        {ready ? `${pin.captureIds.length} capture${pin.captureIds.length !== 1 ? 's' : ''}` : 'No capture yet'}
                      </Typography>
                    </Box>

                    {ready
                      ? <CheckCircleRounded sx={{ fontSize: { xs: 16, sm: 18 }, color: '#16a34a', flexShrink: 0 }} />
                      : <RadioButtonUncheckedRounded sx={{ fontSize: { xs: 16, sm: 18 }, color: P.subtle, flexShrink: 0 }} />}
                  </Box>
                );
              })}
            </Box>

            {/* Pagination footer */}
            {totalPinPages > 1 && (
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                px: { xs: 1.75, sm: 2.5 }, py: { xs: 0.875, sm: 1.125 },
                borderTop: `1px solid ${P.border}`,
              }}>
                <Box
                  onClick={() => setPinPage(p => Math.max(0, p - 1))}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5,
                    px: 1, py: 0.5, borderRadius: '8px', cursor: pinPage === 0 ? 'default' : 'pointer',
                    border: `1.5px solid ${P.border}`,
                    color: pinPage === 0 ? P.subtle : P.strong,
                    opacity: pinPage === 0 ? 0.4 : 1,
                    transition: T, userSelect: 'none',
                    '&:hover': pinPage > 0 ? { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } : {},
                  }}
                >
                  <ChevronLeftRounded sx={{ fontSize: 16 }} />
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>Prev</Typography>
                </Box>

                <Typography sx={{ fontSize: '0.75rem', color: P.muted, fontWeight: 500 }}>
                  Pins {pinPage * PAGE_SIZE + 1}–{Math.min((pinPage + 1) * PAGE_SIZE, pins.length)} of {pins.length}
                </Typography>

                <Box
                  onClick={() => setPinPage(p => Math.min(totalPinPages - 1, p + 1))}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5,
                    px: 1, py: 0.5, borderRadius: '8px',
                    cursor: pinPage === totalPinPages - 1 ? 'default' : 'pointer',
                    border: `1.5px solid ${P.border}`,
                    color: pinPage === totalPinPages - 1 ? P.subtle : P.strong,
                    opacity: pinPage === totalPinPages - 1 ? 0.4 : 1,
                    transition: T, userSelect: 'none',
                    '&:hover': pinPage < totalPinPages - 1 ? { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } : {},
                  }}
                >
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>Next</Typography>
                  <ChevronRightRounded sx={{ fontSize: 16 }} />
                </Box>
              </Box>
            )}
          </Box>

          {/* Publish button */}
          <Box
            onClick={handlePublish}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
              py: { xs: 1.25, sm: 1.375 }, borderRadius: '12px',
              background: canPublish ? `linear-gradient(135deg, #16a34a 0%, #15803d 100%)` : P.bg,
              color: canPublish ? '#fff' : P.subtle,
              fontSize: { xs: '0.875rem', sm: '0.9375rem' }, fontWeight: 700,
              cursor: canPublish ? 'pointer' : 'not-allowed',
              boxShadow: canPublish ? '0 4px 14px rgba(22,163,74,0.3)' : 'none',
              transition: T, '&:hover': canPublish ? { filter: 'brightness(1.05)' } : {},
            }}
          >
            <PublishRounded sx={{ fontSize: 17 }} />
            {publishing
              ? 'Publishing…'
              : selectedCount > 0
                ? `Generate & Publish Tour (${selectedCount} pin${selectedCount !== 1 ? 's' : ''})`
                : 'Select pins to publish'}
          </Box>
          <Typography sx={{ mt: 1, fontSize: '0.75rem', color: P.subtle, textAlign: 'center' }}>
            {selectedCount > 0
              ? `Tour follows selected pin order (${selectedReady.map(p => p.sequenceNumber).join(' → ')}).`
              : 'Pins without captures cannot be selected. Choose at least one ready pin.'}
          </Typography>

          {/* Already published tours for this floor */}
          {(() => {
            const floorTours = tours.filter(t =>
              pins.some(p => p.captureIds.includes(t.captureId)) && t.status === 'published'
            );
            if (!floorTours.length) return null;
            return (
              <Box sx={{ mt: 2.5 }}>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.strong, mb: 1 }}>Published tours for this floor</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {floorTours.map(t => (
                    <Box key={t.id} component={Link} to={`/tours/${t.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, borderRadius: '10px', border: `1px solid ${P.border}`, textDecoration: 'none', transition: T, '&:hover': { borderColor: P.blue, backgroundColor: P.blueSoft } }}>
                      <ViewInArRounded sx={{ fontSize: 16, color: '#7c3aed', flexShrink: 0 }} />
                      <Typography sx={{ flex: 1, fontSize: '0.8125rem', fontWeight: 600, color: P.strong }}>{t.roomName}</Typography>
                      <Box sx={{ px: 1, py: 0.25, borderRadius: '5px', backgroundColor: 'rgba(37,99,235,0.08)', color: P.blue, fontSize: '0.6875rem', fontWeight: 700 }}>Live</Box>
                      <ArrowForwardRounded sx={{ fontSize: 14, color: P.subtle }} />
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })()}
        </Box>
      )}

      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setToast('')} sx={{ borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.16)', fontWeight: 600 }}>
          {toast}
        </Alert>
      </Snackbar>
    </Box>
  );
}
