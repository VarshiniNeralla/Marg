import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, useTheme, useMediaQuery } from '@mui/material';
import {
  CloudUploadRounded, PanoramaRounded, WarningAmberRounded, StorageRounded,
  MapRounded, CameraAltRounded, ViewInArRounded, InsertDriveFileRounded,
  ImageRounded, PictureAsPdfRounded, ChevronLeftRounded, ChevronRightRounded,
  ArrowBackRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, getRoleLandingPath } from '@store/authStore';

type MediaAsset = {
  original_filename?: string;
  original_url?: string;
  original_file_url?: string;
  processed_panorama_url?: string;
  thumbnail_url?: string;
  preview_url?: string;
  public_id?: string;
  format?: string;
  size?: number;
  uploaded_at?: string;
  processing_status?: string;
  processingStatus?: string;
};

type MediaKind = 'capture' | 'floor_plan' | 'tour';

interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  thumbnail: string | null;
  format: string;
  sizeBytes: number;
  status: string;
  context: string;       // e.g. "My Home Udyan · Tower 1 · Floor 2"
  uploadedAt: string;
  sortKey: string;
}

const KIND_META: Record<MediaKind, { label: string; color: string; icon: React.ReactNode }> = {
  capture: { label: 'Capture', color: '#0891b2', icon: <CameraAltRounded sx={{ fontSize: 13 }} /> },
  floor_plan: { label: 'Floor Plan', color: '#7c3aed', icon: <MapRounded sx={{ fontSize: 13 }} /> },
  tour: { label: 'Tour', color: '#059669', icon: <ViewInArRounded sx={{ fontSize: 13 }} /> },
};

const ROW_H = 76;  // fixed row height (px) — keeps the list a constant height across tabs

function formatBytes(bytes: number) {
  if (!bytes) return '—';
  const mb = bytes / 1024 / 1024;
  if (mb < 0.1) return `${(bytes / 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function FormatGlyph({ format, color }: { format: string; color: string }) {
  const f = format.toLowerCase();
  if (f === 'pdf') return <PictureAsPdfRounded sx={{ fontSize: 18, color }} />;
  if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(f)) return <ImageRounded sx={{ fontSize: 18, color }} />;
  return <InsertDriveFileRounded sx={{ fontSize: 18, color }} />;
}

export default function MediaPage() {
  const captures = useWorkflowStore(s => s.captures);
  const tours = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);
  const user = useAuthStore(s => s.user);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const pageSize = 5;

  const [filter, setFilter] = useState<'all' | MediaKind>('all');
  const [page, setPage] = useState(1);

  const items = useMemo<MediaItem[]>(() => {
    const out: MediaItem[] = [];

    // ── Captures ──────────────────────────────────────────────────────────────
    for (const c of captures) {
      const rec = c as typeof c & Record<string, unknown>;
      const assets = (rec.mediaAssets as MediaAsset[] | undefined) ?? [];
      const first = assets[0] ?? {};
      const thumb = (first.thumbnail_url ?? first.preview_url ?? rec.thumbnailUrl ?? rec.thumbnail_url ?? rec.previewUrl) as string | undefined;
      const fmt = (first.format ?? rec.format ?? 'jpg') as string;
      const size = (first.size ?? (typeof rec.size === 'number' ? rec.size : 0) ?? 0) as number;
      out.push({
        id: c.id,
        kind: 'capture',
        name: (first.original_filename as string) ?? `${c.roomName} capture`,
        thumbnail: thumb ?? null,
        format: fmt,
        sizeBytes: size || (c.sizeMb ? c.sizeMb * 1024 * 1024 : 0),
        status: (first.processing_status ?? rec.processingStatus ?? rec.processing_status ?? 'uploaded') as string,
        context: [c.projectName, c.towerName, c.floorLabel].filter(Boolean).join(' · '),
        uploadedAt: c.uploadedAt,
        sortKey: String(rec.capturedAt ?? c.uploadedAt ?? ''),
      });
    }

    // ── Floor plans ─────────────────────────────────────────────────────────
    for (const fp of floorPlans) {
      const rec = fp as typeof fp & Record<string, unknown>;
      const assets = (rec.mediaAssets as MediaAsset[] | undefined) ?? [];
      const first = assets[0] ?? {};
      const thumb = (first.thumbnail_url ?? first.preview_url ?? rec.thumbnailUrl ?? rec.thumbnail_url) as string | undefined;
      const tower = useWorkflowStore.getState().towers.find(t => t.id === fp.towerId);
      const project = useWorkflowStore.getState().projects.find(p => p.id === fp.projectId);
      out.push({
        id: fp.id,
        kind: 'floor_plan',
        name: fp.fileName ?? `${fp.floorLabel} plan`,
        thumbnail: thumb ?? null,
        format: (first.format ?? fp.fileType ?? 'pdf') as string,
        sizeBytes: (first.size as number) || (fp.fileSizeMb ? fp.fileSizeMb * 1024 * 1024 : 0),
        status: (first.processing_status ?? 'ready') as string,
        context: [project?.name, tower?.name, fp.floorLabel].filter(Boolean).join(' · '),
        uploadedAt: fp.uploadedAt,
        sortKey: fp.uploadedAt ?? '',
      });
    }

    // ── Tour panoramas ────────────────────────────────────────────────────────
    for (const t of tours) {
      const steps = t.steps ?? [];
      const thumb = steps[0]?.thumbnailUrl ?? steps[0]?.panoramaUrl ?? null;
      const panoCount = steps.length || t.captures || 1;
      out.push({
        id: t.id,
        kind: 'tour',
        name: `${t.roomName} walkthrough`,
        thumbnail: thumb ?? null,
        format: 'pano',
        sizeBytes: 0,
        status: t.status,
        context: [t.projectName, t.towerName, t.floorLabel].filter(Boolean).join(' · ') + ` · ${panoCount} stop${panoCount !== 1 ? 's' : ''}`,
        uploadedAt: t.lastCapture,
        sortKey: t.lastCapture ?? '',
      });
    }

    return out.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  }, [captures, floorPlans, tours]);

  const filtered = filter === 'all' ? items : items.filter(i => i.kind === filter);

  // Reset to the first page whenever the filter changes or the list shrinks below the current page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [filter, pageSize]);
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  const storageBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  const failed = items.filter(i => ['failed', 'error'].includes(i.status.toLowerCase())).length;
  const captureCount = items.filter(i => i.kind === 'capture').length;
  const floorPlanCount = items.filter(i => i.kind === 'floor_plan').length;
  const tourCount = items.filter(i => i.kind === 'tour').length;

  const filters: { key: 'all' | MediaKind; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'capture', label: 'Captures', count: captureCount },
    { key: 'floor_plan', label: 'Floor Plans', count: floorPlanCount },
    { key: 'tour', label: 'Tours', count: tourCount },
  ];

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Box sx={{ mb: 4 }}>
        <Box component={Link} to={getRoleLandingPath(user?.role)} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
        </Box>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em' }}>
          Media Library
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Every upload across the platform — captures, floor plans and published tours</Typography>
      </Box>

      {/* Metrics */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: { xs: 1, sm: 1.25, md: 1.5 }, mb: 3 }}>
        <Metric icon={<StorageRounded />} label="Storage used" value={formatBytes(storageBytes)} color="#2563eb" />
        <Metric icon={<CameraAltRounded />} label="Captures" value={String(captureCount)} color="#0891b2" />
        <Metric icon={<MapRounded />} label="Floor plans" value={String(floorPlanCount)} color="#7c3aed" />
        <Metric icon={<PanoramaRounded />} label="Tours" value={String(tourCount)} color="#059669" />
        <Metric icon={<WarningAmberRounded />} label="Failed" value={String(failed)} color="#dc2626" />
      </Box>

      {/* Filter pills */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {filters.map(f => {
          const on = filter === f.key;
          return (
            <Box
              key={f.key}
              onClick={() => setFilter(f.key)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                px: 1.75, py: 0.75, borderRadius: '999px', cursor: 'pointer',
                fontSize: '0.8125rem', fontWeight: 600,
                border: `1px solid ${on ? colors.primary : colors.border}`,
                backgroundColor: on ? colors.primary : colors.card,
                color: on ? '#fff' : colors.textSecondary,
                transition: `all ${motion.durationFast} ${motion.easeOut}`,
                '&:hover': { borderColor: colors.primary },
              }}
            >
              {f.label}
              <Box sx={{ px: 0.75, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: on ? 'rgba(255,255,255,0.22)' : colors.bgDeep, color: on ? '#fff' : colors.textMuted }}>
                {f.count}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Upload list — fixed height for rows so the page never reflows between tabs */}
      <Box sx={{ borderRadius: '18px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, overflow: 'hidden', minHeight: ROW_H * pageSize }}>
        {visible.length === 0 ? (
          <Box sx={{ minHeight: ROW_H * pageSize, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 6 }}>
            <CloudUploadRounded sx={{ fontSize: 40, color: colors.textSubdued, mb: 1 }} />
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textSecondary }}>No uploads yet</Typography>
            <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mt: 0.5 }}>
              Captures, floor plans and tours will appear here as they're uploaded.
            </Typography>
          </Box>
        ) : (
          visible.map((item, i) => {
            const meta = KIND_META[item.kind];
            const failedStatus = ['failed', 'error'].includes(item.status.toLowerCase());
            return (
              <Box
                key={`${item.kind}-${item.id}`}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 2,
                  px: 2.5, height: ROW_H, boxSizing: 'border-box',
                  borderBottom: i < visible.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
                  transition: `background ${motion.durationFast}`,
                  '&:hover': { backgroundColor: colors.bg },
                }}
              >
                {/* Thumbnail */}
                <Box sx={{ position: 'relative', width: 46, height: 46, borderRadius: '11px', overflow: 'hidden', backgroundColor: colors.bgDeep, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${colors.borderLight}` }}>
                  {item.thumbnail
                    ? <Box component="img" src={item.thumbnail} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <FormatGlyph format={item.format} color={meta.color} />
                  }
                </Box>

                {/* Name + context */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                    <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{item.name}</Typography>
                    {/* Type badge */}
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.375, px: 0.875, py: 0.25, borderRadius: '999px', backgroundColor: meta.color + '14', color: meta.color, fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0 }}>
                      {meta.icon} {meta.label}
                    </Box>
                  </Box>
                  <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{item.context || '—'}</Typography>
                </Box>

                {/* Format + size */}
                <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'right', flexShrink: 0, minWidth: 64 }}>
                  <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.format}</Typography>
                  {item.sizeBytes > 0 && (
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.125 }}>{formatBytes(item.sizeBytes)}</Typography>
                  )}
                </Box>

                {/* Status */}
                <Box sx={{
                  flexShrink: 0, minWidth: { xs: 'auto', sm: 86 }, textAlign: 'center', whiteSpace: 'nowrap',
                  px: 1.25, py: 0.5, borderRadius: '999px',
                  fontSize: '0.6875rem', fontWeight: 700, textTransform: 'capitalize',
                  backgroundColor: failedStatus ? 'rgba(220,38,38,0.1)' : item.status === 'published' ? 'rgba(5,150,105,0.1)' : colors.primarySoft,
                  color: failedStatus ? '#dc2626' : item.status === 'published' ? '#059669' : colors.primary,
                }}>
                  {item.status.replace('_', ' ')}
                </Box>
              </Box>
            );
          })
        )}
      </Box>

      {/* Minimalistic pagination */}
      {filtered.length > pageSize && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
          <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
            {start + 1}–{Math.min(start + pageSize, filtered.length)} of {filtered.length}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <PageBtn disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <ChevronLeftRounded sx={{ fontSize: 18 }} />
            </PageBtn>
            {!isMobile && Array.from({ length: pageCount }, (_, i) => i + 1).map(n => {
              const on = n === currentPage;
              return (
                <Box
                  key={n}
                  onClick={() => setPage(n)}
                  sx={{
                    minWidth: 30, height: 30, px: 0.75, borderRadius: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', userSelect: 'none',
                    fontSize: '0.8125rem', fontWeight: on ? 700 : 500,
                    color: on ? '#fff' : colors.textSecondary,
                    backgroundColor: on ? colors.primary : 'transparent',
                    border: `1px solid ${on ? colors.primary : colors.border}`,
                    transition: `all ${motion.durationFast} ${motion.easeOut}`,
                    '&:hover': { borderColor: colors.primary, color: on ? '#fff' : colors.primary },
                  }}
                >
                  {n}
                </Box>
              );
            })}
            <PageBtn disabled={currentPage >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
              <ChevronRightRounded sx={{ fontSize: 18 }} />
            </PageBtn>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function PageBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box
      onClick={disabled ? undefined : onClick}
      sx={{
        width: 30, height: 30, borderRadius: '8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${colors.border}`,
        color: disabled ? colors.textSubdued : colors.textSecondary,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `all ${motion.durationFast} ${motion.easeOut}`,
        '&:hover': disabled ? {} : { borderColor: colors.primary, color: colors.primary },
      }}
    >
      {children}
    </Box>
  );
}

function Metric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <Box sx={{
      borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`,
      p: { xs: 2, md: 2.25 }, overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: { xs: 'row', md: 'column' },
      alignItems: { xs: 'center', md: 'flex-start' },
      gap: { xs: 1.75, md: 1.25 },
      transition: `box-shadow 150ms, transform 150ms`,
      '&:hover': { boxShadow: `0 4px 16px rgba(0,0,0,0.07)`, transform: 'translateY(-1px)' },
    }}>
      {/* colored top bar on desktop */}
      <Box sx={{ display: { xs: 'none', md: 'block' }, position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '16px 16px 0 0', backgroundColor: color, opacity: 0.7 }} />
      <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, '& svg': { fontSize: 18 } }}>{icon}</Box>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: { xs: 'row', md: 'column' }, alignItems: { xs: 'center', md: 'flex-start' }, justifyContent: { xs: 'space-between', md: 'flex-start' }, gap: { xs: 0, md: 0.375 }, width: { md: '100%' }, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textMuted }}>{label}</Typography>
        <Typography sx={{ fontSize: { xs: '1.25rem', md: '1.5rem' }, fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</Typography>
      </Box>
    </Box>
  );
}
