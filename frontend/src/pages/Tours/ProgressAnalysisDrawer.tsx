import React, { useCallback, useMemo } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  CircularProgress,
  Button,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  ContentCopyRounded,
  PictureAsPdfRounded,
  CheckRounded,
} from '@mui/icons-material';
import Drawer from '@shared/components/Drawer/Drawer';
import { colors } from '@theme/tokens';
import {
  type ProgressAnalysisReport,
  type ProgressReportVisualMeta,
} from '@/services/progressAnalysisService';
import { formatReportAsText, exportReportToPdf } from '@/utils/reportPdf';
import ProgressReportView from '@/components/ProgressReport/ProgressReportView';
import { normalizeProgressReport } from '@/utils/reportNormalization';
import { BRAND_REPORT_TITLE } from '@/utils/reportBranding';
import { toast } from 'react-toastify';

export interface ProgressAnalysisDrawerProps {
  open: boolean;
  onClose: () => void;
  report: ProgressAnalysisReport | null;
  meta?: ProgressReportVisualMeta;
  reportId?: string | null;
  saved?: boolean;
  onSave?: () => void | Promise<void>;
  saveLoading?: boolean;
}

export default function ProgressAnalysisDrawer({
  open,
  onClose,
  report,
  meta,
  reportId,
  saved = false,
  onSave,
  saveLoading = false,
}: ProgressAnalysisDrawerProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const normalized = useMemo(
    () => (report ? normalizeProgressReport(report) : null),
    [report],
  );

  const handleCopy = useCallback(async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatReportAsText(report, meta));
      toast.success('Report copied to clipboard');
    } catch {
      toast.error('Failed to copy report');
    }
  }, [report, meta]);

  const handleExportPdf = useCallback(() => {
    if (!report) return;
    exportReportToPdf(report, meta);
  }, [report, meta]);

  if (!report || !normalized) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={BRAND_REPORT_TITLE}
      width={isMobile ? '100%' : 680}
      footer={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          <Tooltip title="Copy report as text">
            <IconButton onClick={handleCopy} size="small" sx={{ border: `1px solid ${colors.border}`, borderRadius: '8px' }}>
              <ContentCopyRounded fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Export engineering PDF">
            <IconButton onClick={handleExportPdf} size="small" sx={{ border: `1px solid ${colors.border}`, borderRadius: '8px' }}>
              <PictureAsPdfRounded fontSize="small" />
            </IconButton>
          </Tooltip>
          {onSave && reportId && (
            <Button
              onClick={onSave}
              disabled={saved || saveLoading}
              startIcon={
                saveLoading ? (
                  <CircularProgress size={14} sx={{ color: '#fff' }} />
                ) : saved ? (
                  <CheckRounded sx={{ fontSize: 18 }} />
                ) : undefined
              }
              sx={{
                ml: 'auto',
                minWidth: 96,
                height: 36,
                px: 2,
                borderRadius: '8px',
                fontSize: '0.8125rem',
                fontWeight: 700,
                textTransform: 'none',
                color: '#fff',
                backgroundColor: saved ? '#15803d' : '#16a34a',
                boxShadow: saved ? 'none' : '0 2px 8px rgba(22,163,74,0.35)',
                '&:hover': { backgroundColor: saved ? '#15803d' : '#15803d' },
                '&.Mui-disabled': { color: '#fff', backgroundColor: '#16a34a', opacity: saved ? 0.85 : 0.7 },
              }}
            >
              {saveLoading ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </Button>
          )}
        </Box>
      }
    >
      <ProgressReportView report={report} meta={meta} normalized={normalized} />
    </Drawer>
  );
}
