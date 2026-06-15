import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  CloudUploadRounded, HourglassEmptyRounded, AutorenewRounded, CheckCircleRounded,
  RateReviewRounded, PublicRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';

export type PipelineStage = 'uploaded' | 'queued' | 'processing' | 'converted' | 'reviewed' | 'published';

type IconComponent = React.ComponentType<{ sx?: object }>;

const STAGES: { key: PipelineStage; label: string; Icon: IconComponent; desc: string }[] = [
  { key: 'uploaded',   label: 'Uploaded',   Icon: CloudUploadRounded,    desc: 'File received by server' },
  { key: 'queued',     label: 'Queued',     Icon: HourglassEmptyRounded, desc: 'Waiting in processing queue' },
  { key: 'processing', label: 'Processing', Icon: AutorenewRounded,      desc: 'Converting to panorama format' },
  { key: 'converted',  label: 'Converted',  Icon: CheckCircleRounded,    desc: 'Panorama ready for review' },
  { key: 'reviewed',   label: 'Reviewed',   Icon: RateReviewRounded,     desc: 'QA review complete' },
  { key: 'published',  label: 'Published',  Icon: PublicRounded,         desc: 'Visible in virtual tour' },
];

const STAGE_ORDER = STAGES.map(s => s.key);

function stageIndex(stage: PipelineStage) {
  return STAGE_ORDER.indexOf(stage);
}

interface ProcessingPipelineProps {
  currentStage: PipelineStage;
  compact?: boolean;
}

export default function ProcessingPipeline({ currentStage, compact = false }: ProcessingPipelineProps) {
  const currentIdx = stageIndex(currentStage);

  if (compact) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {STAGES.map((stage, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          const pending = i > currentIdx;
          const color = done ? colors.success : active ? colors.primary : colors.textSubdued;
          return (
            <React.Fragment key={stage.key}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.375 }}>
                <Box sx={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: done ? 'rgba(22,163,74,0.1)' : active ? 'rgba(37,99,235,0.1)' : colors.bgDeep,
                  color,
                  ...(active && { boxShadow: '0 0 0 3px rgba(37,99,235,0.15)' }),
                }}>
                  {done ? <CheckCircleRounded sx={{ fontSize: 14, color: colors.success }} /> : <stage.Icon sx={{ fontSize: 14, color }} />}
                </Box>
                <Typography sx={{ fontSize: '0.5rem', fontWeight: active ? 700 : 400, color: active ? colors.primary : done ? colors.success : colors.textSubdued, whiteSpace: 'nowrap', letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                  {stage.label}
                </Typography>
              </Box>
              {i < STAGES.length - 1 && (
                <Box sx={{ height: 2, flex: 1, backgroundColor: done ? colors.success : colors.borderLight, mt: -2, mx: 0.25 }} />
              )}
            </React.Fragment>
          );
        })}
      </Box>
    );
  }

  return (
    <Box>
      {STAGES.map((stage, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const isLast = i === STAGES.length - 1;
        const color = done ? colors.success : active ? colors.primary : colors.textSubdued;
        const bgColor = done ? 'rgba(22,163,74,0.08)' : active ? 'rgba(37,99,235,0.08)' : 'transparent';

        return (
          <Box key={stage.key} sx={{ display: 'flex', gap: 1.5, pb: isLast ? 0 : 0 }}>
            {/* Left: icon + connector */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <Box sx={{
                width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: done ? 'rgba(22,163,74,0.1)' : active ? 'rgba(37,99,235,0.12)' : colors.bgDeep,
                color, flexShrink: 0, zIndex: 1, position: 'relative',
                ...(active && { boxShadow: '0 0 0 4px rgba(37,99,235,0.12)', animation: 'pulse 2s infinite', '@keyframes pulse': { '0%,100%': { boxShadow: '0 0 0 4px rgba(37,99,235,0.12)' }, '50%': { boxShadow: '0 0 0 7px rgba(37,99,235,0.06)' } } }),
              }}>
                {done
                  ? <CheckCircleRounded sx={{ fontSize: 16, color: colors.success }} />
                  : <stage.Icon sx={{ fontSize: 16, color, ...(active && { animation: 'spin 1.5s linear infinite', '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } } }) }} />
                }
              </Box>
              {!isLast && (
                <Box sx={{ width: 2, flex: 1, minHeight: 24, backgroundColor: done ? colors.success : colors.borderLight, mt: 0.25 }} />
              )}
            </Box>

            {/* Right: label + description */}
            <Box sx={{ pb: isLast ? 0 : 2.5, pt: 0.25, flex: 1, borderRadius: '10px', px: active ? 1.5 : 0, py: active ? 0.75 : 0, backgroundColor: active ? bgColor : 'transparent', transition: `background ${motion.durationNormal}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: active ? 700 : done ? 600 : 400, color: active ? colors.primary : done ? colors.textStrong : colors.textSubdued }}>
                  {stage.label}
                </Typography>
                {active && (
                  <Box sx={{ px: 0.875, py: 0.125, borderRadius: '4px', backgroundColor: 'rgba(37,99,235,0.12)', fontSize: '0.5625rem', fontWeight: 700, color: colors.primary, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Current
                  </Box>
                )}
              </Box>
              <Typography sx={{ fontSize: '0.75rem', color: active ? colors.textMuted : colors.textSubdued }}>
                {stage.desc}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
