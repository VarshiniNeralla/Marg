import React, { useState } from 'react';
import { Box, Typography, Snackbar, Alert } from '@mui/material';
import {
  ArrowBackRounded, ArrowForwardRounded, ViewInArRounded, PublishRounded,
  CheckCircleRounded, RadioButtonUncheckedRounded, LayersRounded,
} from '@mui/icons-material';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { getFloorsByTower, getFloorPlanByFloor, getCapturePinsByFloorPlan } from '@store/workflowSelectors';

const P = {
  border: '#e4e7ec', muted: '#6b7280', subtle: '#9ca3af', strong: '#111827',
  blue: '#2563eb', blueHover: '#1d4ed8', blueSoft: 'rgba(37,99,235,0.08)',
  white: '#ffffff', bg: '#f7f8fa',
};
const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

const fieldSx = {
  width: '100%', px: 1.75, py: 1.125, borderRadius: '10px',
  border: `1.5px solid ${P.border}`, fontSize: '0.9375rem', fontFamily: 'inherit',
  color: P.strong, backgroundColor: P.white, outline: 'none', cursor: 'pointer',
  boxSizing: 'border-box' as const,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ flex: 1, minWidth: 180 }}>
      <Typography component="label" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: P.subtle, textTransform: 'uppercase', letterSpacing: '0.06em', mb: 0.75 }}>{label}</Typography>
      {children}
    </Box>
  );
}

export default function PublishToursPage() {
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

  const assignedIds = new Set(user?.assignedProjectIds ?? []);
  const myProjects  = assignedIds.size
    ? projects.filter(p => assignedIds.has(p.id) && !p.archived)
    : projects.filter(p => !p.archived);
  const myTowers = [...towers.filter(t => t.projectId === projectId)].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const myFloors = [...getFloorsByTower(floors, towerId)].sort((a, b) => a.number - b.number);

  const floorPlan = getFloorPlanByFloor(floorPlans, towerId, floorId);
  const pins = floorPlan ? getCapturePinsByFloorPlan(allPins, floorPlan.id) : [];
  const pinsWithCapture = pins.filter(p => p.captureIds.length > 0);
  const canPublish = pinsWithCapture.length > 0 && !publishing;

  function handlePublish() {
    if (!floorPlan || !canPublish) return;
    setPublishing(true);
    const tourIds = publishFloorPlanTour(floorPlan.id);
    setPublishing(false);
    if (tourIds.length) {
      setToast(`Walkthrough published · ${pinsWithCapture.length} stops in pin order`);
      // Open the published walkthrough so they can immediately step through it.
      setTimeout(() => navigate(`/tours/${tourIds[0]}`), 600);
    } else {
      setToast('No pins with captures to publish yet');
    }
  }

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

      {/* Heading */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>Publish Tours</Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
          Select a floor and publish its captures as a sequential walkthrough tour.
        </Typography>
      </Box>

      {/* Selectors */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3, p: 2.5, borderRadius: '16px', border: `1.5px solid ${P.border}`, backgroundColor: P.white }}>
        <Field label="Project">
          <Box component="select" value={projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setProjectId(e.target.value); setTowerId(''); setFloorId(''); }} sx={fieldSx}>
            <option value="">Select project</option>
            {myProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Box>
        </Field>
        <Field label="Tower">
          <Box component="select" value={towerId} disabled={!projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setTowerId(e.target.value); setFloorId(''); }} sx={{ ...fieldSx, opacity: projectId ? 1 : 0.5 }}>
            <option value="">Select tower</option>
            {myTowers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Box>
        </Field>
        <Field label="Floor">
          <Box component="select" value={floorId} disabled={!towerId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFloorId(e.target.value)} sx={{ ...fieldSx, opacity: towerId ? 1 : 0.5 }}>
            <option value="">Select floor</option>
            {myFloors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Box>
        </Field>
      </Box>

      {/* Pin sequence preview */}
      {!floorId ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <ViewInArRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          {/* <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong }}>Select a tower and floor to begin</Typography> */}
          <Typography sx={{ fontSize: '0.875rem', color: P.muted, mt: 0.5 }}>Pick a project, tower and floor above.</Typography>
        </Box>
      ) : !floorPlan ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <LayersRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong }}>No floor plan for this floor</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted, mt: 0.5 }}>A floor plan with capture pins is required to publish a tour.</Typography>
        </Box>
      ) : pins.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <ViewInArRounded sx={{ fontSize: 44, color: P.subtle, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong }}>No capture pins placed yet</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted, mt: 0.5 }}>Place pins and attach captures from the Capture Workflow first.</Typography>
        </Box>
      ) : (
        <Box>
          {/* Walkthrough order */}
          <Box sx={{ borderRadius: '16px', border: `1.5px solid ${P.border}`, backgroundColor: P.white, overflow: 'hidden', mb: 2.5 }}>
            <Box sx={{ px: 2.5, py: 1.75, borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong }}>Walkthrough order</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>{pinsWithCapture.length} of {pins.length} pins ready</Typography>
            </Box>
            <Box>
              {pins.map((pin, i) => {
                const ready = pin.captureIds.length > 0;
                const latestCaptureId = pin.captureIds[pin.captureIds.length - 1];
                return (
                  <Box
                    key={pin.id}
                    onClick={() => latestCaptureId && navigate(`/captures/${latestCaptureId}`)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.5, borderBottom: i < pins.length - 1 ? `1px solid ${P.border}` : 'none', cursor: latestCaptureId ? 'pointer' : 'default', transition: T, '&:hover': latestCaptureId ? { backgroundColor: P.bg } : {} }}
                  >
                    <Box sx={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: ready ? '#16a34a' : 'transparent', border: `2px ${ready ? 'solid' : 'dashed'} ${ready ? '#15803d' : P.subtle}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 800, color: ready ? '#fff' : P.subtle }}>{pin.sequenceNumber}</Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: P.strong }}>Pin {pin.sequenceNumber}</Typography>
                      <Typography sx={{ fontSize: '0.75rem', color: ready ? P.muted : P.subtle }}>
                        {ready ? `${pin.captureIds.length} capture${pin.captureIds.length !== 1 ? 's' : ''}` : 'Waiting for capture'}
                      </Typography>
                    </Box>
                    {ready
                      ? <CheckCircleRounded sx={{ fontSize: 18, color: '#16a34a', flexShrink: 0 }} />
                      : <RadioButtonUncheckedRounded sx={{ fontSize: 18, color: P.subtle, flexShrink: 0 }} />}
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Publish button */}
          <Box
            onClick={handlePublish}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 1.375, borderRadius: '12px',
              background: canPublish ? `linear-gradient(135deg, #16a34a 0%, #15803d 100%)` : P.bg,
              color: canPublish ? '#fff' : P.subtle,
              fontSize: '0.9375rem', fontWeight: 700, cursor: canPublish ? 'pointer' : 'not-allowed',
              boxShadow: canPublish ? '0 4px 14px rgba(22,163,74,0.3)' : 'none', transition: T,
              '&:hover': canPublish ? { filter: 'brightness(1.05)' } : {} }}
          >
            <PublishRounded sx={{ fontSize: 18 }} />
            {publishing ? 'Publishing…' : `Generate & Publish Tour (${pinsWithCapture.length} ${pinsWithCapture.length === 1 ? 'pin' : 'pins'})`}
          </Box>
          {pinsWithCapture.length < pins.length && (
            <Typography sx={{ mt: 1.25, fontSize: '0.75rem', color: P.subtle, textAlign: 'center' }}>
              Pins still waiting for a capture are skipped. The tour follows pin order 1 → {pins.length}.
            </Typography>
          )}

          {/* Already published tours for this floor */}
          {(() => {
            const floorTours = tours.filter(t =>
              pins.some(p => p.captureIds.includes(t.captureId)) && t.status === 'published'
            );
            if (!floorTours.length) return null;
            return (
              <Box sx={{ mt: 3 }}>
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
