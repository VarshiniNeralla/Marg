import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  InputBase,
  Pagination,
  CircularProgress,
} from '@mui/material';
import {
  ArrowBackRounded,
  AutoAwesomeRounded,
  SearchRounded,
  ChevronRightRounded,
} from '@mui/icons-material';
import { Link, useLocation } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useAuthStore, getRoleLandingPath } from '@store/authStore';
import ProgressAnalysisDrawer from '@/pages/Tours/ProgressAnalysisDrawer';
import {
  progressAnalysisService,
  type ProgressReportSummary,
  type ProgressAnalysisReport,
} from '@/services/progressAnalysisService';
import { toast } from 'react-toastify';
import { formatReportGeneratedAt } from '@/utils/reportFormat';

const PAGE_SIZE = 8;
const SEARCH_FETCH_LIMIT = 100;

function formatReportCardTitle(item: ProgressReportSummary): string {
  const parts = [item.tower, item.floor].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : item.projectName || item.pinName || 'Saved report';
}

function formatLocation(item: ProgressReportSummary): string {
  const parts = [item.projectName, item.pinName].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Site';
}

function progressColor(pct: number): string {
  if (pct >= 50) return '#16a34a';
  if (pct > 0) return '#d97706';
  return '#64748b';
}

function matchesReportQuery(item: ProgressReportSummary, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.projectName,
    item.tower,
    item.floor,
    item.pinName,
    item.summary,
    item.beforeDate,
    item.afterDate,
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function ReportListCard({
  item,
  opening,
  onOpen,
}: {
  item: ProgressReportSummary;
  opening: boolean;
  onOpen: () => void;
}) {
  const pct = item.overallProgressPercentage;
  const generated = formatReportGeneratedAt(item.savedAt, item.createdAt);
  const thumb = item.beforeImageUrl || item.afterImageUrl;

  return (
    <Box
      onClick={onOpen}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        borderRadius: '12px',
        cursor: 'pointer',
        backgroundColor: colors.card,
        border: `1px solid ${colors.borderLight}`,
        transition: `all ${motion.durationFast}`,
        '&:hover': {
          borderColor: '#7c3aed',
          boxShadow: '0 4px 16px rgba(124,58,237,0.08)',
        },
      }}
    >
      {/* Thumbnail */}
      <Box
        sx={{
          width: 72,
          height: 48,
          flexShrink: 0,
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: '#0f1929',
          border: `1px solid ${colors.borderLight}`,
        }}
      >
        {thumb ? (
          <Box
            component="img"
            src={thumb}
            alt=""
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AutoAwesomeRounded sx={{ fontSize: 20, color: 'rgba(124,58,237,0.35)' }} />
          </Box>
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.25 }}>
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }} noWrap>
            {formatReportCardTitle(item)}
          </Typography>
          <Box
            sx={{
              px: 0.875,
              py: 0.25,
              borderRadius: '6px',
              backgroundColor: `${progressColor(pct)}14`,
              flexShrink: 0,
            }}
          >
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 800, color: progressColor(pct), lineHeight: 1.2 }}>
              {pct}%
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mb: 0.375 }} noWrap>
          {formatLocation(item)}
          {generated ? ` · ${generated}` : ''}
        </Typography>
        <Typography
          sx={{
            fontSize: '0.8125rem',
            color: colors.textSecondary,
            lineHeight: 1.45,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.summary || 'Open to view full report'}
        </Typography>
      </Box>

      {opening ? (
        <CircularProgress size={18} sx={{ color: '#7c3aed', flexShrink: 0 }} />
      ) : (
        <ChevronRightRounded sx={{ fontSize: 20, color: colors.textSubdued, flexShrink: 0 }} />
      )}
    </Box>
  );
}

const P = {
  border:   '#e4e7ec',
  muted:    '#6b7280',
  subtle:   '#9ca3af',
  strong:   '#111827',
  white:    '#ffffff',
  bg:       '#f7f8fa',
};

export default function ProgressReportsPage() {
  const user = useAuthStore(s => s.user);
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ProgressReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [selectedReport, setSelectedReport] = useState<ProgressAnalysisReport | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<Parameters<typeof ProgressAnalysisDrawer>[0]['meta']>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQuery]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      if (debouncedQuery) {
        const result = await progressAnalysisService.listReports({
          page: 1,
          limit: SEARCH_FETCH_LIMIT,
        });
        setLibraryTotal(result.total);
        const matched = result.items.filter(item => matchesReportQuery(item, debouncedQuery));
        const start = (page - 1) * PAGE_SIZE;
        setItems(matched.slice(start, start + PAGE_SIZE));
        setTotal(matched.length);
      } else {
        const result = await progressAnalysisService.listReports({ page, limit: PAGE_SIZE });
        setItems(result.items);
        setTotal(result.total);
        setLibraryTotal(result.total);
      }
    } catch {
      toast.error('Failed to load progress reports');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedQuery]);

  useEffect(() => {
    loadReports();
  }, [loadReports, location.pathname, location.key]);

  useEffect(() => {
    const onFocus = () => loadReports();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadReports]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const isSearching = debouncedQuery.length > 0;
  const emptyTitle = isSearching ? 'No matching reports' : 'No progress reports yet';
  const emptyBody = isSearching
    ? `Nothing matched “${debouncedQuery}”. Try another project, tower, floor, or pin name.`
    : 'Run a timeline comparison from a virtual tour to generate your first report.';

  const openReport = async (summary: ProgressReportSummary) => {
    setOpeningId(summary.reportId);
    try {
      const detail = await progressAnalysisService.getReport(summary.reportId);
      setSelectedReport(detail.analysis);
      setSelectedMeta({
        projectName: detail.projectName,
        tower: detail.tower,
        floor: detail.floor,
        pinName: detail.pinName,
        beforeDate: detail.beforeDate,
        afterDate: detail.afterDate,
        beforeImageUrl: detail.beforeImageUrl,
        afterImageUrl: detail.afterImageUrl,
        floorPlanImageUrl: detail.floorPlanImageUrl,
        pinX: detail.pinX,
        pinY: detail.pinY,
        generatedAt: detail.savedAt ?? detail.createdAt,
      });
      setDrawerOpen(true);
    } catch {
      toast.error('Failed to open report');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6, width: '100%', minWidth: 0, overflow: 'hidden' }}>
      <Box
        component={Link}
        to={getRoleLandingPath(user?.role)}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}
      >
        <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
      </Box>

      {/* Heading — matches Capture Gallery / Virtual Tours */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
          <AutoAwesomeRounded sx={{ fontSize: { xs: 28, md: 34 }, color: '#7c3aed', flexShrink: 0 }} />
          <Typography sx={{
            fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
            fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
            color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05,
          }}>
            Progress Reports
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
          {libraryTotal} report{libraryTotal !== 1 ? 's' : ''}
          {isSearching ? ` · ${total} match${total !== 1 ? 'es' : ''}` : ''}
          {' · '}AI-generated construction progress analyses from timeline comparisons across your projects.
        </Typography>
      </Box>

      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, mb: 2.5,
        px: 1.5, py: 1, borderRadius: '10px',
        border: `1px solid ${query ? colors.primary : colors.borderLight}`,
        backgroundColor: colors.card,
        transition: `border-color ${motion.durationFast}`,
      }}>
        <SearchRounded sx={{ fontSize: 18, color: query ? colors.primary : colors.textSubdued }} />
        <InputBase
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by project, tower, floor, capture point, or summary…"
          sx={{ flex: 1, fontSize: '0.875rem' }}
          inputProps={{ 'aria-label': 'Search progress reports' }}
        />
        {query && (
          <Box
            onClick={() => setQuery('')}
            sx={{
              px: 0.875, py: 0.25, borderRadius: '6px', cursor: 'pointer',
              fontSize: '0.6875rem', fontWeight: 700, color: colors.textMuted,
              '&:hover': { color: colors.primary, backgroundColor: colors.primarySoft },
            }}
          >
            Clear
          </Box>
        )}
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={32} />
        </Box>
      ) : items.length === 0 ? (
        <Box sx={{
          py: 8, textAlign: 'center', borderRadius: '14px',
          border: `1px dashed ${colors.border}`, backgroundColor: colors.bg,
        }}>
          <AutoAwesomeRounded sx={{ fontSize: 40, color: colors.borderLight, mb: 1.5 }} />
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, mb: 0.5 }}>
            {emptyTitle}
          </Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>
            {emptyBody}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {items.map(item => (
            <ReportListCard
              key={item.reportId}
              item={item}
              opening={openingId === item.reportId}
              onOpen={() => openReport(item)}
            />
          ))}
        </Box>
      )}

      {totalPages > 1 && !loading && items.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, p) => setPage(p)}
            size="small"
            sx={{ '& .Mui-selected': { backgroundColor: 'rgba(124,58,237,0.12) !important', color: '#7c3aed' } }}
          />
        </Box>
      )}

      <ProgressAnalysisDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        report={selectedReport}
        meta={selectedMeta}
      />
    </Box>
  );
}
