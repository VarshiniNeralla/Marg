import type {
  ProjectFloorRow, ProjectFloorStatus, ProjectRunState, ProjectRunStatus, ProjectTowerRow,
} from '@/services/constructionProgressService';

export interface ProjectHeadline {
  towersTotal: number;
  towersCompleted: number;
  flatsTotal: number;
  flatsCompleted: number;
  /** Flats completed as a share of all flats counted, 0-100. */
  flatsCompletedPct: number;
  /** Average progress of the flats counted (each floor's progress weighted by its number of flats), 0-100. */
  avgFlatProgressPct: number | null;
  floorsCounted: number;
}

/**
 * Project headline from towers and flats. Flats are only known for floors that have been analysed (a flat is
 * defined by the floor's analysis), so the flat totals cover those floors. A tower is complete when every one
 * of its floors is complete.
 */
export function projectHeadline(floors: ProjectFloorRow[], towers: ProjectTowerRow[]): ProjectHeadline {
  const counted = floors.filter(f => (f.flatsTotal ?? 0) > 0);
  const flatsTotal = counted.reduce((s, f) => s + (f.flatsTotal ?? 0), 0);
  const flatsCompleted = counted.reduce((s, f) => s + Math.min(f.flatsCompleted ?? 0, f.flatsTotal ?? 0), 0);
  const weighted = counted.reduce((s, f) => s + (f.progressPct ?? 0) * (f.flatsTotal ?? 0), 0);
  return {
    towersTotal: towers.length,
    towersCompleted: towers.filter(t => t.floors > 0 && t.completed >= t.floors).length,
    flatsTotal,
    flatsCompleted,
    flatsCompletedPct: flatsTotal ? (flatsCompleted / flatsTotal) * 100 : 0,
    avgFlatProgressPct: flatsTotal ? weighted / flatsTotal : null,
    floorsCounted: counted.length,
  };
}

/** Project ids that have at least one capture, so empty projects can be left out of pickers. */
export function projectIdsWithCaptures(captures: { projectId?: string }[]): Set<string> {
  const out = new Set<string>();
  for (const c of captures) if (c.projectId) out.add(c.projectId);
  return out;
}

export const FLOOR_STATUS_LABEL: Record<ProjectFloorStatus, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  not_started: 'Not started',
  no_photos: 'No photos',
  not_analysed: 'Not analysed',
};

export function floorStatusLabel(status: string): string {
  return FLOOR_STATUS_LABEL[status as ProjectFloorStatus] ?? status;
}

export type StatusFilter = 'all' | 'completed' | 'in_progress' | 'not_started' | 'no_photos';

export const FILTER_CHIPS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'not_started', label: 'Not started' },
  { id: 'no_photos', label: 'No photos' },
];

export function matchesFilter(row: ProjectFloorRow, filter: StatusFilter): boolean {
  return filter === 'all' || row.status === filter;
}

/** Counts per chip. Floors that have photos but were never analysed show under All only. */
export function filterCounts(rows: ProjectFloorRow[]): Record<StatusFilter, number> {
  const out: Record<StatusFilter, number> = { all: rows.length, completed: 0, in_progress: 0, not_started: 0, no_photos: 0 };
  for (const r of rows) if (r.status !== 'not_analysed' && r.status in out) out[r.status as StatusFilter] += 1;
  return out;
}

export type SortKey = 'floor' | 'tower' | 'status' | 'progress' | 'coverage' | 'lastAnalysed';
export type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<string, number> = {
  completed: 0, in_progress: 1, not_started: 2, not_analysed: 3, no_photos: 4,
};

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function time(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function cmpNullable(a: number | null, b: number | null, dir: SortDir): number {
  // Missing values always go last, whatever the direction.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function byTowerThenFloor(a: ProjectFloorRow, b: ProjectFloorRow): number {
  return natural.compare(a.towerName ?? '', b.towerName ?? '') || natural.compare(a.floorName ?? '', b.floorName ?? '');
}

export function sortFloors(rows: ProjectFloorRow[], key: SortKey, dir: SortDir): ProjectFloorRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'floor':
        return sign * natural.compare(a.floorName ?? '', b.floorName ?? '') || byTowerThenFloor(a, b);
      case 'tower':
        return sign * byTowerThenFloor(a, b);
      case 'status':
        return sign * ((STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)) || byTowerThenFloor(a, b);
      case 'progress':
        return cmpNullable(num(a.progressPct), num(b.progressPct), dir) || byTowerThenFloor(a, b);
      case 'coverage':
        return cmpNullable(num(a.coveragePct), num(b.coveragePct), dir) || byTowerThenFloor(a, b);
      case 'lastAnalysed':
        return cmpNullable(time(a.lastAnalysedAt), time(b.lastAnalysedAt), dir) || byTowerThenFloor(a, b);
      default:
        return 0;
    }
  });
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = [
  'Tower', 'Floor', 'Status', 'Progress %', 'Coverage %',
  'Rooms photographed', 'Rooms total', 'Captures', 'Last analysed',
];

function round1(v: number | null | undefined): string {
  const n = num(v);
  return n === null ? '' : String(Math.round(n * 10) / 10);
}

/** CSV text for the floor table (whatever rows are passed, in that order). */
export function buildFloorCsv(rows: ProjectFloorRow[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.towerName, r.floorName, floorStatusLabel(r.status), round1(r.progressPct), round1(r.coveragePct),
      r.roomsPhotographed ?? '', r.roomsTotal ?? '', r.capturesCount ?? '', r.lastAnalysedAt ?? '',
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function isRunActive(state: ProjectRunState | undefined | null): boolean {
  return state === 'queued' || state === 'running';
}

/** Share of floors finished in a project run, 0 to 100. Failed floors count as finished. */
export function runPct(run: ProjectRunStatus | null | undefined): number {
  const denom = run?.floorsQueued ?? run?.floorsTotal ?? 0;
  if (!run || !denom) return 0;
  const done = Math.min(denom, (run.floorsDone ?? 0) + (run.floorsFailed ?? 0));
  return Math.round((done / denom) * 100);
}

export function runLabel(run: ProjectRunStatus | null | undefined): string {
  const text = runLabelText(run);
  // A tower run covers one tower only; say so. Whole-project runs read as before.
  return text && run?.towerName ? `${run.towerName}: ${text}` : text;
}

function runLabelText(run: ProjectRunStatus | null | undefined): string {
  if (!run) return '';
  const done = (run.floorsDone ?? 0) + (run.floorsFailed ?? 0);
  const total = run.floorsQueued ?? run.floorsTotal;
  switch (run.state) {
    case 'queued': return 'Waiting to start';
    case 'running': return run.current?.floorName
      ? `Analysing ${run.current.floorName} (${done} of ${total} done)`
      : `${done} of ${total} floors done`;
    case 'completed': return `All ${total} floors analysed`;
    case 'partial': return `${run.floorsDone} floors analysed, ${run.floorsFailed} failed`;
    case 'failed': return 'The analysis failed';
    default: return '';
  }
}
