/**
 * Project coverage = the average coverage of EVERY floor of the project.
 * A floor's coverage is the share of its capture points that have at least one capture; a floor with no capture
 * points (not mapped / not annotated yet) counts as 0%, so it lowers the project figure instead of being skipped.
 */
export interface CoveragePin { floorId: string; captureIds?: string[] }

export function computeProjectCoverage(
  floorIds: string[],
  pins: CoveragePin[],
): { score: number; floors: number; startedFloors: number } {
  const byFloor = new Map<string, { total: number; captured: number }>();
  for (const pin of pins) {
    const row = byFloor.get(pin.floorId) ?? { total: 0, captured: 0 };
    row.total += 1;
    if ((pin.captureIds?.length ?? 0) > 0) row.captured += 1;
    byFloor.set(pin.floorId, row);
  }
  let sum = 0;
  let startedFloors = 0;
  for (const id of floorIds) {
    const row = byFloor.get(id);
    const pct = row && row.total > 0 ? (row.captured / row.total) * 100 : 0;
    if (pct > 0) startedFloors += 1;
    sum += pct;
  }
  return { score: floorIds.length ? Math.round(sum / floorIds.length) : 0, floors: floorIds.length, startedFloors };
}
