import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import {
  AddAPhotoRounded, DeleteOutlineRounded, CloseRounded,
  HistoryRounded, TouchAppRounded,
} from '@mui/icons-material';
import type { WfCapturePin } from '@store/workflowStore';
import type { MockCapture } from '@/data/mockData';

const P = {
  border: '#e4e7ec', muted: '#6b7280', subtle: '#9ca3af', strong: '#111827',
  blue: '#2563eb', blueSoft: 'rgba(37,99,235,0.08)', white: '#ffffff', bg: '#f7f8fa',
};

interface PinActionPanelProps {
  pin: WfCapturePin;
  captures: MockCapture[];
  isMobile?: boolean;
  canCapture: boolean;
  usesCamera: boolean;
  onCapture: (pin: WfCapturePin) => void;
  onViewHistory: (pin: WfCapturePin) => void;
  onDelete: (pin: WfCapturePin) => void;
  onClose: () => void;
}

export default function PinActionPanel({ pin, captures, isMobile, canCapture, usesCamera, onCapture, onViewHistory, onDelete, onClose }: PinActionPanelProps) {
  const pinCaptures = pin.captureIds
    .map(id => captures.find(c => c.id === id))
    .filter((c): c is MockCapture => !!c);
  const hasCapture = pinCaptures.length > 0;

  return (
    <Box sx={
      isMobile
        ? { position: 'absolute', bottom: 0, left: 0, right: 0, borderRadius: '16px 16px 0 0', backgroundColor: P.white, boxShadow: '0 -4px 24px rgba(15,23,42,0.18)', zIndex: 20, overflow: 'hidden', border: `1px solid ${P.border}` }
        : { position: 'absolute', top: 16, right: 16, width: 280, borderRadius: '16px', backgroundColor: P.white, boxShadow: '0 12px 40px rgba(15,23,42,0.16)', zIndex: 20, overflow: 'hidden', border: `1px solid ${P.border}` }
    }>
      {/* Header */}
      <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${P.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box sx={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: hasCapture ? '#16a34a' : 'transparent', border: `2px ${hasCapture ? 'solid' : 'dashed'} ${hasCapture ? '#15803d' : '#d97706'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: hasCapture ? '#fff' : '#d97706' }}>{pin.sequenceNumber}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }}>Pin {pin.sequenceNumber}</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>Walkthrough position {pin.sequenceNumber}</Typography>
          </Box>
        </Box>
        <Box onClick={onClose} sx={{ cursor: 'pointer', color: P.subtle, display: 'flex', '&:hover': { color: P.strong } }}>
          <CloseRounded sx={{ fontSize: 18 }} />
        </Box>
      </Box>

      <Box sx={{ p: 2 }}>
        {/* Status chip */}
        <Box sx={{ mb: 1.75 }}>
          {hasCapture ? (
            <Chip label={`${pinCaptures.length} capture${pinCaptures.length !== 1 ? 's' : ''} attached`} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, color: '#16a34a', backgroundColor: 'rgba(22,163,74,0.12)', borderRadius: '6px' }} />
          ) : (
            <Chip icon={<TouchAppRounded sx={{ fontSize: 13, color: '#d97706 !important' }} />} label="Waiting for capture" size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, color: '#d97706', backgroundColor: 'rgba(217,119,6,0.12)', borderRadius: '6px', '& .MuiChip-icon': { ml: 0.5 } }} />
          )}
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {canCapture && (
            <Box onClick={() => onCapture(pin)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, px: 1.5, py: 1.125, borderRadius: '10px', background: 'linear-gradient(135deg, #2563eb 0%, #1a56db 100%)', color: '#fff', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
              <AddAPhotoRounded sx={{ fontSize: 16 }} />
              {hasCapture ? 'Capture Again' : usesCamera ? 'Open Camera' : 'Upload Capture'}
            </Box>
          )}

          {hasCapture && (
            <Box onClick={() => onViewHistory(pin)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, px: 1.5, py: 0.875, borderRadius: '10px', border: `1px solid ${P.border}`, color: P.muted, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } }}>
              <HistoryRounded sx={{ fontSize: 15 }} /> View History
            </Box>
          )}

          <Box onClick={() => onDelete(pin)} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, px: 1.5, py: 0.875, borderRadius: '10px', border: `1px solid ${P.border}`, color: P.muted, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', '&:hover': { borderColor: '#ef4444', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)' } }}>
            <DeleteOutlineRounded sx={{ fontSize: 14 }} /> Delete Pin
          </Box>
        </Box>

        {/* Long-press hint — only when no capture yet */}
        {canCapture && !hasCapture && (
          <Typography sx={{ mt: 1.25, fontSize: '0.6875rem', color: P.subtle, textAlign: 'center', lineHeight: 1.5 }}>
            Tip: long-press the pin on the plan to {usesCamera ? 'open the camera' : 'upload'} directly.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
