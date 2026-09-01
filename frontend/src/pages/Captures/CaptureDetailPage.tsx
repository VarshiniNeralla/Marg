import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import {
  ArrowBackRounded, CameraAltRounded, LayersRounded, EventRounded, AccessTimeRounded,
  DeleteOutlineRounded, MapRounded,
} from '@mui/icons-material';
import { getCaptureById, getPinForCapture, getPinCaptureTimeline } from '@store/workflowSelectors';
import type { MockCapture } from '@/data/mockData';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, isFieldEngineer } from '@store/authStore';
import { filterOwnCaptures } from '@/utils/captureOwnership';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { formatPinLocationLabel, formatTowerLabel } from '@/utils/pinLabels';
import { resolveMediaUrl } from '@/config/env';

const P = {
  border: '#e4e7ec', muted: '#6b7280', subtle: '#9ca3af', strong: '#111827',
  blue: '#2563eb', blueSoft: 'rgba(37,99,235,0.08)', white: '#ffffff', bg: '#f7f8fa',
};
const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

/** Real image URL for a capture, if one was uploaded. */
function captureImageUrl(c: MockCapture | undefined): string | null {
  if (!c) return null;
  const r = c as MockCapture & Record<string, unknown>;
  return resolveMediaUrl(
    (r.processedPanoramaUrl as string | undefined) ??
    (r.original_url as string | undefined) ??
    (r.originalFileUrl as string | undefined) ??
    (r.thumbnailUrl as string | undefined) ??
    (r.thumbnail_url as string | undefined) ??
    null,
  );
}

/** Format an ISO timestamp into a date + time label; falls back to uploadedAt. */
function fmtDateTime(c: MockCapture): { date: string; time: string } {
  const iso = (c as MockCapture & { capturedAt?: string }).capturedAt;
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      return {
        date: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        time: d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }),
      };
    }
  }
  return { date: c.uploadedAt, time: '' };
}

export default function CaptureDetailPage() {
  const { captureId } = useParams<{ captureId: string }>();
  const capturesAll = useWorkflowStore(s => s.captures);
  const pins = useWorkflowStore(s => s.capturePins);
  const user = useAuthStore(s => s.user);
  const captures = isFieldEngineer(user) ? filterOwnCaptures(capturesAll, user) : capturesAll;
  const deleteCapture = useWorkflowStore(s => s.deleteCapture);
  const [deleteTarget, setDeleteTarget] = useState<MockCapture | null>(null);

  const navigate = useNavigate();
  // Which capture in the timeline is being previewed (default: the one in the URL).
  const [activeId, setActiveId] = useState<string | null>(captureId ?? null);

  useEffect(() => {
    if (captureId) setActiveId(captureId);
  }, [captureId]);

  const capture = getCaptureById(captures, captureId ?? '');

  // Real timeline: every capture attached to this pin, oldest → newest.
  // Fall back to activeId so deleting the URL visit does not flash a 404
  // before navigate() lands on the next remaining visit.
  const timeline = useMemo(() => {
    const byUrl = getPinCaptureTimeline(pins, captures, captureId ?? '');
    if (byUrl.length) return byUrl;
    if (activeId) return getPinCaptureTimeline(pins, captures, activeId);
    return [];
  }, [pins, captures, captureId, activeId]);

  const pin = useMemo(() => {
    return getPinForCapture(pins, captureId ?? '')
      ?? (activeId ? getPinForCapture(pins, activeId) : undefined)
      ?? (timeline[0] ? getPinForCapture(pins, timeline[0].id) : undefined);
  }, [pins, captureId, activeId, timeline]);

  const active = (
    timeline.find(c => c.id === activeId)
    ?? timeline.find(c => c.id === captureId)
    ?? timeline[timeline.length - 1]
    ?? capture
  ) as MockCapture | undefined;

  const confirmDelete = (target: MockCapture) => {
    const remaining = timeline.filter(c => c.id !== target.id);
    if (remaining.length > 0) {
      const next = remaining[remaining.length - 1];
      setActiveId(next.id);
      // Route first so the page stays on a live visit after the store update.
      navigate(`/captures/${next.id}`, { replace: true });
      deleteCapture(target.id);
    } else {
      deleteCapture(target.id);
      navigate(-1);
    }
    setDeleteTarget(null);
  };

  if (!active) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2 }}>
      <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: P.border }}>404</Typography>
      <Typography sx={{ color: P.muted }}>Capture not found</Typography>
      <Box onClick={() => navigate(-1)} sx={{ cursor: 'pointer', color: P.blue, textDecoration: 'none', fontSize: '0.875rem' }}>← Back</Box>
    </Box>
  );

  const title = formatPinLocationLabel(pin, active.roomName);
  const imageUrl = captureImageUrl(active);
  const activeWhen = fmtDateTime(active);
  const isOnlyVisit = timeline.length <= 1;
  const deleteDescription = deleteTarget
    ? (timeline.filter(c => c.id !== deleteTarget.id).length === 0
      ? 'This is the only visit on this pin. Deleting it will also remove the pin from the floor plan. This cannot be undone.'
      : 'This visit will be removed. Other visits on this pin will stay. This cannot be undone.')
    : '';

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>
      {/* Back + Delete */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
      <Box onClick={() => navigate(-1)} sx={{
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 0.75,
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${P.border}`, color: P.muted,
        fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
        transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
      }}>
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Back
      </Box>
      <Box onClick={() => setDeleteTarget(active)} sx={{
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 0.75,
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${P.border}`, color: P.muted,
        fontSize: '0.8125rem', fontWeight: 600,
        transition: T, '&:hover': { borderColor: '#ef4444', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)' },
      }}>
        <DeleteOutlineRounded sx={{ fontSize: 15 }} /> Delete Capture
      </Box>
      </Box>

      {/* Heading */}
      <Box sx={{ mb: 3 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>{title}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', color: P.muted, fontSize: '0.875rem' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <LayersRounded sx={{ fontSize: 15 }} /> {formatTowerLabel(active.towerName)} · {active.floorLabel}
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <EventRounded sx={{ fontSize: 15 }} /> {activeWhen.date}
          </Box>
          {activeWhen.time && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeRounded sx={{ fontSize: 15 }} /> {activeWhen.time}
            </Box>
          )}
          {pin?.projectId && pin?.towerId && pin?.floorId && (
            <Box
              component={Link}
              to={`/floor-plans/${pin.projectId}/${pin.towerId}/${pin.floorId}?pinsOnly=1&returnTo=${encodeURIComponent(`/captures/${active.id}`)}`}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1, py: 0.375, borderRadius: '7px',
                border: `1.5px solid ${P.border}`, color: P.muted,
                fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none',
                transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
              }}
            >
              <MapRounded sx={{ fontSize: 14 }} /> View on Floor Plan
            </Box>
          )}
        </Box>
      </Box>

      {/* Capture preview */}
      <Box sx={{ position: 'relative', borderRadius: '18px', overflow: 'hidden', aspectRatio: '16 / 10', background: active.gradient, boxShadow: '0 8px 32px rgba(15,23,42,0.12)', mb: 2.5 }}>
        {imageUrl ? (
          <Box component="img" src={imageUrl} alt={title} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
            <CameraAltRounded sx={{ fontSize: 36, color: 'rgba(255,255,255,0.3)' }} />
            <Typography sx={{ fontSize: '0.8125rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>360° panorama preview</Typography>
          </Box>
        )}
        {/* Date badge on the image */}
        <Box sx={{ position: 'absolute', top: 12, left: 12, px: 1.25, py: 0.625, borderRadius: '8px', backgroundColor: 'rgba(17,24,39,0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <EventRounded sx={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }} />
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>
            {activeWhen.date}{activeWhen.time ? ` · ${activeWhen.time}` : ''}
          </Typography>
        </Box>
        <Box sx={{ position: 'absolute', bottom: 12, right: 12, px: 1, py: 0.5, borderRadius: '7px', backgroundColor: 'rgba(17,24,39,0.65)', backdropFilter: 'blur(8px)' }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: '#fff' }}>{active.fileCount} file{active.fileCount !== 1 ? 's' : ''}</Typography>
        </Box>
      </Box>

      {/* Timeline — real captures attached to this pin over time */}
      <Box sx={{ borderRadius: '16px', border: `1.5px solid ${P.border}`, backgroundColor: P.white, overflow: 'hidden' }}>
        <Box sx={{ px: 2.5, py: 1.75, borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong }}>Capture Timeline</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
            {timeline.length} capture{timeline.length !== 1 ? 's' : ''} over time
          </Typography>
        </Box>
        <Box>
          {timeline.map((c, i) => {
            const when = fmtDateTime(c);
            const isActive = c.id === active.id;
            const isLatest = i === timeline.length - 1;
            return (
              <Box
                key={c.id}
                onClick={() => setActiveId(c.id)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.5, cursor: 'pointer', borderBottom: i < timeline.length - 1 ? `1px solid ${P.border}` : 'none', backgroundColor: isActive ? P.blueSoft : 'transparent', transition: T, '&:hover': { backgroundColor: isActive ? P.blueSoft : P.bg } }}
              >
                <Box sx={{ width: 36, height: 36, borderRadius: '10px', background: c.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: isActive ? `2px solid ${P.blue}` : 'none' }}>
                  <CameraAltRounded sx={{ fontSize: 16, color: 'rgba(255,255,255,0.85)' }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: P.strong }}>
                      {when.date}{when.time ? ` · ${when.time}` : ''}
                    </Typography>
                    {isLatest && (
                      <Box sx={{ px: 0.75, py: 0.125, borderRadius: '5px', backgroundColor: 'rgba(22,163,74,0.12)', color: '#16a34a', fontSize: '0.625rem', fontWeight: 700 }}>Latest</Box>
                    )}
                  </Box>
                  <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
                    Visit {i + 1} · {c.fileCount} file{c.fileCount !== 1 ? 's' : ''}
                  </Typography>
                </Box>
                {/* Per-visit delete — older visits included, not only the top button / latest */}
                {!isOnlyVisit && (
                  <Box
                    component="button"
                    type="button"
                    aria-label={`Delete visit ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(c);
                    }}
                    sx={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 32, borderRadius: '8px', flexShrink: 0,
                      border: `1.5px solid ${P.border}`, backgroundColor: P.white,
                      color: P.muted, cursor: 'pointer', p: 0, fontFamily: 'inherit',
                      transition: T,
                      '&:hover': { borderColor: '#ef4444', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)' },
                    }}
                  >
                    <DeleteOutlineRounded sx={{ fontSize: 16 }} />
                  </Box>
                )}
                {isActive && isOnlyVisit && <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: P.blue, flexShrink: 0 }} />}
              </Box>
            );
          })}
        </Box>
      </Box>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this capture?"
        description={deleteDescription}
        confirmLabel="Delete capture"
        destructive
        onConfirm={() => {
          if (deleteTarget) confirmDelete(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
