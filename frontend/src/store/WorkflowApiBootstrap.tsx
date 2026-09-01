import { useEffect, useRef } from 'react';
import { workflowApiService } from '@/services/workflowApiService';
import { useAuthStore } from './authStore';
import { useWorkflowStore } from './workflowStore';
import type { WorkflowDataState } from './workflowStore';
import { useFavoriteToursStore } from './favoriteToursStore';
import { filterOwnCaptures, filterOwnTours } from '@/utils/captureOwnership';
import { flushWriteQueue } from './writeQueue';
import { flushFileUploadQueue, reconcileStitchedCaptureMedia } from './fileUploadQueue';

/**
 * Scopes captures / pins / floor plans / tours to an engineer's assigned projects
 * for day-to-day capture work. Captures and tours are also filtered to the signed-in
 * engineer; admins and managers receive the org-wide snapshot.
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
    tours: (data.tours ?? []).filter(t => projectSet.has(t.projectId)),
    floorPlans: (data.floorPlans ?? []).filter(fp => projectSet.has(fp.projectId) && towerSet.has(fp.towerId) && floorSet.has(fp.floorId)),
    capturePins: (data.capturePins ?? []).filter(pin => projectSet.has(pin.projectId) && floorSet.has(pin.floorId)),
    defects: (data.defects ?? []).filter(d => projectSet.has(d.projectId)),
  };
}

export default function WorkflowApiBootstrap() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const user = useAuthStore(s => s.user);
  const hydrateFromApi = useWorkflowStore(s => s.hydrateFromApi);
  const setApiSnapshotError = useWorkflowStore(s => s.setApiSnapshotError);
  const setApiSnapshotStatus = useWorkflowStore(s => s.setApiSnapshotStatus);
  const retryNonce = useWorkflowStore(s => s.apiSnapshotRetryNonce);
  const loadedKeyRef = useRef<string | null>(null);
  const requestGenRef = useRef(0);

  useEffect(() => {
    // Logout / session clear: drop the gate so the next login always re-fetches.
    // A prior bug left loadedRef=true across logout→login, so the dashboard
    // stayed at zeros after clearClientSessionState() wiped the store.
    if (!isAuthenticated || !user) {
      loadedKeyRef.current = null;
      requestGenRef.current += 1;
      return;
    }

    const assignedIds = user.role === 'field_engineer' ? (user.assignedProjectIds ?? []) : [];
    const loadKey = `${user.id}|${[...assignedIds].sort().join(',')}|${retryNonce}`;

    if (loadedKeyRef.current === loadKey) return;
    loadedKeyRef.current = loadKey;
    const gen = ++requestGenRef.current;

    setApiSnapshotStatus('loading');
    setApiSnapshotError(null);

    flushWriteQueue();
    flushFileUploadQueue();

    void useFavoriteToursStore.getState().syncFromServer(user.id);

    workflowApiService
      .snapshot()
      .then(data => {
        if (gen !== requestGenRef.current) return; // stale response after logout/re-login
        const scoped = assignedIds.length
          ? scopeSnapshotToProjects(data, assignedIds)
          : data;
        const payload = user.role === 'field_engineer'
          ? {
              ...scoped,
              captures: filterOwnCaptures(scoped.captures ?? [], user),
              tours: filterOwnTours(scoped.tours ?? [], user),
            }
          : scoped;
        hydrateFromApi(payload, { replace: true });
        setApiSnapshotError(null);
        setApiSnapshotStatus('ready');
        flushWriteQueue();
        flushFileUploadQueue();
        void reconcileStitchedCaptureMedia();
      })
      .catch(error => {
        if (gen !== requestGenRef.current) return;
        loadedKeyRef.current = null;
        const message = error instanceof Error
          ? error.message
          : 'Failed to load workspace data';
        setApiSnapshotError(message || 'Failed to load workspace data');
        setApiSnapshotStatus('error');
        console.error('[workflow-api] snapshot failed', error);
      });
  }, [
    hydrateFromApi,
    isAuthenticated,
    user,
    retryNonce,
    setApiSnapshotError,
    setApiSnapshotStatus,
  ]);

  return null;
}
