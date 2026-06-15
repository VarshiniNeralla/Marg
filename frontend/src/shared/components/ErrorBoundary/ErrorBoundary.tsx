import React from 'react';
import { Box, Typography } from '@mui/material';
import { ErrorOutlineRounded, RefreshRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';

interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', flexDirection: 'column', gap: 2.5, p: 4, textAlign: 'center' }}>
        <Box sx={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: colors.dangerBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ErrorOutlineRounded sx={{ fontSize: 32, color: colors.danger }} />
        </Box>
        <Box>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.25rem', fontWeight: 700, color: colors.textStrong, mb: 0.75 }}>
            Something went wrong
          </Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, maxWidth: 360 }}>
            An unexpected error occurred. The issue has been logged.
          </Typography>
          {this.state.error && (
            <Box sx={{ mt: 2, px: 2, py: 1.5, borderRadius: '8px', backgroundColor: colors.bgDeep, border: `1px solid ${colors.border}`, maxWidth: 400, mx: 'auto' }}>
              <Typography sx={{ fontSize: '0.75rem', fontFamily: 'monospace', color: colors.textMuted, wordBreak: 'break-word' }}>
                {this.state.error.message}
              </Typography>
            </Box>
          )}
        </Box>
        <Box onClick={() => this.setState({ hasError: false })} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, borderRadius: '10px', background: colors.primaryGradient, color: '#fff', fontWeight: 600, fontSize: '0.9375rem', cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)', '&:hover': { opacity: 0.9 }, transition: `opacity ${motion.durationFast}` }}>
          <RefreshRounded sx={{ fontSize: 16 }} /> Try again
        </Box>
      </Box>
    );
  }
}

export function NetworkError({ onRetry }: { onRetry?: () => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', flexDirection: 'column', gap: 2, p: 4, textAlign: 'center' }}>
      <Box sx={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: colors.warningBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ErrorOutlineRounded sx={{ fontSize: 28, color: colors.warning }} />
      </Box>
      <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '1.125rem', fontWeight: 700, color: colors.textStrong }}>
        Unable to load data
      </Typography>
      <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted, maxWidth: 320 }}>
        Check your network connection and try again.
      </Typography>
      {onRetry && (
        <Box onClick={onRetry} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2.5, py: 1, borderRadius: '10px', border: `1.5px solid ${colors.border}`, color: colors.textStrong, fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', '&:hover': { borderColor: colors.primary, color: colors.primary }, transition: `all ${motion.durationFast}` }}>
          <RefreshRounded sx={{ fontSize: 16 }} /> Retry
        </Box>
      )}
    </Box>
  );
}
