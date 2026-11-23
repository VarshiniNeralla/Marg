import type {
  EvidenceDetail,
  FloorProgressSnapshot,
  RoomActivityAssessment,
} from '@/services/constructionProgressService';

/** Which evidence to show: an activity, optionally narrowed to one flat and/or one room. */
export interface EvidenceFilter {
  flat?: string;
  room?: string;
}

/** Address of the Evidence images page. `activityId` is required; flat and room are optional narrowing. */
export function evidencePath(floorId: string, activityId: string, filter: EvidenceFilter = {}): string {
  const q = new URLSearchParams({ activity: activityId });
  if (filter.flat) q.set('flat', filter.flat);
  if (filter.room) q.set('room', filter.room);
  return `/construction-progress/${encodeURIComponent(floorId)}/evidence?${q.toString()}`;
}

export interface EvidenceItem extends EvidenceDetail {
  /** Where the capture came from, for the card title even when the snapshot has no detail row for it. */
  flatName: string;
  roomName: string;
}

export interface CollectedEvidence {
  activityName: string;
  items: EvidenceItem[];
}

function detailsOf(a: RoomActivityAssessment, flatName: string, roomName: string): EvidenceItem[] {
  if (a.evidenceDetails && a.evidenceDetails.length > 0) {
    return a.evidenceDetails.map(d => ({
      ...d,
      flatName: d.flatName || flatName,
      roomName: d.roomName || roomName,
      views: d.views ?? [],
    }));
  }
  // Older snapshots only stored the capture ids.
  return (a.evidenceCaptureIds ?? []).filter(Boolean).map(id => ({
    captureId: id,
    role: a.detectionType === 'inferred' ? 'inferred' as const : 'direct' as const,
    flatName,
    roomName,
    views: [],
    capturedAt: a.lastCapturedAt ?? null,
    confidencePct: a.confidencePct ?? 0,
  }));
}

/**
 * Every capture the report used as evidence for one activity, in report order (flat by flat, room by room),
 * each capture once. Looks at the room level first because that is where ALL supporting captures are kept; the
 * floor-level card only ever lists a few. Falls back to the floor-level list for snapshots without room data.
 */
export function collectEvidence(
  snapshot: FloorProgressSnapshot | null | undefined,
  activityId: string,
  filter: EvidenceFilter = {},
): CollectedEvidence {
  const items: EvidenceItem[] = [];
  const seen = new Set<string>();
  let activityName = '';
  const push = (list: EvidenceItem[]) => {
    for (const item of list) {
      if (!item.captureId || seen.has(item.captureId)) continue;
      seen.add(item.captureId);
      items.push(item);
    }
  };

  for (const flat of snapshot?.flatProgress ?? []) {
    if (filter.flat && flat.flatName !== filter.flat) continue;
    for (const room of flat.rooms ?? []) {
      if (filter.room && room.roomName !== filter.room) continue;
      for (const a of room.activities ?? []) {
        if (a.activityId !== activityId) continue;
        if (!activityName) activityName = a.activityName;
        push(detailsOf(a, flat.flatName, room.roomName));
      }
    }
  }

  const floorLevel = (snapshot?.activities ?? []).find(a => a.activityId === activityId);
  if (!activityName && floorLevel) activityName = floorLevel.name;

  // Nothing at room level and no room was asked for: use what the floor-level card kept.
  if (items.length === 0 && !filter.flat && !filter.room && floorLevel) {
    const asRoom: RoomActivityAssessment = {
      activityId: floorLevel.activityId,
      activityName: floorLevel.name,
      completionPct: floorLevel.completionPct,
      confidencePct: floorLevel.confidencePct,
      evidenceCaptureIds: floorLevel.evidenceCaptureIds ?? [],
      evidenceDetails: floorLevel.evidenceDetails,
      detectionType: floorLevel.detectionType === 'inferred' ? 'inferred' : 'direct',
    };
    push(detailsOf(asRoom, '', ''));
  }
  return { activityName: activityName || 'Activity', items };
}

/** "Flat 101 · Bedroom 1", "Common Area · Lobby", or just the room, or "Capture" when nothing is known. */
export function evidenceTitle(item: Pick<EvidenceItem, 'flatName' | 'roomName'>): string {
  return [item.flatName, item.roomName].filter(Boolean).join(' · ') || 'Capture';
}

/** The rooms that have evidence, in order, with how many images each has. Used for the filter chips. */
export function roomsOf(items: EvidenceItem[]): { key: string; label: string; count: number }[] {
  const map = new Map<string, { key: string; label: string; count: number }>();
  for (const it of items) {
    const key = `${it.flatName}\u0000${it.roomName}`;
    const row = map.get(key) ?? { key, label: evidenceTitle(it), count: 0 };
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()];
}

export function roomKey(item: Pick<EvidenceItem, 'flatName' | 'roomName'>): string {
  return `${item.flatName}\u0000${item.roomName}`;
}
