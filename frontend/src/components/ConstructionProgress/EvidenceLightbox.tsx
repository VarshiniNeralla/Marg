import React, { useEffect, useMemo, useState } from 'react';
import { Box, Modal, Typography, CircularProgress, IconButton } from '@mui/material';
import { CloseRounded, ImageNotSupportedRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import apiClient from '@/services/apiClient';
import type { ApiResponse } from '@/types/dto';
import { useWorkflowStore } from '@/store/workflowStore';
import { getPinForCapture } from '@/store/workflowSelectors';
import { formatPinLocationLabel } from '@/utils/pinLabels';
import { resolveMediaUrl } from '@/config/env';
import { formatDateTime } from '@/utils/dateFormat';
import type { EvidenceDetail } from '@/services/constructionProgressService';

/**
 * GET /captures/{id} returns the raw stored capture document (camelCase
 * fields like processedPanoramaUrl/original_url/roomName) — NOT the
 * CaptureResponse DTO shape (secure_urls/room_name) that captureService.ts's
 * getCapture() assumes. That mismatch is why evidence images showed as
 * broken placeholders: secure_urls is simply never present on this
 * endpoint's actual response. Fetch and read the real fields directly
 * instead of going through the mistyped wrapper.
 */
interface RawCapture {
  id: string;
  roomName?: string;
  processedPanoramaUrl?: string | null;
  original_url?: string | null;
  originalFileUrl?: string | null;
  thumbnailUrl?: string | null;
  capturedAt?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
}

function captureUrl(cap: RawCapture): string | undefined {
  const raw = cap.processedPanoramaUrl || cap.original_url || cap.originalFileUrl || cap.thumbnailUrl || undefined;
  return resolveMediaUrl(raw) ?? undefined;
}

function pinLabelFor(pins: ReturnType<typeof useWorkflowStore.getState>['capturePins'], captureId: string, fallback?: string): string {
  const pin = getPinForCapture(pins, captureId);
  return formatPinLocationLabel(pin, fallback || 'Capture');
}

function FullSizeViewer({ capture, onClose }: { capture: RawCapture; onClose: () => void }) {
  const url = captureUrl(capture);
  const pins = useWorkflowStore(s => s.capturePins);
  const label = pinLabelFor(pins, capture.id, capture.roomName);
  const [failed, setFailed] = useState(false);
  return (
    <Modal open onClose={onClose} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box sx={{ position: 'relative', width: '100%', maxWidth: '96vw', maxHeight: '92vh', outline: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', top: -44, right: 0, color: '#fff', backgroundColor: 'rgba(0,0,0,0.4)', '&:hover': { backgroundColor: 'rgba(0,0,0,0.6)' } }}
        >
          <CloseRounded sx={{ fontSize: 20 }} />
        </IconButton>
        {url && !failed ? (
          <Box
            component="img"
            src={url}
            alt={label}
            onError={() => setFailed(true)}
            sx={{ maxWidth: '100%', maxHeight: '88vh', objectFit: 'contain', borderRadius: '8px', display: 'block' }}
          />
        ) : (
          <Box sx={{ width: '60vw', maxWidth: 480, aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDeep, borderRadius: '8px' }}>
            <ImageNotSupportedRounded sx={{ fontSize: 32, color: colors.textSubdued }} />
          </Box>
        )}
        <Typography sx={{ mt: 1.5, fontSize: '0.875rem', fontWeight: 600, color: '#fff' }}>
          {label}
        </Typography>
      </Box>
    </Modal>
  );
}

function captureDate(cap: RawCapture): string | null {
  return cap.capturedAt || cap.createdAt || cap.created_at || null;
}

const ROLE_LABEL: Record<EvidenceDetail['role'], string> = {
  direct: 'Direct evidence',
  inferred: 'Inferred evidence',
};

function Thumb({ cap, url, label, detail, onOpen }: {
  cap: RawCapture; url: string | undefined; label: string; detail?: EvidenceDetail; onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const date = formatDateTime(detail?.capturedAt || captureDate(cap));
  const clickable = !!url && !failed;
  return (
    <Box
      onClick={() => clickable && onOpen()}
      sx={{
        borderRadius: '10px', overflow: 'hidden', border: `1px solid ${colors.borderLight}`,
        cursor: clickable ? 'pointer' : 'default', transition: 'box-shadow 150ms, transform 150ms',
        ...(clickable && { '&:hover': { boxShadow: '0 6px 18px rgba(15,23,42,0.14)', transform: 'translateY(-1px)' } }),
      }}
    >
      {url && !failed ? (
        <Box component="img" src={url} alt={label} onError={() => setFailed(true)} sx={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
      ) : (
        <Box sx={{ width: '100%', aspectRatio: '16/9', display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDeep }}>
          <ImageNotSupportedRounded sx={{ fontSize: 24, color: colors.textSubdued }} />
          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>
            {failed ? 'Image could not be loaded' : 'No image available'}
          </Typography>
        </Box>
      )}
      <Box sx={{ p: 1 }}>
        {detail && (
          <Box
            component="span"
            sx={{
              display: 'inline-block', px: 0.75, py: 0.125, mb: 0.5, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700,
              color: detail.role === 'direct' ? colors.success : colors.info,
              backgroundColor: detail.role === 'direct' ? colors.successBg : colors.infoBg,
            }}
          >
            {ROLE_LABEL[detail.role] ?? 'Evidence'}
          </Box>
        )}
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textStrong }} noWrap>
          {detail && (detail.flatName || detail.roomName)
            ? [detail.flatName, detail.roomName].filter(Boolean).join(' · ')
            : label}
        </Typography>
        <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>{date}</Typography>
        {detail && detail.views.length > 0 && (
          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>
            Seen in: {detail.views.join(', ')}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export default function EvidenceLightbox({
  activityName,
  captureIds,
  details,
  onClose,
}: {
  activityName: string;
  captureIds: string[];
  /** Optional rich evidence rows (role, flat/room, views, date). */
  details?: EvidenceDetail[];
  onClose: () => void;
}) {
  const detailById = useMemo(() => new Map((details ?? []).map(d => [d.captureId, d])), [details]);
  const ids = useMemo(
    () => (captureIds.length > 0 ? captureIds : (details ?? []).map(d => d.captureId)),
    [captureIds, details],
  );
  const [loading, setLoading] = useState(true);
  const [captures, setCaptures] = useState<RawCapture[]>([]);
  const [fullSize, setFullSize] = useState<RawCapture | null>(null);
  const pins = useWorkflowStore(s => s.capturePins);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      ids.map(id =>
        apiClient.get<ApiResponse<RawCapture>>(`/captures/${id}`)
          .then(res => res.data.data ?? null)
          .catch(() => null),
      ),
    )
      .then(results => {
        if (cancelled) return;
        setCaptures(results.filter((c): c is RawCapture => !!c));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ids]);

  return (
    <>
    <Modal open onClose={onClose} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box
        sx={{
          width: '100%', maxWidth: 720, maxHeight: '85vh', overflow: 'auto',
          backgroundColor: '#fff', borderRadius: '16px', p: 3, outline: 'none',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography sx={{ fontSize: '1.0625rem', fontWeight: 700, color: colors.textStrong }}>
            Evidence — {activityName}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseRounded sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={24} sx={{ color: colors.primary }} />
          </Box>
        ) : captures.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, color: colors.textMuted }}>
            <ImageNotSupportedRounded sx={{ fontSize: 32, mb: 1 }} />
            <Typography sx={{ fontSize: '0.875rem' }}>These evidence captures are no longer available.</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1.5 }}>
            {captures.map(cap => (
              <Thumb
                key={cap.id}
                cap={cap}
                url={captureUrl(cap)}
                label={pinLabelFor(pins, cap.id, cap.roomName)}
                detail={detailById.get(cap.id)}
                onOpen={() => setFullSize(cap)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Modal>

    {fullSize && <FullSizeViewer capture={fullSize} onClose={() => setFullSize(null)} />}
    </>
  );
}
