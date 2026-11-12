import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { colors } from '@theme/tokens';
import type { AssessmentStatus, DetectionType, ScopeStatus } from '@/services/constructionProgressService';
import {
  assessmentColor, assessmentLabel, detectionLabel, scopeColor, scopeLabel,
} from '@/utils/progressDisplay';

export function Pill({ label, fg, bg, title }: { label: string; fg: string; bg: string; title?: string }) {
  return (
    <Box
      component="span"
      title={title}
      sx={{
        display: 'inline-flex', alignItems: 'center', px: 0.875, py: 0.25, borderRadius: '999px',
        fontSize: '0.6875rem', fontWeight: 700, lineHeight: 1.3, color: fg, backgroundColor: bg,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  );
}

export function AssessmentChip({ status }: { status: AssessmentStatus }) {
  const c = assessmentColor(status);
  return <Pill label={assessmentLabel(status)} fg={c.fg} bg={c.bg} />;
}

export function ScopeChip({ status }: { status: ScopeStatus | undefined }) {
  const c = scopeColor(status);
  return <Pill label={scopeLabel(status)} fg={c.fg} bg={c.bg} />;
}

/** "Detected" / "Inferred" / "Verified by manager"; inferred carries an explanatory tooltip. */
export function DetectionChip({ type, inferredTooltip }: { type: DetectionType | undefined; inferredTooltip?: string }) {
  const label = detectionLabel(type);
  if (!label) return null;
  const pill = type === 'manual'
    ? <Pill label={label} fg={colors.primary} bg={colors.primarySoft} />
    : type === 'direct'
      ? <Pill label={label} fg={colors.success} bg={colors.successBg} />
      : <Pill label={label} fg={colors.info} bg={colors.infoBg} />;
  if (type === 'inferred' || type === 'mixed') {
    return (
      <Tooltip title={inferredTooltip ?? 'Inferred from a later activity that could be seen'} arrow>
        <Box component="span" tabIndex={0} sx={{ display: 'inline-flex' }}>{pill}</Box>
      </Tooltip>
    );
  }
  return pill;
}

export function ReviewChip({ reason, label = 'Needs review' }: { reason?: string; label?: string }) {
  return <Pill label={label} fg={colors.danger} bg={colors.dangerBg} title={reason || undefined} />;
}
