import type { SxProps, Theme } from '@mui/material/styles';

export type FloorOption = { id: string; label: string };

/** Equal-width filter pills on desktop; stacked full-width on mobile. */
export function locationFilterToolbarSx(filterCount: number): {
  row: SxProps<Theme>;
  group: SxProps<Theme>;
  pill: SxProps<Theme>;
} {
  return {
    row: {
      display: 'flex',
      flexDirection: { xs: 'column', md: 'row' },
      alignItems: { xs: 'stretch', md: 'center' },
      gap: { xs: 1, md: 1.5 },
      mb: 3,
    },
    group: {
      display: 'grid',
      gridTemplateColumns: {
        xs: '1fr',
        md: `repeat(${filterCount}, minmax(0, 1fr))`,
      },
      gap: { xs: 0.75, md: 1.5 },
      flex: { md: filterCount > 1 ? 1 : 'initial' },
      width: '100%',
      minWidth: 0,
    },
    pill: {
      minWidth: 0,
      width: '100%',
    },
  };
}

/** Full-width scrollable dropdown on mobile; fixed width on desktop. */
export function locationFilterMenuPaperSx(
  desktopWidth: number,
  borderColor: string,
): SxProps<Theme> {
  return {
    mt: 1,
    width: { xs: 'calc(100vw - 32px)', md: desktopWidth },
    minWidth: { xs: 'calc(100vw - 32px)', md: desktopWidth },
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'min(70vh, 520px)',
    borderRadius: '14px',
    boxShadow: '0 12px 40px rgba(15,23,42,0.14)',
    border: `1px solid ${borderColor}`,
    p: 0.75,
    '& .MuiList-root': {
      maxHeight: 'min(60vh, 440px)',
      overflowY: 'auto',
      py: 0,
    },
  };
}

export function floorSelectionLabel(floorId: string, options: FloorOption[]): string | null {
  if (!floorId || floorId === 'all') return null;
  if (floorId.startsWith('label:')) return floorId.slice(6);
  return options.find(f => f.id === floorId)?.label ?? null;
}

/** When tower is "all", dedupe floors by label across towers. */
export function buildFloorOptions(
  allFloors: { id: string; towerId: string; label: string }[],
  towerId: string,
  towerIds: Set<string>,
): FloorOption[] {
  const sorted = allFloors
    .filter(f => towerIds.has(f.towerId))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  if (towerId === 'all') {
    const seen = new Set<string>();
    const options: FloorOption[] = [];
    for (const floor of sorted) {
      if (seen.has(floor.label)) continue;
      seen.add(floor.label);
      options.push({ id: `label:${floor.label}`, label: floor.label });
    }
    return options;
  }

  return sorted
    .filter(f => f.towerId === towerId)
    .map(f => ({ id: f.id, label: f.label }));
}
