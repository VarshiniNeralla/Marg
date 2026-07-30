import React from 'react';
import { Box, Typography } from '@mui/material';
import { colors, motion } from '@theme/tokens';

function ringColor(pct: number): string {
  if (pct >= 75) return colors.success;
  if (pct >= 40) return colors.warning;
  return colors.danger;
}

export default function ProgressRing({
  percentage,
  size = 132,
  strokeWidth = 10,
  label,
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percentage));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const color = ringColor(clamped);

  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.borderLight}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: `stroke-dashoffset ${motion.durationSlow} ${motion.easeOut}` }}
        />
      </svg>
      <Box
        sx={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Typography sx={{ fontSize: size * 0.21, fontWeight: 800, color: colors.textStrong, lineHeight: 1 }}>
          {Math.round(clamped)}%
        </Typography>
        {label && (
          <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.5, fontWeight: 600 }}>
            {label}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
