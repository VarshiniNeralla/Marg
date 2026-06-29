import { useEffect, useRef } from 'react';
import { workflowApiService } from '@/services/workflowApiService';
import { useAuthStore } from './authStore';
import { useWorkflowStore } from './workflowStore';
import type { WorkflowDataState } from './workflowStore';

/**
 * Loads the authenticated organization's workflow data from the backend once.
 * For field engineers with assigned projects, the snapshot is scoped to only
 * those projects and their child entities before hydrating the store.
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

    workflowApiService
      .snapshot()
      .then(data => {
        if (assignedIds.length) {
          // Field engineer with assigned projects — scope the snapshot and treat
          // it as authoritative so stale data from a previous user is dropped.
          hydrateFromApi(scopeSnapshotToProjects(data, assignedIds), { replace: true });
        } else {
          hydrateFromApi(data);
        }
      })
      .catch(error => {
        loadedRef.current = false;
        loadedKeyRef.current = null;
        console.error('[workflow-api] snapshot failed', error);
      });
  }, [hydrateFromApi, isAuthenticated, user]);

  return null;
}
