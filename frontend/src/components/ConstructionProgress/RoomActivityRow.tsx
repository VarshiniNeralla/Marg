import React from 'react';
import { Box, Typography } from '@mui/material';
import { PhotoLibraryRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import type { EvidenceDetail, RoomActivityAssessment } from '@/services/constructionProgressService';
import { formatDateTime } from '@/utils/dateFormat';
import {
  UNABLE_TO_DETERMINE, aiEstimate, assessmentColor, inferredTooltip, resolveAssessmentStatus, safePct, showsPercent,
} from '@/utils/progressDisplay';
import { AssessmentChip, DetectionChip, ReviewChip } from './ProgressChips';

const P = { muted: '#6b7280', strong: '#111827', border: '#e4e7ec' };

export interface RoomActivityRowProps {
  activity: RoomActivityAssessment;
  /** All activities of the same room (used to name the activity an inference came from). */
  siblings: ReadonlyArray<RoomActivityAssessment>;
  canReview?: boolean;
  onReview?: (activity: RoomActivityAssessment) => void;
  onOpenEvidence?: (activityName: string, captureIds: string[], details: EvidenceDetail[]) => void;
}

function IndicatorList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: P.strong }}>{title}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.25, fontSize: '0.6875rem', color: P.muted, lineHeight: 1.45 }}>
        {items.map(i => <li key={i}>{i}</li>)}
      </Box>
    </Box>
  );
}

export default function RoomActivityRow({
  activity: a, siblings, canReview = false, onReview, onOpenEvidence,
}: RoomActivityRowProps) {
  const status = resolveAssessmentStatus(a);
  const known = showsPercent(status);
  const pct = known ? safePct(a.completionPct, status === 'completed') : 0;
  const barColor = assessmentColor(status).fg;
  const found = a.visualIndicatorsFound ?? [];
  const missing = a.visualIndicatorsMissing ?? [];
  const details = a.evidenceDetails ?? [];
  // evidenceDetails === undefined means an older snapshot: fall back to the plain capture ids.
  const legacyIds = a.evidenceDetails === undefined ? a.evidenceCaptureIds ?? [] : [];
  const evidenceCount = details.length > 0 ? details.length : legacyIds.length;
  const evidenceIds = details.length > 0 ? details.map(d => d.captureId) : legacyIds;
  const ai = aiEstimate(a);
  const isManual = a.detectionType === 'manual' || !!a.override;
  const confidence = a.confidencePct > 0 && known ? Math.round(a.confidencePct) : null;

  return (
    <Box
      data-testid="room-activity-row"
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, py: 1, borderTop: `1px solid ${colors.borderLight}` }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: P.strong, flex: 1, minWidth: 140 }}>
          {a.activityName}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <AssessmentChip status={status} />
          <DetectionChip
            type={a.detectionType}
            inferredTooltip={inferredTooltip(a.inferredFrom, siblings)}
          />
          {a.reviewRequired && <ReviewChip reason={a.reviewReason} />}
        </Box>
      </Box>

      {known ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1, height: 5, borderRadius: '999px', backgroundColor: colors.borderLight, overflow: 'hidden' }}>
            <Box
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              sx={{
                height: '100%', width: `${pct}%`, backgroundColor: barColor, borderRadius: '999px',
                transition: `width ${motion.durationSlow} ${motion.easeOut}`,
              }}
            />
          </Box>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: P.strong, minWidth: 36, textAlign: 'right' }}>
            {pct}%
          </Typography>
          {confidence !== null && (
            <Typography sx={{ fontSize: '0.6875rem', color: P.muted, whiteSpace: 'nowrap' }}>
              {confidence}% confidence
            </Typography>
          )}
        </Box>
      ) : (
        <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>{UNABLE_TO_DETERMINE}</Typography>
      )}

      {a.explanation ? (
        <Typography sx={{ fontSize: '0.75rem', color: P.muted, lineHeight: 1.45 }}>{a.explanation}</Typography>
      ) : a.evidence ? (
        <Typography sx={{ fontSize: '0.75rem', color: P.muted, lineHeight: 1.45 }}>{a.evidence}</Typography>
      ) : null}

      {(found.length > 0 || missing.length > 0) && (
        <Box component="details" sx={{ fontSize: '0.75rem', color: P.muted }}>
          <Box component="summary" sx={{ cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center', fontWeight: 600, color: colors.primary }}>
            Seen / Missing
          </Box>
          <IndicatorList title="Seen" items={found} />
          <IndicatorList title="Missing" items={missing} />
        </Box>
      )}

      {a.reviewRequired && a.reviewReason && (
        <Typography sx={{ fontSize: '0.75rem', color: colors.danger }}>{a.reviewReason}</Typography>
      )}

      {isManual && (
        <Box sx={{ fontSize: '0.75rem', color: P.muted }}>
          {ai !== null && <Typography component="div" sx={{ fontSize: 'inherit', fontWeight: 600 }}>AI estimated {Math.round(ai)}%</Typography>}
          {a.override && (
            <Typography component="div" sx={{ fontSize: 'inherit' }}>
              {a.override.reason ? `${a.override.reason} · ` : ''}by {a.override.by} on {formatDateTime(a.override.at)}
            </Typography>
          )}
        </Box>
      )}

      {(evidenceCount > 0 || canReview) && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.25 }}>
          {evidenceCount > 0 && onOpenEvidence && (
            <Box
              component="button"
              type="button"
              onClick={() => onOpenEvidence(a.activityName, evidenceIds, details)}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.75, minHeight: 44, px: 1.25, cursor: 'pointer',
                border: `1px solid ${P.border}`, borderRadius: '10px', backgroundColor: '#fff', color: colors.primary,
                fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              <PhotoLibraryRounded sx={{ fontSize: 16 }} />
              Evidence ({evidenceCount})
            </Box>
          )}
          {canReview && onReview && (
            <Box
              component="button"
              type="button"
              onClick={() => onReview(a)}
              sx={{
                minHeight: 44, px: 1.5, cursor: 'pointer', border: `1px solid ${P.border}`, borderRadius: '10px',
                backgroundColor: '#fff', color: P.strong, fontSize: '0.75rem', fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              Review
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
