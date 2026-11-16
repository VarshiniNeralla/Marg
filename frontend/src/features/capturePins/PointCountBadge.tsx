import React, { useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { PlaceRounded, WarningAmberRounded } from '@mui/icons-material';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { findDuplicateGroups, type PinLike } from '@/utils/pinDuplicates';

interface Props {
  pins: readonly PinLike[];
  /** Admin / manager: may review and remove empty stacked duplicates. */
  canManage: boolean;
  /** Remove these points (only ever empty duplicates). */
  onRemove: (pinIds: string[]) => void;
}

/**
 * The honest point count for this floor plan: stacked duplicates count once, and if any exist a person can review them
 * and remove the EMPTY extras on purpose. A point with photos is never offered for removal, and nothing happens on its own.
 */
export default function PointCountBadge({ pins, canManage, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => findDuplicateGroups(pins), [pins]);
  const extras = groups.reduce((n, g) => n + g.extras.length, 0);
  const removable = useMemo(() => groups.flatMap(g => g.removable.map(p => p.id)), [groups]);
  const distinct = pins.length - extras;
  const blocked = extras - removable.length;      // extras that have photos: kept, need a person's decision

  return (
    <>
      <Box
        data-no-pan
        data-testid="point-count"
        onClick={extras > 0 && canManage ? () => setOpen(true) : undefined}
        sx={{
          position: 'absolute', left: 12, bottom: 12, zIndex: 20, display: 'inline-flex', alignItems: 'center', gap: 0.75,
          px: 1.25, py: 0.625, borderRadius: '999px', backgroundColor: 'rgba(255,255,255,0.96)',
          boxShadow: '0 1px 6px rgba(15,23,42,0.18)', fontSize: '0.75rem', fontWeight: 700, color: '#111827',
          cursor: extras > 0 && canManage ? 'pointer' : 'default', pointerEvents: 'auto',
        }}
      >
        <PlaceRounded sx={{ fontSize: 15, color: '#2563eb' }} />
        {distinct} capture point{distinct === 1 ? '' : 's'}
        {extras > 0 && (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: '#c2410c', fontWeight: 700 }}>
            <WarningAmberRounded sx={{ fontSize: 14 }} /> {extras} stacked duplicate{extras === 1 ? '' : 's'}{canManage ? ' · review' : ''}
          </Box>
        )}
      </Box>

      <ConfirmDialog
        open={open}
        title="Stacked duplicate points"
        description={
          `${extras} point${extras === 1 ? ' is' : 's are'} sitting exactly on top of another point with the same Flat and Room, so ${extras === 1 ? 'it looks' : 'they look'} like one marker but ${extras === 1 ? 'is' : 'are'} counted separately `
          + `(${pins.length} records, ${distinct} real points). `
          + (removable.length > 0
            ? `Remove ${removable.length} empty extra${removable.length === 1 ? '' : 's'}? The point that stays is the one with photos, otherwise the oldest. Points with photos are never removed.`
            : 'None of the extras can be removed here because they have photos.')
          + (blocked > 0 && removable.length > 0 ? ` ${blocked} extra${blocked === 1 ? ' has' : 's have'} photos and will stay.` : '')
        }
        confirmLabel={removable.length > 0 ? `Remove ${removable.length} empty duplicate${removable.length === 1 ? '' : 's'}` : 'OK'}
        destructive={removable.length > 0}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          if (removable.length > 0) onRemove(removable);
        }}
      />
    </>
  );
}
