import { useEffect, useRef } from 'react';
import { workflowApiService } from '@/services/workflowApiService';
import { useAuthStore } from './authStore';
import { useWorkflowStore } from './workflowStore';

/**
 * Loads the authenticated organization's workflow data from the backend once.
 * The Zustand store remains the UI cache, but backend data wins after login.
 */
export default function WorkflowApiBootstrap() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const hydrateFromApi = useWorkflowStore(s => s.hydrateFromApi);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || loadedRef.current) return;
    loadedRef.current = true;

    workflowApiService
      .snapshot()
      .then(data => hydrateFromApi(data))
      .catch(error => {
        loadedRef.current = false;
        console.error('[workflow-api] snapshot failed', error);
      });
  }, [hydrateFromApi, isAuthenticated]);

  return null;
}
