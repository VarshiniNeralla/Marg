import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  DeleteOutlineRounded, CloseRounded, EditRounded,
} from '@mui/icons-material';
import type { WfCapturePin } from '@store/workflowStore';

const P = {
  border: '#e4e7ec', muted: '#6b7280', subtle: '#9ca3af', strong: '#111827',
  blue: '#2563eb', blueSoft: 'rgba(37,99,235,0.08)', white: '#ffffff',
};

interface PinActionPanelProps {
  pin: WfCapturePin;
  isMobile?: boolean;
  canEdit?: boolean;
  /** Annotation mode: omit capture status (Captured / No capture yet). */
  annotationOnly?: boolean;
  /** Engineer upload order (1..N). When set, subtitle uses this instead of annotation stop #. */
  uploadSequence?: number;
  onEdit?: (pin: WfCapturePin) => void;
  onDelete: (pin: WfCapturePin) => void;
  onClose: () => void;
}

/** Compact pin menu: room/flat + Edit + Delete only. */
export default function PinActionPanel({
  pin, isMobile, canEdit, annotationOnly = false, uploadSequence, onEdit, onDelete, onClose,
}: PinActionPanelProps) {
  const title = pin.flatName && pin.roomName
    ? `${pin.flatName} · ${pin.roomName}`
    : pin.roomName || pin.label || `Point ${pin.sequenceNumber}`;
  const seqLabel = uploadSequence != null ? uploadSequence : pin.sequenceNumber;
  const subtitle = annotationOnly
    ? `Capture point · stop #${pin.sequenceNumber}`
    : uploadSequence != null
      ? `Capture #${uploadSequence}`
      : pin.captureIds.length > 0
        ? `Captured · stop #${seqLabel}`
        : `No capture yet · stop #${seqLabel}`;

  // Keep floor-plan pan/place from stealing clicks on this panel.
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  return (
    <Box
      data-no-pan
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onClick={stop}
      sx={
        isMobile
          ? { position: 'absolute', bottom: 0, left: 0, right: 0, borderRadius: '16px 16px 0 0', backgroundColor: P.white, boxShadow: '0 -4px 24px rgba(15,23,42,0.18)', zIndex: 40, overflow: 'hidden', border: `1px solid ${P.border}`, pointerEvents: 'auto' }
          : { position: 'absolute', top: 16, right: 16, width: 260, borderRadius: '14px', backgroundColor: P.white, boxShadow: '0 12px 40px rgba(15,23,42,0.16)', zIndex: 40, overflow: 'hidden', border: `1px solid ${P.border}`, pointerEvents: 'auto' }
      }
    >
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box sx={{
            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
            backgroundColor: '#2563eb',
            boxShadow: '0 0 0 3px rgba(37,99,235,0.28)',
            border: '2px solid #fff',
          }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong, lineHeight: 1.25 }} noWrap>
              {title}
            </Typography>
            {subtitle ? (
              <Typography sx={{ fontSize: '0.75rem', color: P.muted }} noWrap>{subtitle}</Typography>
            ) : null}
          </Box>
        </Box>
        <Box
          component="button"
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          sx={{
            cursor: 'pointer', color: P.subtle, display: 'flex', flexShrink: 0,
            border: 'none', background: 'transparent', p: 0.5, borderRadius: '6px',
            '&:hover': { color: P.strong, backgroundColor: P.blueSoft },
          }}
        >
          <CloseRounded sx={{ fontSize: 18 }} />
        </Box>
      </Box>

      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {canEdit && onEdit && (
          <Box
            component="button"
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(pin); }}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
              px: 1.5, py: 1.125, borderRadius: '10px',
              border: `1.5px solid ${P.border}`, color: P.strong,
              fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
              backgroundColor: P.white, fontFamily: 'inherit',
              '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft },
            }}
          >
            <EditRounded sx={{ fontSize: 16 }} /> Edit
          </Box>
        )}
        {canEdit && (
          <Box
            component="button"
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(pin); }}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75,
              px: 1.5, py: 1.125, borderRadius: '10px',
              border: `1.5px solid ${P.border}`, color: P.muted,
              fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
              backgroundColor: P.white, fontFamily: 'inherit',
              '&:hover': { borderColor: '#ef4444', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)' },
            }}
          >
            <DeleteOutlineRounded sx={{ fontSize: 16 }} /> Delete
          </Box>
        )}
      </Box>
    </Box>
  );
}
