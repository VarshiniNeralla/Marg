import React, { useEffect, useState } from 'react';
import { Box, Modal, Typography, CircularProgress, IconButton } from '@mui/material';
import { CloseRounded, ImageNotSupportedRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import apiClient from '@/services/apiClient';
import type { ApiResponse } from '@/types/dto';

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
}

function captureUrl(cap: RawCapture): string | undefined {
  return cap.processedPanoramaUrl || cap.original_url || cap.originalFileUrl || cap.thumbnailUrl || undefined;
}

function FullSizeViewer({ capture, onClose }: { capture: RawCapture; onClose: () => void }) {
  const url = captureUrl(capture);
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
        {url ? (
          <Box
            component="img"
            src={url}
            alt={capture.roomName ?? ''}
            sx={{ maxWidth: '100%', maxHeight: '88vh', objectFit: 'contain', borderRadius: '8px', display: 'block' }}
          />
        ) : (
          <Box sx={{ width: '60vw', maxWidth: 480, aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDeep, borderRadius: '8px' }}>
            <ImageNotSupportedRounded sx={{ fontSize: 32, color: colors.textSubdued }} />
          </Box>
        )}
        {capture.roomName && (
          <Typography sx={{ mt: 1.5, fontSize: '0.875rem', fontWeight: 600, color: '#fff' }}>
            {capture.roomName}
          </Typography>
        )}
      </Box>
    </Modal>
  );
}

export default function EvidenceLightbox({
  activityName,
  captureIds,
  onClose,
}: {
  activityName: string;
  captureIds: string[];
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [captures, setCaptures] = useState<RawCapture[]>([]);
  const [fullSize, setFullSize] = useState<RawCapture | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      captureIds.map(id =>
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
  }, [captureIds]);

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
            {captures.map(cap => {
              const url = captureUrl(cap);
              return (
                <Box
                  key={cap.id}
                  onClick={() => url && setFullSize(cap)}
                  sx={{
                    borderRadius: '10px', overflow: 'hidden', border: `1px solid ${colors.borderLight}`,
                    cursor: url ? 'pointer' : 'default', transition: 'box-shadow 150ms, transform 150ms',
                    ...(url && { '&:hover': { boxShadow: '0 6px 18px rgba(15,23,42,0.14)', transform: 'translateY(-1px)' } }),
                  }}
                >
                  {url ? (
                    <Box component="img" src={url} alt={cap.roomName ?? ''} sx={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <Box sx={{ width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDeep }}>
                      <ImageNotSupportedRounded sx={{ fontSize: 24, color: colors.textSubdued }} />
                    </Box>
                  )}
                  <Box sx={{ p: 1 }}>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textStrong }} noWrap>
                      {cap.roomName || 'Capture'}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Modal>

    {fullSize && <FullSizeViewer capture={fullSize} onClose={() => setFullSize(null)} />}
    </>
  );
}
