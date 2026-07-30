import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { PhotoLibraryRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  ACTIVITY_STATUS_LABELS,
  type ActivityAssessment,
  type ActivityStatus,
} from '@/services/constructionProgressService';
import EvidenceLightbox from './EvidenceLightbox';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827', white: '#ffffff' };

function statusColor(status: ActivityStatus): string {
  switch (status) {
    case 'completed': return colors.success;
    case 'mostly_complete': return colors.primary;
    case 'in_progress': return colors.warning;
    case 'not_started': return colors.textSubdued;
    default: return colors.textMuted;
  }
}

function statusBg(status: ActivityStatus): string {
  switch (status) {
    case 'completed': return colors.successBg;
    case 'mostly_complete': return colors.primarySoft;
    case 'in_progress': return colors.warningBg;
    default: return colors.bgDeep;
  }
}

export default function ActivityCard({ activity }: { activity: ActivityAssessment }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const hasEvidence = activity.evidenceCaptureIds.length > 0;

  return (
    <>
      <Box
        sx={{
          p: 1.75, borderRadius: '12px', backgroundColor: P.white,
          border: `1.5px solid ${P.border}`, transition: `all ${motion.durationFast}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 1 }}>
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong, lineHeight: 1.35 }}>
            {activity.name}
          </Typography>
          <Box
            sx={{
              px: 1, py: 0.25, borderRadius: '6px', flexShrink: 0,
              backgroundColor: statusBg(activity.status), whiteSpace: 'nowrap',
            }}
          >
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: statusColor(activity.status) }}>
              {ACTIVITY_STATUS_LABELS[activity.status]}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: hasEvidence ? 1 : 0 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.375 }}>
              <Typography sx={{ fontSize: '0.6875rem', color: P.muted, fontWeight: 600 }}>Completion</Typography>
              <Typography sx={{ fontSize: '0.6875rem', color: P.strong, fontWeight: 700 }}>
                {Math.round(activity.completionPct)}%
              </Typography>
            </Box>
            <Box sx={{ height: 5, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden' }}>
              <Box
                sx={{
                  height: '100%', width: `${activity.completionPct}%`,
                  backgroundColor: statusColor(activity.status), borderRadius: '999px',
                  transition: `width ${motion.durationSlow} ${motion.easeOut}`,
                }}
              />
            </Box>
          </Box>
          {activity.confidencePct > 0 && (
            <Typography sx={{ fontSize: '0.6875rem', color: P.muted, whiteSpace: 'nowrap' }}>
              {Math.round(activity.confidencePct)}% confidence
            </Typography>
          )}
        </Box>

        {hasEvidence && (
          <Box
            onClick={() => setLightboxOpen(true)}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: 600, color: colors.primary,
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            <PhotoLibraryRounded sx={{ fontSize: 14 }} />
            {activity.evidenceCaptureIds.length} evidence image{activity.evidenceCaptureIds.length === 1 ? '' : 's'}
          </Box>
        )}
      </Box>

      {lightboxOpen && (
        <EvidenceLightbox
          activityName={activity.name}
          captureIds={activity.evidenceCaptureIds}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
