import type { WfCapturePin } from '@store/workflowStore';
import type { MockCapture } from '@/data/mockData';

/** Human label for a capture point: Flat · Room (never "Pin N" on the map/gallery). */
export function formatPinLocationLabel(
  pin?: Pick<WfCapturePin, 'flatName' | 'roomName' | 'label'> | null,
  fallback = 'Capture point',
): string {
  if (!pin) return fallback;
  const flat = (pin.flatName || '').trim();
  const room = (pin.roomName || pin.label || '').trim();
  if (flat && room) return `${flat} · ${room}`;
  if (room) return room;
  if (flat) return flat;
  return fallback;
}

/**
 * Display tower names as "Tower 1" when stored as bare "1".
 * Leaves names that already include "Tower" (or other words) unchanged.
 */
export function formatTowerLabel(name?: string | null): string {
  const raw = (name || '').trim();
  if (!raw) return '';
  if (/^tower\b/i.test(raw)) return raw;
  return `Tower ${raw}`;
}

/**
 * Fill blank project/tower/floor labels using the owning pin + live store entities.
 * Older predefined-pin rooms omitted hierarchy ids, which produced "· · Floor 2".
 */
export function enrichCaptureLocation(
  capture: MockCapture,
  ctx: {
    pins: ReadonlyArray<WfCapturePin>;
    projects: ReadonlyArray<{ id: string; name: string }>;
    towers: ReadonlyArray<{ id: string; name: string; projectId: string }>;
    floors: ReadonlyArray<{ id: string; label: string; towerId: string }>;
  },
): MockCapture {
  const needsProject = !(capture.projectName || '').trim() || !(capture.projectId || '').trim();
  const needsTower = !(capture.towerName || '').trim() || !(capture.towerId || '').trim();
  const needsFloor = !(capture.floorLabel || '').trim();
  if (!needsProject && !needsTower && !needsFloor) return capture;

  const pin = ctx.pins.find(p => p.captureIds.includes(capture.id))
    ?? ctx.pins.find(p => p.roomId === capture.roomId);

  let projectId = (capture.projectId || '').trim() || pin?.projectId || '';
  let towerId = (capture.towerId || '').trim() || pin?.towerId || '';
  let floorId = pin?.floorId || '';

  const floor = floorId
    ? ctx.floors.find(f => f.id === floorId)
    : ctx.floors.find(f => f.label === capture.floorLabel && (!towerId || f.towerId === towerId));
  if (floor) {
    floorId = floor.id;
    if (!towerId) towerId = floor.towerId;
  }

  const tower = towerId
    ? ctx.towers.find(t => t.id === towerId)
    : undefined;
  if (tower && !projectId) projectId = tower.projectId;

  const project = projectId ? ctx.projects.find(p => p.id === projectId) : undefined;

  return {
    ...capture,
    projectId: projectId || capture.projectId,
    towerId: towerId || capture.towerId,
    projectName: (capture.projectName || '').trim() || project?.name || '',
    towerName: (capture.towerName || '').trim() || tower?.name || '',
    floorLabel: (capture.floorLabel || '').trim() || floor?.label || capture.floorLabel,
  };
}

/**
 * Field-engineer upload order 1..N for pins that have captures.
 * Sorted by earliest capture/upload time — NOT admin annotation sequenceNumber.
 * Same rule as Capture Workflow green pin numbers.
 */
export function uploadSequenceByPinId(
  pins: Array<{ id: string; sequenceNumber: number; captureIds: readonly string[] }>,
  captures: Array<{ id: string; capturedAt?: string; uploadedAt?: string }>,
): Map<string, number> {
  const captureTime = (captureIds: readonly string[]) => {
    let earliest = Number.POSITIVE_INFINITY;
    for (const cid of captureIds) {
      const c = captures.find(x => x.id === cid);
      if (!c) continue;
      const ms = Date.parse(c.capturedAt || c.uploadedAt || '');
      if (Number.isFinite(ms) && ms < earliest) earliest = ms;
    }
    return earliest;
  };
  const numbered = [...pins]
    .filter(p => p.captureIds.length > 0)
    .sort((a, b) => {
      const ta = captureTime(a.captureIds);
      const tb = captureTime(b.captureIds);
      if (ta !== tb) return ta - tb;
      return a.sequenceNumber - b.sequenceNumber;
    });
  return new Map(numbered.map((p, i) => [p.id, i + 1]));
}

/** Format capture date + time for timeline nodes. */
export function formatCaptureDateTime(
  ...candidates: Array<string | null | undefined>
): string {
  for (const raw of candidates) {
    const s = (raw || '').trim();
    if (!s) continue;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    // Already a display string like "12 Aug 2026, 10:30 am"
    return s;
  }
  return '';
}
