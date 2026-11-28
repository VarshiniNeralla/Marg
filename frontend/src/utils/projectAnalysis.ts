import type {
  ProjectFloorRow, ProjectFloorStatus, ProjectRunState, ProjectRunStatus, ProjectTowerRow,
} from '@/services/constructionProgressService';

export interface ProjectHeadline {
  towersTotal: number;
  towersCompleted: number;
  floorsTotal: number;
  floorsCompleted: number;
  floorsInProgress: number;
  /** Floors with a result (completed, in progress or not started). */
  floorsAnalysed: number;
  /** Average progress of the analysed floors, 0-100, or null when none has been analysed. */
  analysedAvgPct: number | null;
  /** Average progress of the floors that are in progress, or null when there are none. */
  inProgressAvgPct: number | null;
}

const isAnalysed = (f: ProjectFloorRow) =>
  f.status !== 'no_photos' && f.status !== 'not_analysed' && typeof f.progressPct === 'number';
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Project headline in towers and floors. The average counts only floors that have a result, so floors nobody has
 * photographed yet do not drag a running project down to 0%. A tower is complete when every one of its floors is.
 */
export function projectHeadline(floors: ProjectFloorRow[], towers: ProjectTowerRow[]): ProjectHeadline {
  const analysed = floors.filter(isAnalysed);
  const inProgress = floors.filter(f => f.status === 'in_progress' && typeof f.progressPct === 'number');
  return {
    towersTotal: towers.length,
    towersCompleted: towers.filter(t => t.floors > 0 && t.completed >= t.floors).length,
    floorsTotal: floors.length,
    floorsCompleted: floors.filter(f => f.status === 'completed').length,
    floorsInProgress: floors.filter(f => f.status === 'in_progress').length,
    floorsAnalysed: analysed.length,
    analysedAvgPct: mean(analysed.map(f => f.progressPct as number)),
    inProgressAvgPct: mean(inProgress.map(f => f.progressPct as number)),
  };
}

export interface TowerProgress {
  towerId: string;
  towerName: string;
  floors: number;
  floorsAnalysed: number;
  floorsCompleted: number;
  floorsInProgress: number;
  /** Average progress of this tower's analysed floors, or null when none has been analysed. */
  progressPct: number | null;
}

/** Progress of each tower, from its analysed floors, in the order the towers were given. */
export function towerProgress(floors: ProjectFloorRow[], towers: ProjectTowerRow[]): TowerProgress[] {
  return towers.map(t => {
    const mine = floors.filter(f => f.towerId === t.towerId);
    const analysed = mine.filter(isAnalysed);
    return {
      towerId: t.towerId,
      towerName: t.towerName,
      floors: mine.length || t.floors,
      floorsAnalysed: analysed.length,
      floorsCompleted: mine.filter(f => f.status === 'completed').length,
      floorsInProgress: mine.filter(f => f.status === 'in_progress').length,
      progressPct: mean(analysed.map(f => f.progressPct as number)),
    };
  });
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
