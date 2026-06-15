import React from 'react';
import {
  Drawer as MuiDrawer,
  Box,
  IconButton,
  Typography,
  Divider,
  type DrawerProps as MuiDrawerProps,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  anchor?: MuiDrawerProps['anchor'];
  width?: number | string;
}

export default function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  anchor = 'right',
  width = 480,
}: DrawerProps) {
  return (
    <MuiDrawer
      anchor={anchor}
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width,
            backgroundColor: colors.card,
            borderLeft: `1px solid ${colors.border}`,
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      {/* Header */}
      {title && (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '20px 24px',
            }}
          >
            <Typography
              component="div"
              sx={{
                fontSize: '1.0625rem',
                fontWeight: 600,
                color: colors.textStrong,
              }}
            >
              {title}
            </Typography>
            <IconButton
              onClick={onClose}
              size="small"
              sx={{
                color: colors.textMuted,
                borderRadius: '8px',
                '&:hover': { background: colors.bg, color: colors.text },
                transition: `all ${motion.durationFast} ${motion.easeOut}`,
              }}
              aria-label="Close drawer"
            >
              <Close fontSize="small" />
            </IconButton>
          </Box>
          <Divider sx={{ borderColor: colors.border }} />
        </>
      )}

      {/* Content */}
      <Box sx={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {children}
      </Box>

      {/* Footer */}
      {footer && (
        <>
          <Divider sx={{ borderColor: colors.border }} />
          <Box sx={{ padding: '16px 24px' }}>{footer}</Box>
        </>
      )}
    </MuiDrawer>
  );
}
