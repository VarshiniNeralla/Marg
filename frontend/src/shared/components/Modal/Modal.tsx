import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Divider,
  type DialogProps,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { colors, radii, motion } from '@theme/tokens';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: DialogProps['maxWidth'];
  fullWidth?: boolean;
  disableCloseOnBackdrop?: boolean;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = 'sm',
  fullWidth = true,
  disableCloseOnBackdrop = false,
}: ModalProps) {
  return (
    <Dialog
      open={open}
      onClose={disableCloseOnBackdrop ? undefined : onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      transitionDuration={{ enter: 220, exit: 180 }}
      slotProps={{
        paper: {
          sx: {
            borderRadius: radii.lg,           // 16px
            boxShadow: '0 24px 60px rgba(15, 23, 42, 0.18)',
            border: `1px solid ${colors.border}`,
            overflow: 'hidden',
          },
        },
      }}
      sx={{
        '& .MuiBackdrop-root': {
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          backdropFilter: 'blur(4px)',
        },
      }}
    >
      {title && (
        <>
          <DialogTitle
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '1.0625rem',
              fontWeight: 600,
              color: colors.textStrong,
              padding: '20px 24px 16px',
            }}
          >
            {title}
            <IconButton
              onClick={onClose}
              size="small"
              sx={{
                color: colors.textMuted,
                borderRadius: '8px',
                '&:hover': { background: colors.bg, color: colors.text },
                transition: `all ${motion.durationFast} ${motion.easeOut}`,
              }}
              aria-label="Close modal"
            >
              <Close fontSize="small" />
            </IconButton>
          </DialogTitle>
          <Divider sx={{ borderColor: colors.border }} />
        </>
      )}

      <DialogContent sx={{ padding: '24px' }}>
        {children}
      </DialogContent>

      {actions && (
        <>
          <Divider sx={{ borderColor: colors.border }} />
          <DialogActions sx={{ padding: '16px 24px', gap: 1 }}>
            {actions}
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
