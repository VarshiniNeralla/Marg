import type { AuthUser } from './authStore';
import { useWorkflowStore } from './workflowStore';
import { useSettingsStore } from './settingsStore';
import { clearWriteQueue } from './writeQueue';
import { clearFileUploadQueue } from './fileUploadQueue';

const SESSION_STORAGE_PREFIXES = [
  'captures_',
  'tours_',
  'floorplans_',
];

const LOCAL_STORAGE_KEYS = [
  'sitesurelabs-last-capture-location-v1',
];

function clearSessionSelections(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (SESSION_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix))) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
  try {
    for (const key of LOCAL_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export function seedSettingsFromUser(user: Pick<AuthUser, 'name' | 'email' | 'org_name' | 'avatar_url'>): void {
  const settings = useSettingsStore.getState();
  settings.resetToDefaults();
  settings.patchAccount({
    name: user.name || '',
    email: user.email || '',
    phone: '',
    designation: '',
  });
  settings.patchOrganization({
    name: user.org_name || '',
    website: '',
    address: '',
  });
  settings.patchProfile({
    name: user.name || '',
    designation: '',
    phone: '',
    bio: '',
    avatarUrl: user.avatar_url || '',
  });
  settings.setTeamMembers([]);
}

export function clearClientSessionState(): void {
  useWorkflowStore.getState().resetToSeed();
  // Force WorkflowApiBootstrap to fetch a fresh snapshot on the next login
  // (retry nonce + loading), even when the same user re-authenticates.
  useWorkflowStore.getState().retryApiSnapshot();
  useSettingsStore.getState().resetToDefaults();
  clearWriteQueue();
  void clearFileUploadQueue();
  clearSessionSelections();
}
