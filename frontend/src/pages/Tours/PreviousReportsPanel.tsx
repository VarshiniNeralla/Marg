import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { HistoryRounded, ChevronRightRounded, AccessTimeRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import {
  progressAnalysisService,
  type ProgressReportSummary,
} from '@/services/progressAnalysisService';
import { formatReportDateRange, formatReportGeneratedAt } from '@/utils/reportFormat';

export interface PreviousReportsPanelProps {
  projectId?: string;
  pinName: string;
  beforeTimelineId?: string;
  afterTimelineId?: string;
  onSelect: (summary: ProgressReportSummary) => void;
}

export default function PreviousReportsPanel({
  projectId,
  pinName,
  beforeTimelineId,
  afterTimelineId,
  onSelect,
}: PreviousReportsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ProgressReportSummary[]>([]);

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
          limit: 5,
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

  if (loading) {
    return (
      <Box sx={{ px: 1.25, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={14} sx={{ color: '#7c3aed' }} />
        <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>Loading previous reports…</Typography>
      </Box>
    );
  }

  if (reports.length === 0) return null;

  return (
    <Box sx={{ borderTop: '1px solid rgba(124,58,237,0.12)', px: 1.25, py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
        <HistoryRounded sx={{ fontSize: 13, color: '#7c3aed' }} />
        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: '#7c3aed' }}>
          Previous Reports
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {reports.map(report => (
          <Box
            key={report.reportId}
            onClick={() => onSelect(report)}
            sx={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
              px: 1, py: 0.625, borderRadius: '6px', cursor: 'pointer',
              backgroundColor: 'rgba(124,58,237,0.04)',
              border: '1px solid rgba(124,58,237,0.1)',
              '&:hover': { backgroundColor: 'rgba(124,58,237,0.08)' },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.625rem', fontWeight: 600, color: colors.textStrong }} noWrap>
                {formatReportDateRange(report.beforeDate, report.afterDate)}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375, mt: 0.25 }}>
                <AccessTimeRounded sx={{ fontSize: 11, color: '#7c3aed' }} />
                <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: '#7c3aed' }} noWrap>
                  {formatReportGeneratedAt(report.savedAt, report.createdAt) || 'Generated recently'}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.5625rem', color: colors.textMuted, mt: 0.25 }} noWrap>
                {report.overallProgressPercentage}% progress · {report.confidence}% confidence
              </Typography>
            </Box>
            <ChevronRightRounded sx={{ fontSize: 16, color: colors.textSubdued, flexShrink: 0 }} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
