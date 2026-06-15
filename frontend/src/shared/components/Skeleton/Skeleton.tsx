import React from 'react';
import { Box, Skeleton as MuiSkeleton } from '@mui/material';
import { Grid } from '@mui/material';

interface SkeletonCardProps {
  variant?: 'project' | 'capture' | 'list' | 'stat';
}

function pulse(delay = 0) {
  return {
    animation: `pulse 1.6s ease-in-out ${delay}ms infinite`,
    '@keyframes pulse': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.4 },
    },
  };
}

export function SkeletonCard({ variant = 'project' }: SkeletonCardProps) {
  if (variant === 'capture') {
    return (
      <Box sx={{ borderRadius: '16px', backgroundColor: '#fff', overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
        <MuiSkeleton variant="rectangular" height={128} sx={{ transform: 'none' }} />
        <Box sx={{ px: 1.5, pt: 1.25, pb: 1.5 }}>
          <MuiSkeleton width="80%" height={14} sx={{ mb: 0.5 }} />
          <MuiSkeleton width="55%" height={11} sx={{ mb: 0.75 }} />
          <MuiSkeleton width="35%" height={10} />
        </Box>
      </Box>
    );
  }

  if (variant === 'list') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5 }}>
        <MuiSkeleton variant="rounded" width={36} height={36} sx={{ borderRadius: '9px', flexShrink: 0 }} />
        <Box sx={{ flex: 1 }}>
          <MuiSkeleton width="60%" height={14} sx={{ mb: 0.5 }} />
          <MuiSkeleton width="40%" height={11} />
        </Box>
        <MuiSkeleton width={56} height={20} sx={{ borderRadius: '5px' }} />
      </Box>
    );
  }

  if (variant === 'stat') {
    return (
      <Box sx={{ p: 2, borderRadius: '14px', backgroundColor: '#fff', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
        <MuiSkeleton width="40%" height={32} sx={{ mb: 0.5 }} />
        <MuiSkeleton width="60%" height={13} sx={{ mb: 0.25 }} />
        <MuiSkeleton width="45%" height={11} />
      </Box>
    );
  }

  // project card
  return (
    <Box sx={{ borderRadius: '20px', backgroundColor: '#fff', overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
      <MuiSkeleton variant="rectangular" height={180} sx={{ transform: 'none' }} />
      <Box sx={{ px: 2.5, pt: 2.5, pb: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', mb: 2.5 }}>
          {[0, 1, 2, 3].map(i => (
            <Box key={i} sx={{ textAlign: 'center' }}>
              <MuiSkeleton width={28} height={20} sx={{ mx: 'auto', mb: 0.375 }} />
              <MuiSkeleton width={36} height={10} sx={{ mx: 'auto' }} />
            </Box>
          ))}
        </Box>
        <MuiSkeleton height={4} sx={{ borderRadius: '99px', mb: 2.5 }} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <MuiSkeleton width={80} height={12} />
          <MuiSkeleton width={96} height={12} />
        </Box>
      </Box>
    </Box>
  );
}

export function ProjectGridSkeleton() {
  return (
    <Grid container spacing={2.5}>
      {[0, 1, 2, 3].map(i => (
        <Grid key={i} size={{ xs: 12, sm: 6 }}>
          <SkeletonCard variant="project" />
        </Grid>
      ))}
    </Grid>
  );
}

export function CaptureGridSkeleton() {
  return (
    <Grid container spacing={2}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
        <Grid key={i} size={{ xs: 6, sm: 4, md: 3 }}>
          <SkeletonCard variant="capture" />
        </Grid>
      ))}
    </Grid>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Box>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} variant="list" />
      ))}
    </Box>
  );
}
