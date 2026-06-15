import React from 'react';
import { Dialog, Box, Typography } from '@mui/material';
import { WarningAmberRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: '20px', overflow: 'hidden' } } }}
      onClose={onCancel}>
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
          {destructive && (
            <Box sx={{ width: 40, height: 40, borderRadius: '12px', backgroundColor: colors.dangerBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <WarningAmberRounded sx={{ fontSize: 20, color: colors.danger }} />
            </Box>
          )}
          <Box>
            <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong, mb: 0.5, letterSpacing: '-0.02em' }}>
              {title}
            </Typography>
            <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted, lineHeight: 1.6 }}>
              {description}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.25, mt: 1 }}>
          <Box onClick={onCancel} sx={{
            px: 2.25, py: 0.875, borderRadius: '8px', border: `1.5px solid ${colors.border}`,
            color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer',
            '&:hover': { borderColor: colors.primary, color: colors.primary },
            transition: `all ${motion.durationFast}`,
          }}>
            {cancelLabel}
          </Box>
          <Box onClick={onConfirm} sx={{
            px: 2.25, py: 0.875, borderRadius: '8px',
            backgroundColor: destructive ? colors.danger : colors.primary,
            color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
            boxShadow: destructive ? '0 4px 14px rgba(220,38,38,0.28)' : '0 4px 14px rgba(37,99,235,0.28)',
            '&:hover': { opacity: 0.88 }, transition: `opacity ${motion.durationFast}`,
          }}>
            {confirmLabel}
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
