import { useEffect, useRef } from 'react';
import { workflowApiService } from '@/services/workflowApiService';
import { useAuthStore } from './authStore';
import { useWorkflowStore } from './workflowStore';
import type { WorkflowDataState } from './workflowStore';
import { useFavoriteToursStore } from './favoriteToursStore';
import { flushWriteQueue } from './writeQueue';
import { flushFileUploadQueue } from './fileUploadQueue';

/**
 * Scopes captures / pins / floor plans to an engineer's assigned projects for
 * day-to-day capture work. Tours are intentionally left alone — Virtual Tours
 * must be identical for admin, manager, and engineer (engineer-uploaded
 * walkthroughs only; filtering happens in hydrate).
 */
function scopeSnapshotToProjects(
  data: Partial<WorkflowDataState>,
  assignedProjectIds: string[],
): Partial<WorkflowDataState> {
  if (!assignedProjectIds.length) return data;

  const allowed = new Set(assignedProjectIds);
  const projects = (data.projects ?? []).filter(p => allowed.has(p.id));
  const projectSet = new Set(projects.map(p => p.id));
  const towers = (data.towers ?? []).filter(t => projectSet.has(t.projectId));
  const towerSet = new Set(towers.map(t => t.id));
  const floors = (data.floors ?? []).filter(f => towerSet.has(f.towerId));
  const floorSet = new Set(floors.map(f => f.id));
  const flats = (data.flats ?? []).filter(f => floorSet.has(f.floorId));
  const flatSet = new Set(flats.map(f => f.id));
  const rooms = (data.rooms ?? []).filter(r => flatSet.has(r.flatId) || floorSet.has(r.floorId));
  const roomSet = new Set(rooms.map(r => r.id));

  return {
    ...data,
    projects,
    towers,
    floors,
    flats,
    rooms,
    captures: (data.captures ?? []).filter(c => projectSet.has(c.projectId) || roomSet.has(c.roomId)),
    // Keep the org-wide tour list so every role sees the same Virtual Tours catalog.
    tours: data.tours ?? [],
    floorPlans: (data.floorPlans ?? []).filter(fp => projectSet.has(fp.projectId) && towerSet.has(fp.towerId) && floorSet.has(fp.floorId)),
    capturePins: (data.capturePins ?? []).filter(pin => projectSet.has(pin.projectId) && floorSet.has(pin.floorId)),
    defects: (data.defects ?? []).filter(d => projectSet.has(d.projectId)),
  };
}

export default function WorkflowApiBootstrap() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const user = useAuthStore(s => s.user);
  const hydrateFromApi = useWorkflowStore(s => s.hydrateFromApi);
  const loadedRef = useRef(false);
  // Track the key we last loaded for: userId + sorted assigned project IDs
  // so the store re-scopes when assignments arrive after the initial login render
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const assignedIds = user.role === 'field_engineer' ? (user.assignedProjectIds ?? []) : [];
    const loadKey = `${user.id}|${[...assignedIds].sort().join(',')}`;

    // Re-fetch when the user changes or when their project assignments are populated
    if (loadedRef.current && loadedKeyRef.current === loadKey) return;
    loadedRef.current = true;
    loadedKeyRef.current = loadKey;

    // Replay any writes queued before this session was authenticated (e.g. a pin
    // placed while briefly offline, or just after login before the token landed).
    // Also replay any queued PHOTO uploads for the same reason: fileUploadQueue's
    // own flush() silently no-ops (and never starts its retry poll timer) if
    // isAuthenticated was false the instant it ran — e.g. a capture taken right
    // as an access token expired, mid-refresh. Without a flush retriggered here,
    // that photo would sit at 'queued' forever with nothing to wake it back up
    // except an unrelated online/focus/network event (reproduced: server logs
    // showed a capture's pin/room/audit-log writes all landing normally around
    // an auth/refresh, but its /uploads/captures POST never being sent at all).
    flushWriteQueue();
    flushFileUploadQueue();

    // Favorites live on the user document so they survive logout, device
    // switches, and localStorage quota loss — sync after auth is ready.
    void useFavoriteToursStore.getState().syncFromServer(user.id);

    workflowApiService
      .snapshot()
      .then(data => {
        const payload = assignedIds.length
          ? scopeSnapshotToProjects(data, assignedIds)
          : data;
        // Always replace so a previous role/session can't leave stale tours or
        // captures in the shared localStorage-backed store.
        hydrateFromApi(payload, { replace: true });
        flushWriteQueue();
        flushFileUploadQueue();
      })
      .catch(error => {
        loadedRef.current = false;
        loadedKeyRef.current = null;
        console.error('[workflow-api] snapshot failed', error);
      });
  }, [hydrateFromApi, isAuthenticated, user]);

  return null;
}
