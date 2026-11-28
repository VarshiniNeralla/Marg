import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, MenuItem, Pagination, Select, Typography,
} from '@mui/material';
import {
  CameraAltRounded, DeleteForeverRounded, FolderOpenRounded, MapRounded, RestoreRounded, ViewInArRounded,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import { colors } from '@theme/tokens';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { useWorkflowStore } from '@store/workflowStore';
import { formatDate } from '@/utils/dateFormat';
import { recycleBinService, type BinFilter, type BinItem, type BinKind, type BinPage, type BinSort } from '@/services/recycleBinService';
import {
  BIN_PAGE_SIZE, FILTER_OPTIONS, KIND_LABEL, SORT_OPTIONS, daysLeftLabel, emptyBinWarning, isExpiringSoon, rangeText,
} from '@/utils/recycleBin';

const P = { border: '#e4e7ec', muted: '#6b7280', strong: '#111827' };
const DANGER = '#dc2626';

const KIND_ICON: Record<BinKind, React.ReactNode> = {
  project: <FolderOpenRounded />,
  floor_plan: <MapRounded />,
  tour: <ViewInArRounded />,
  capture: <CameraAltRounded />,
};

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string; detail?: string } }; message?: string };
  return e?.response?.data?.message || e?.response?.data?.detail || e?.message || fallback;
}

function BinRow({ item, busy, onRestore }: { item: BinItem; busy: boolean; onRestore: (item: BinItem) => void }) {
  const soon = isExpiringSoon(item.daysLeft);
  return (
    <Box
      data-testid="bin-row"
      sx={{
        display: 'grid', alignItems: 'center', gap: { xs: 1, sm: 2 }, p: 1.5,
        gridTemplateColumns: { xs: '40px minmax(0, 1fr)', sm: '40px minmax(0, 1fr) auto auto' },
        borderBottom: `1px solid ${P.border}`, '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Box sx={{ width: 40, height: 40, borderRadius: '10px', backgroundColor: colors.primarySoft, color: colors.primary, display: 'grid', placeItems: 'center' }}>
        {KIND_ICON[item.kind]}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 700, color: P.strong }} title={item.title}>{item.title}</Typography>
          <Chip size="small" label={KIND_LABEL[item.kind]} sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600, flexShrink: 0 }} />
        </Box>
        {item.subtitle && (
          <Typography noWrap sx={{ fontSize: '0.8125rem', color: P.muted }} title={item.subtitle}>{item.subtitle}</Typography>
        )}
        <Typography sx={{ fontSize: '0.75rem', color: P.muted }}>
          Deleted {formatDate(item.deletedAt)}{item.deletedByName ? ` by ${item.deletedByName}` : ''}
        </Typography>
      </Box>
      <Typography
        sx={{
          fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', color: soon ? DANGER : P.muted,
          gridColumn: { xs: '2', sm: 'auto' },
        }}
      >
        {daysLeftLabel(item.daysLeft)}
      </Typography>
      <Button
        size="small" variant="outlined" startIcon={<RestoreRounded />} disabled={busy} onClick={() => onRestore(item)}
        aria-label={`Restore ${item.title}`}
        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px', gridColumn: { xs: '2', sm: 'auto' }, justifySelf: { xs: 'start', sm: 'end' } }}
      >
        Restore
      </Button>
    </Box>
  );
}

export default function RecycleBinPage() {
  const retryApiSnapshot = useWorkflowStore(s => s.retryApiSnapshot);
  const [kind, setKind] = useState<BinFilter>('all');
  const [sort, setSort] = useState<BinSort>('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BinPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, setEmptying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await recycleBinService.list({ kind, sort, page, pageSize: BIN_PAGE_SIZE });
      setData(next);
      setError(null);
      // The last item on a page was restored or removed: step back to a page that exists.
      if (next.page !== page) setPage(next.page);
    } catch (err) {
      setError(errorText(err, 'Could not load the Recycle Bin.'));
    } finally {
      setLoading(false);
    }
  }, [kind, sort, page]);

  useEffect(() => { void load(); }, [load]);

  const total = data?.counts.all ?? 0;
  const retention = data?.retentionDays ?? 30;

  async function restore(item: BinItem) {
    setBusyId(item.id);
    try {
      const res = await recycleBinService.restore(item.id);
      toast.success(res.outcome === 'restored' ? `Restored "${item.title}".` : `"${item.title}" was already back.`);
      retryApiSnapshot(); // reload projects, floors and captures so the restored item shows up everywhere
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Could not restore this item.'));
    } finally {
      setBusyId(null);
    }
  }

  async function emptyBin() {
    setEmptying(true);
    try {
      const res = await recycleBinService.empty('all');
      toast.success(res.purged === 1 ? '1 item permanently deleted.' : `${res.purged} items permanently deleted.`);
      setConfirmEmpty(false);
      setPage(1);
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Could not empty the Recycle Bin.'));
    } finally {
      setEmptying(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, mb: 2.5, flexWrap: 'wrap' }}>
        <Box>
          <Typography
            sx={{
              fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.75rem', md: '2.25rem' },
              fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.05em', lineHeight: 1.05,
            }}
          >
            Recycle Bin
          </Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted, mt: 0.5 }}>
            Deleted projects, floor plans, tours and captures are kept for {retention} days. After that they are removed permanently.
          </Typography>
        </Box>
        <Button
          variant="outlined" color="error" startIcon={<DeleteForeverRounded />} disabled={total === 0 || emptying}
          onClick={() => setConfirmEmpty(true)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
        >
          Empty Recycle Bin
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '0.8125rem', color: P.muted }} component="label" id="bin-show-label">Show</Typography>
          <Select
            size="small" value={kind} labelId="bin-show-label" inputProps={{ 'aria-label': 'Show' }} data-testid="bin-filter"
            onChange={e => { setKind(e.target.value as BinFilter); setPage(1); }}
            sx={{ minWidth: 170, borderRadius: '10px', fontSize: '0.875rem' }}
          >
            {FILTER_OPTIONS.map(o => (
              <MenuItem key={o.value} value={o.value}>{o.label}{data ? ` (${data.counts[o.value] ?? 0})` : ''}</MenuItem>
            ))}
          </Select>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontSize: '0.8125rem', color: P.muted }} component="label" id="bin-sort-label">Sort by</Typography>
          <Select
            size="small" value={sort} labelId="bin-sort-label" inputProps={{ 'aria-label': 'Sort by' }} data-testid="bin-sort"
            onChange={e => { setSort(e.target.value as BinSort); setPage(1); }}
            sx={{ minWidth: 190, borderRadius: '10px', fontSize: '0.875rem' }}
          >
            {SORT_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </Select>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ border: `1.5px solid ${P.border}`, borderRadius: '14px', backgroundColor: '#fff', overflow: 'hidden', minHeight: 120, position: 'relative' }}>
        {loading && !data && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress size={26} /></Box>
        )}
        {data && data.items.length === 0 && !loading && (
          <Box sx={{ textAlign: 'center', py: 6, px: 2 }} data-testid="bin-empty">
            <Typography sx={{ fontWeight: 700, color: P.strong }}>
              {total === 0 ? 'The Recycle Bin is empty' : 'Nothing of this type in the Recycle Bin'}
            </Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: P.muted, mt: 0.5 }}>
              Things you delete will show up here, and you can restore them for {retention} days.
            </Typography>
          </Box>
        )}
        {data?.items.map(item => (
          <BinRow key={item.id} item={item} busy={busyId === item.id} onRestore={restore} />
        ))}
        {loading && data && (
          <Box sx={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.55)' }} aria-hidden />
        )}
      </Box>

      {data && data.total > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 2, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.8125rem', color: P.muted }} data-testid="bin-range">
            {rangeText(data.page, data.pageSize, data.total)}
          </Typography>
          {data.pages > 1 && (
            <Pagination count={data.pages} page={data.page} onChange={(_, p) => setPage(p)} shape="rounded" size="small" />
          )}
        </Box>
      )}

      <ConfirmDialog
        open={confirmEmpty}
        destructive
        title="Empty the Recycle Bin?"
        description={emptyBinWarning(total)}
        confirmLabel={emptying ? 'Deleting…' : 'Delete permanently'}
        cancelLabel="Keep them"
        onConfirm={() => { if (!emptying) void emptyBin(); }}
        onCancel={() => { if (!emptying) setConfirmEmpty(false); }}
      />
    </Box>
  );
}
