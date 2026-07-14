import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, CircularProgress, Collapse } from '@mui/material';
import {
  HistoryRounded, ChevronRightRounded, KeyboardArrowDownRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  progressAnalysisService,
  type ProgressReportSummary,
} from '@/services/progressAnalysisService';
import { formatReportDateRangeCompact, formatReportGeneratedAt } from '@/utils/reportFormat';

export interface PreviousReportsPanelProps {
  projectId?: string;
  pinName: string;
  beforeTimelineId?: string;
  afterTimelineId?: string;
  /** Capture ids currently on this pin's timeline. Reports for deleted captures are hidden. */
  validTimelineIds?: string[];
  onSelect: (summary: ProgressReportSummary) => void;
}

export default function PreviousReportsPanel({
  projectId,
  pinName,
  beforeTimelineId,
  afterTimelineId,
  validTimelineIds,
  onSelect,
}: PreviousReportsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ProgressReportSummary[]>([]);
  const [open, setOpen] = useState(false);

  const validIdSet = useMemo(
    () => (validTimelineIds ? new Set(validTimelineIds) : null),
    [validTimelineIds],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await progressAnalysisService.listReports({
          projectId: projectId || undefined,
          pinName,
          beforeTimelineId,
          afterTimelineId,
          limit: 12,
        });
        if (!cancelled) setReports(result.items);
      } catch {
        if (!cancelled) setReports([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, pinName, beforeTimelineId, afterTimelineId]);

  useEffect(() => {
    setOpen(false);
  }, [projectId, pinName, beforeTimelineId, afterTimelineId]);

  const visibleReports = useMemo(() => {
    if (!validIdSet) return reports;
    return reports.filter(
      r => validIdSet.has(r.beforeTimelineId) && validIdSet.has(r.afterTimelineId),
    );
  }, [reports, validIdSet]);

  if (loading) {
    return (
      <Box sx={{ borderTop: `1px solid ${colors.borderLight}`, px: 1.5, py: 1.25, display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <CircularProgress size={12} sx={{ color: colors.textSubdued }} />
        <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>Loading reports…</Typography>
      </Box>
    );
  }

  if (visibleReports.length === 0) return null;

  return (
    <Box sx={{ borderTop: `1px solid ${colors.borderLight}`, mt: 0.5 }}>
      <Box
        onClick={() => setOpen(v => !v)}
        role="button"
        aria-expanded={open}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 1,
          cursor: 'pointer',
          userSelect: 'none',
          transition: `background-color ${motion.durationFast}`,
          '&:hover': { backgroundColor: colors.bg },
        }}
      >
        <HistoryRounded sx={{ fontSize: 14, color: open ? colors.primary : colors.textSubdued }} />
        <Typography sx={{ flex: 1, fontSize: '0.75rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em' }}>
          Saved reports
        </Typography>
        <Box
          sx={{
            px: 0.625,
            py: 0.125,
            borderRadius: '999px',
            fontSize: '0.625rem',
            fontWeight: 700,
            backgroundColor: open ? 'rgba(37,99,235,0.1)' : colors.bg,
            color: open ? colors.primary : colors.textMuted,
          }}
        >
          {visibleReports.length}
        </Box>
        <KeyboardArrowDownRounded
          sx={{
            fontSize: 18,
            color: colors.textMuted,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform ${motion.durationFast}`,
          }}
        />
      </Box>

      <Collapse in={open} timeout={180} unmountOnExit>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, px: 1, pb: 1 }}>
          {visibleReports.map(report => {
            const generated = formatReportGeneratedAt(report.savedAt, report.createdAt);
            return (
              <Box
                key={report.reportId}
                onClick={() => onSelect(report)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  py: 0.75,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'background-color 120ms ease',
                  '&:hover': { backgroundColor: colors.bg },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textStrong, letterSpacing: '-0.01em' }} noWrap>
                    {formatReportDateRangeCompact(report.beforeDate, report.afterDate)}
                  </Typography>
                  <Typography sx={{ fontSize: '0.625rem', color: colors.textMuted, mt: 0.125 }} noWrap>
                    {report.overallProgressPercentage}% progress
                    {report.confidence > 0 ? ` · ${report.confidence}% conf.` : ''}
                    {generated ? ` · ${generated}` : ''}
                  </Typography>
                </Box>
                <ChevronRightRounded sx={{ fontSize: 16, color: colors.textSubdued, flexShrink: 0 }} />
              </Box>
            );
          })}
        </Box>
      </Collapse>
    </Box>
  );
}
