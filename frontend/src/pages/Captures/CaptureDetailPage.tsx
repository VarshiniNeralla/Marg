import React, { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import {
  ArrowBackRounded, CameraAltRounded, LayersRounded, EventRounded, AccessTimeRounded,
} from '@mui/icons-material';
import { getCaptureById, getPinForCapture, getPinCaptureTimeline } from '@store/workflowSelectors';
import type { MockCapture } from '@/data/mockData';
import { useWorkflowStore } from '@store/workflowStore';

const P = {
  border: '#e4e7ec', muted: '#6b7280', subtle: '#9ca3af', strong: '#111827',
  blue: '#2563eb', blueSoft: 'rgba(37,99,235,0.08)', white: '#ffffff', bg: '#f7f8fa',
};
const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;

/** Real image URL for a capture, if one was uploaded. */
function captureImageUrl(c: MockCapture | undefined): string | null {
  if (!c) return null;
  const r = c as MockCapture & Record<string, unknown>;
  return (
    (r.processedPanoramaUrl as string | undefined) ??
    (r.original_url as string | undefined) ??
    (r.originalFileUrl as string | undefined) ??
    (r.thumbnailUrl as string | undefined) ??
    (r.thumbnail_url as string | undefined) ??
    null
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
  const captures = useWorkflowStore(s => s.captures);
  const pins = useWorkflowStore(s => s.capturePins);

  const capture = getCaptureById(captures, captureId ?? '');

  // Real timeline: every capture attached to this pin, oldest → newest.
  const timeline = useMemo(
    () => getPinCaptureTimeline(pins, captures, captureId ?? ''),
    [pins, captures, captureId],
  );
  const pin = useMemo(() => getPinForCapture(pins, captureId ?? ''), [pins, captureId]);

  // Which capture in the timeline is being previewed (default: the one in the URL).
  const [activeId, setActiveId] = useState<string | null>(captureId ?? null);
  const active = (timeline.find(c => c.id === activeId) ?? capture) as MockCapture | undefined;

  const navigate = useNavigate();

  if (!capture || !active) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 2 }}>
      <Typography sx={{ fontSize: '2rem', fontWeight: 700, color: P.border }}>404</Typography>
      <Typography sx={{ color: P.muted }}>Capture not found</Typography>
      <Box onClick={() => navigate(-1)} sx={{ cursor: 'pointer', color: P.blue, textDecoration: 'none', fontSize: '0.875rem' }}>← Back</Box>
    </Box>
  );

  const title = pin ? `Pin ${pin.sequenceNumber}` : active.roomName;
  const imageUrl = captureImageUrl(active);
  const activeWhen = fmtDateTime(active);

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>
      {/* Back */}
      <Box onClick={() => navigate(-1)} sx={{
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
        px: 1.25, py: 0.625, borderRadius: '8px',
        border: `1.5px solid ${P.border}`, color: P.muted,
        fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
        transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
      }}>
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Back
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
            <LayersRounded sx={{ fontSize: 15 }} /> {active.towerName} · {active.floorLabel}
          </Box>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <EventRounded sx={{ fontSize: 15 }} /> {activeWhen.date}
          </Box>
          {activeWhen.time && (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeRounded sx={{ fontSize: 15 }} /> {activeWhen.time}
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
                {isActive && <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: P.blue, flexShrink: 0 }} />}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
