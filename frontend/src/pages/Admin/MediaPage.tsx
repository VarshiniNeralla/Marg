import type React from 'react';
import { Box, Grid, Typography } from '@mui/material';
import { CloudUploadRounded, PanoramaRounded, WarningAmberRounded, StorageRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';

type MediaAsset = {
  original_filename?: string;
  original_url?: string;
  thumbnail_url?: string;
  public_id?: string;
  format?: string;
  size?: number;
  uploaded_at?: string;
  processing_status?: string;
  processingStatus?: string;
};

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB';
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export default function MediaPage() {
  const captures = useWorkflowStore(s => s.captures);
  const tours = useWorkflowStore(s => s.tours);
  const floorPlans = useWorkflowStore(s => s.floorPlans);

  const captureAssets = captures.flatMap(c => ((c as typeof c & { mediaAssets?: MediaAsset[] }).mediaAssets ?? []));
  const floorPlanAssets = floorPlans.flatMap(fp => ((fp as typeof fp & { mediaAssets?: MediaAsset[] }).mediaAssets ?? []));
  const assets = [...captureAssets, ...floorPlanAssets];
  const storageBytes = assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0);
  const failed = assets.filter(asset => ['failed', 'error'].includes(asset.processing_status ?? asset.processingStatus ?? ''));
  const recent = [...assets].sort((a, b) => String(b.uploaded_at ?? '').localeCompare(String(a.uploaded_at ?? ''))).slice(0, 8);

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em' }}>
          Media Storage
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Cloudinary-backed uploads and processing status</Typography>
      </Box>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Metric icon={<StorageRounded />} label="Storage usage" value={formatBytes(storageBytes)} />
        <Metric icon={<CloudUploadRounded />} label="Total captures" value={String(captures.length)} />
        <Metric icon={<PanoramaRounded />} label="Total panoramas" value={String(captureAssets.length || tours.length)} />
        <Metric icon={<WarningAmberRounded />} label="Failed processing" value={String(failed.length)} />
      </Grid>

      <Box sx={{ borderRadius: '18px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
        <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${colors.borderLight}` }}>
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>Recent uploads</Typography>
        </Box>
        {recent.length === 0 ? (
          <Typography sx={{ p: 2.5, fontSize: '0.875rem', color: colors.textMuted }}>No Cloudinary uploads yet.</Typography>
        ) : (
          recent.map(asset => (
            <Box key={asset.public_id ?? asset.original_url} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.5, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
              <Box sx={{ width: 42, height: 42, borderRadius: '10px', overflow: 'hidden', backgroundColor: colors.bgDeep, flexShrink: 0 }}>
                {asset.thumbnail_url && <Box component="img" src={asset.thumbnail_url} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{asset.original_filename ?? asset.public_id}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{asset.format?.toUpperCase() ?? 'FILE'} · {formatBytes(asset.size ?? 0)}</Typography>
              </Box>
              <Box sx={{ px: 1, py: 0.375, borderRadius: '999px', backgroundColor: colors.primarySoft, color: colors.primary, fontSize: '0.6875rem', fontWeight: 700, textTransform: 'capitalize' }}>
                {asset.processing_status ?? asset.processingStatus ?? 'uploaded'}
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, p: 2.5, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
        <Box sx={{ color: colors.primary, mb: 1, '& svg': { fontSize: 22 } }}>{icon}</Box>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em' }}>{value}</Typography>
        <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{label}</Typography>
      </Box>
    </Grid>
  );
}
