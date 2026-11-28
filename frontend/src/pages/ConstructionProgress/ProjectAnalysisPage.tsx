import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, LinearProgress, MenuItem, Pagination, Select, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TableSortLabel, Typography,
} from '@mui/material';
import { DownloadRounded, PlayArrowRounded } from '@mui/icons-material';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { colors, shadows } from '@theme/tokens';
import { useAuthStore, isManagerOrAdmin } from '@store/authStore';
import { useWorkflowStore } from '@store/workflowStore';
import { formatDate } from '@/utils/dateFormat';
import { pageSlice } from '@/utils/evidenceImages';
import { downloadCsv } from '@/utils/downloadCsv';
import {
  FILTER_CHIPS, buildFloorCsv, filterCounts, floorStatusLabel, isRunActive, matchesFilter, projectHeadline,
  projectIdsWithCaptures, runLabel, runPct, sortFloors, towerProgress, type SortDir, type SortKey, type StatusFilter,
} from '@/utils/projectAnalysis';
import { useAnalyzeProject, useProjectAnalyzeStatus, useProjectOverview } from '@/hooks/useProjectAnalysis';
import {
  Bar, ChartCard, ProgressCoverageChart, STATUS_COLOR, TowerProgressChart, pctColor,
} from '@/components/ConstructionProgress/ProjectCharts';
import type { ProjectFloorRow } from '@/services/constructionProgressService';

const FLOORS_PAGE_SIZE = 10;

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827' };

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string; error?: string; detail?: string } }; message?: string };
  return e?.response?.data?.message || e?.response?.data?.detail || e?.response?.data?.error || e?.message || fallback;
}

const COLUMNS: { key: SortKey; label: string; align?: 'right'; hideXs?: boolean }[] = [
  { key: 'floor', label: 'Floor' },
  { key: 'tower', label: 'Tower', hideXs: true },
  { key: 'status', label: 'Status' },
  { key: 'progress', label: 'Progress' },
  { key: 'coverage', label: 'Coverage', hideXs: true },
  { key: 'lastAnalysed', label: 'Last analysed', hideXs: true },
];

function FloorTable({ rows, sortKey, dir, onSort }: {
  rows: ProjectFloorRow[]; sortKey: SortKey; dir: SortDir; onSort: (k: SortKey) => void;
}) {
  return (
    <TableContainer sx={{ border: `1.5px solid ${P.border}`, borderRadius: '14px', backgroundColor: '#fff' }}>
      <Table size="small" aria-label="Floors in this project">
        <TableHead>
          <TableRow>
            {COLUMNS.map(c => (
              <TableCell
                key={c.key} sortDirection={sortKey === c.key ? dir : false}
                sx={{ fontWeight: 700, color: P.muted, fontSize: '0.75rem', display: c.hideXs ? { xs: 'none', md: 'table-cell' } : undefined }}
              >
                <TableSortLabel active={sortKey === c.key} direction={sortKey === c.key ? dir : 'asc'} onClick={() => onSort(c.key)}>
                  {c.label}
                </TableSortLabel>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(r => {
            const color = r.status in STATUS_COLOR ? STATUS_COLOR[r.status as keyof typeof STATUS_COLOR] : '#9ca3af';
            const hasData = r.status !== 'no_photos';
            return (
              <TableRow key={r.floorId} hover>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
                  {hasData
                    ? <Box component={Link} to={`/construction-progress/${r.floorId}`} sx={{ color: colors.primary, textDecoration: 'none' }}>{r.floorName}</Box>
                    : r.floorName}
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, fontSize: '0.8125rem' }}>{r.towerName}</TableCell>
                <TableCell>
                  <Chip
                    size="small" label={floorStatusLabel(r.status)}
                    sx={{ fontWeight: 700, fontSize: '0.6875rem', color, backgroundColor: `${color}1a` }}
                  />
                </TableCell>
                <TableCell sx={{ minWidth: 110 }}>
                  {typeof r.progressPct === 'number' ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ flex: 1, minWidth: 50 }}><Bar pct={r.progressPct} color={pctColor(r.progressPct)} label={`${r.floorName} progress`} /></Box>
                      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, width: 38, textAlign: 'right' }}>{Math.round(r.progressPct)}%</Typography>
                    </Box>
                  ) : <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>No data</Typography>}
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, fontSize: '0.8125rem' }}>
                  {typeof r.coveragePct === 'number' ? `${Math.round(r.coveragePct)}%` : '-'}
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, fontSize: '0.8125rem' }}>
                  {r.lastAnalysedAt ? formatDate(r.lastAnalysedAt) : 'Never'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function ProjectAnalysisPage() {
  const [params, setParams] = useSearchParams();
  const allProjects = useWorkflowStore(s => s.projects);
  const captures = useWorkflowStore(s => s.captures);
  // Only projects that have captures: an empty project has nothing to analyse. Until captures have loaded,
  // show every project rather than an empty list.
  const projects = useMemo(() => {
    if (!captures.length) return allProjects;
    const withCaptures = projectIdsWithCaptures(captures);
    return allProjects.filter(p => withCaptures.has(p.id));
  }, [allProjects, captures]);
  const canRun = useAuthStore(s => isManagerOrAdmin(s.user));
  const projectId = params.get('project') ?? '';
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('tower');
  const [dir, setDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  // Pick the first listed project when none is chosen, or when the chosen one is not in the list (no captures).
  useEffect(() => {
    if (projects.length && !projects.some(p => p.id === projectId)) setParams({ project: projects[0].id }, { replace: true });
  }, [projectId, projects, setParams]);

  const overview = useProjectOverview(projectId || undefined);
  const statusQ = useProjectAnalyzeStatus(projectId || undefined);
  const start = useAnalyzeProject(projectId || undefined);

  const run = statusQ.data ?? overview.data?.lastRun ?? null;
  const running = isRunActive(run?.state) || start.isPending;
  const data = overview.data;

  const rows = useMemo(() => {
    const all = data?.floors ?? [];
    return sortFloors(all.filter(r => matchesFilter(r, filter)), sortKey, dir);
  }, [data, filter, sortKey, dir]);
  const counts = useMemo(() => filterCounts(data?.floors ?? []), [data]);
  const paged = useMemo(() => pageSlice(rows, page, FLOORS_PAGE_SIZE), [rows, page]);

  // A different filter, sort or project starts again from the first page.
  useEffect(() => { setPage(1); }, [filter, sortKey, dir, projectId]);

  const onSort = (k: SortKey) => {
    if (k === sortKey) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setDir(k === 'progress' || k === 'coverage' || k === 'lastAnalysed' ? 'desc' : 'asc'); }
  };

  const handleAnalyse = async () => {
    try {
      const res = await start.mutateAsync();
      toast.success(`Started. ${res.floorsQueued} floors queued, ${res.floorsSkippedNoPhotos} skipped (no photos).`);
    } catch (err) {
      toast.error(errorText(err, 'Could not start the analysis.'));
      void statusQ.refetch(); // a 409 means one is already running; pick it up
    }
  };

  const handleCsv = async () => {
    try {
      const name = (data?.projectName || 'project').replace(/[^a-z0-9]+/gi, '-');
      await downloadCsv(`Project-Analysis-${name}-${new Date().toISOString().slice(0, 10)}.csv`, buildFloorCsv(rows));
    } catch {
      toast.error('Could not save the file.');
    }
  };

  const totals = data?.totals;
  const headline = useMemo(() => projectHeadline(data?.floors ?? [], data?.towers ?? []), [data]);
  const towerRows = useMemo(() => towerProgress(data?.floors ?? [], data?.towers ?? []), [data]);

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: { sm: 'flex-end' }, gap: 2, flexDirection: { xs: 'column', sm: 'row' }, mb: 2.5 }}>
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Typography component="h1" sx={{ fontSize: '1.375rem', fontWeight: 800, color: P.strong }}>Project analysis</Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted, mb: 1 }}>Every floor of a project in one place.</Typography>
          <Select
            size="small" fullWidth displayEmpty value={projects.some(p => p.id === projectId) ? projectId : ''}
            onChange={e => { setParams({ project: e.target.value }); setFilter('all'); }}
            inputProps={{ 'aria-label': 'Project' }}
            sx={{ fontSize: '0.875rem', backgroundColor: '#fff', maxWidth: { sm: 360 } }}
          >
            <MenuItem value="" disabled sx={{ fontSize: '0.875rem' }}>Choose a project</MenuItem>
            {projects.map(p => <MenuItem key={p.id} value={p.id} sx={{ fontSize: '0.875rem' }}>{p.name}</MenuItem>)}
          </Select>
        </Box>
        {canRun && (
          <Button
            onClick={() => void handleAnalyse()} disabled={!projectId || running}
            startIcon={running ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <PlayArrowRounded />}
            sx={{
              background: colors.primaryGradient, color: '#fff', px: 3, minHeight: 44, borderRadius: '10px', fontWeight: 700,
              textTransform: 'none', boxShadow: shadows.btn, width: { xs: '100%', sm: 'auto' },
              '&.Mui-disabled': { color: 'rgba(255,255,255,0.85)', opacity: 0.6 },
            }}
          >
            {running ? 'Analysing…' : 'Analyse whole project'}
          </Button>
        )}
      </Box>

      {run && (isRunActive(run.state) || run.state === 'partial' || run.state === 'failed') && (
        <Box data-testid="run-progress" sx={{ p: 2, mb: 2.5, borderRadius: '14px', border: `1.5px solid ${P.border}`, backgroundColor: '#fff' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 1 }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong }}>{runLabel(run)}</Typography>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: P.strong }}>{runPct(run)}%</Typography>
          </Box>
          <LinearProgress variant="determinate" value={runPct(run)} sx={{ height: 8, borderRadius: 4 }} />
          {!!run.errors?.length && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              {run.errors.length} floor{run.errors.length === 1 ? '' : 's'} failed. {run.errors[0].message}
            </Alert>
          )}
        </Box>
      )}

      {!projectId && <Typography sx={{ color: P.muted, py: 6, textAlign: 'center' }}>Choose a project to see its floors.</Typography>}

      {projectId && overview.isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      )}

      {projectId && overview.isError && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void overview.refetch()}>Retry</Button>}>
          {errorText(overview.error, 'Could not load this project.')}
        </Alert>
      )}

      {data && totals && (
        <>
          {totals.floors === 0 ? (
            <Typography sx={{ color: P.muted, py: 6, textAlign: 'center' }}>This project has no floors yet.</Typography>
          ) : (
            <>
              <Box sx={{ p: 2.5, mb: 2.5, borderRadius: '14px', border: `1.5px solid ${P.border}`, backgroundColor: '#fff' }} data-testid="headline">
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Project progress
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography data-testid="headline-pct" sx={{ fontSize: '2.5rem', fontWeight: 800, color: pctColor(headline.analysedAvgPct), lineHeight: 1.1 }}>
                    {headline.analysedAvgPct === null ? '-' : `${Math.round(headline.analysedAvgPct)}%`}
                  </Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>
                    {headline.analysedAvgPct === null
                      ? 'No floor has been analysed yet.'
                      : `Average progress of the ${headline.floorsAnalysed} floor${headline.floorsAnalysed === 1 ? '' : 's'} analysed so far.`}
                  </Typography>
                </Box>
                <Box sx={{ mt: 1.5 }}><Bar pct={headline.analysedAvgPct ?? 0} label="Average progress of analysed floors" /></Box>
                <Box data-testid="headline-counts" sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 1, sm: 3 }, mt: 1.5 }}>
                  <Typography sx={{ fontSize: '0.875rem', color: P.strong }}>
                    <strong>In progress:</strong> {headline.floorsInProgress} floor{headline.floorsInProgress === 1 ? '' : 's'}
                    {headline.inProgressAvgPct !== null ? `, average ${Math.round(headline.inProgressAvgPct)}%` : ''}
                  </Typography>
                  <Typography sx={{ fontSize: '0.875rem', color: P.strong }}>
                    <strong>Completed:</strong> {headline.floorsCompleted} of {headline.floorsTotal} floors
                  </Typography>
                  <Typography sx={{ fontSize: '0.875rem', color: P.strong }}>
                    <strong>Towers completed:</strong> {headline.towersCompleted} of {headline.towersTotal}
                  </Typography>
                </Box>
                {typeof totals.coveragePct === 'number' && (
                  <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mt: 1 }}>
                    Coverage {Math.round(totals.coveragePct)}%
                    {typeof totals.roomsPhotographed === 'number' && typeof totals.roomsTotal === 'number'
                      ? ` (${totals.roomsPhotographed} of ${totals.roomsTotal} rooms photographed)` : ''}
                  </Typography>
                )}
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', flex: 1 }} role="group" aria-label="Filter floors by status">
                  {FILTER_CHIPS.filter(c => c.id !== 'no_photos').map(c => (
                    <Chip
                      key={c.id} clickable onClick={() => setFilter(c.id)}
                      label={`${c.label} (${counts[c.id]})`}
                      color={filter === c.id ? 'primary' : 'default'} variant={filter === c.id ? 'filled' : 'outlined'}
                      sx={{ fontWeight: 600 }}
                    />
                  ))}
                </Box>
                <Button
                  onClick={() => void handleCsv()} disabled={!rows.length} startIcon={<DownloadRounded />}
                  sx={{ textTransform: 'none', fontWeight: 600, border: `1.5px solid ${P.border}`, borderRadius: '10px', color: P.strong, minHeight: 40 }}
                >
                  Export CSV
                </Button>
              </Box>

              {rows.length ? (
                <>
                  <FloorTable rows={paged.rows} sortKey={sortKey} dir={dir} onSort={onSort} />
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                    <Typography data-testid="floors-range" sx={{ fontSize: '0.8125rem', color: P.muted }}>
                      Showing {(paged.page - 1) * FLOORS_PAGE_SIZE + 1}-{(paged.page - 1) * FLOORS_PAGE_SIZE + paged.rows.length} of {rows.length} floors
                    </Typography>
                    {paged.pages > 1 && (
                      <Pagination
                        count={paged.pages} page={paged.page} onChange={(_e, p) => setPage(p)}
                        color="primary" shape="rounded" size="small" siblingCount={1} boundaryCount={1}
                      />
                    )}
                  </Box>
                </>
              ) : (
                <Typography sx={{ color: P.muted, py: 4, textAlign: 'center' }}>No floors match this filter.</Typography>
              )}

              <Typography component="h2" sx={{ fontSize: '1.0625rem', fontWeight: 800, color: P.strong, mt: 4, mb: 1.5 }}>Analytics</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2, mb: 4 }}>
                <ChartCard title="Progress by tower" testId="chart-towers"><TowerProgressChart towers={towerRows} /></ChartCard>
                <ChartCard title="Progress and coverage by floor" testId="chart-progress-coverage"><ProgressCoverageChart floors={data.floors} /></ChartCard>
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
}
