import { clearAllPersistedStorage } from './persistence';
import { useAuthStore } from './authStore';
import { useWorkflowStore } from './workflowStore';
import { useSettingsStore } from './settingsStore';
import { useUserStore } from './userStore';

/**
 * Clears all persisted application state and reloads to seeded defaults.
 * Called from Settings → Advanced → Reset Application Data.
 */
export function resetApplicationData(): void {
  useWorkflowStore.getState().resetToSeed();
  useAuthStore.getState().clearAuth();
  useSettingsStore.getState().resetToDefaults();
  useUserStore.getState().clear();
  clearAllPersistedStorage();
  window.location.reload();
}
