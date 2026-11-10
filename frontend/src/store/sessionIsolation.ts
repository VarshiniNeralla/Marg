import { queryClient } from '@/services/queryClient';
import type { AuthUser } from './authStore';
import { useWorkflowStore } from './workflowStore';
import { useSettingsStore } from './settingsStore';
import { clearWriteQueue, exportWriteQueueRaw, pendingWriteCount, replaceWriteQueueFromRaw } from './writeQueue';
import { claimUnownedPhotos, clearFileUploadQueue, photosLockedToOthers, waitingPhotoCount } from './fileUploadQueue';
import { WORKFLOW_STORE_KEY } from './persistence';
import { flushAllDebouncedStorage } from './safeStorage';
import {
  dropParkedWork, parkWork, planSessionTransition, readLastUserId, readParkedWork, writeLastUserId,
} from './uploadOwnership';

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

/** Anything on this phone that has not reached the server yet: photos, or pin/capture changes. */
export async function hasWaitingWork(): Promise<boolean> {
  return (await waitingPhotoCount()) > 0 || pendingWriteCount() > 0;
}

function clearCachesAndSelections(): void {
  // Cached server answers belong to the user who is leaving; the next user must start from nothing.
  queryClient.clear();
  clearSessionSelections();
}

/**
 * Logout, or the server confirming the session is over.
 *
 * Used to wipe the store, the change queue and every waiting photo. Now it only does that when NOTHING is waiting.
 * With anything waiting, the photos, their files, the unsent changes and the floors they belong to all stay exactly
 * as they are, ready for the same person's next login.
 */
export async function endClientSession(event: 'logout' | 'expired'): Promise<void> {
  const waiting = await hasWaitingWork();
  const plan = planSessionTransition({ event, ownerId: readLastUserId(localStorage), hasWaitingWork: waiting });
  if (plan.wipe) {
    useWorkflowStore.getState().resetToSeed();
    useWorkflowStore.getState().retryApiSnapshot();
    useSettingsStore.getState().resetToDefaults();
    clearWriteQueue();
    await clearFileUploadQueue();
  }
  clearCachesAndSelections();
}

export interface LoginTransitionPreview {
  /** A different person's photos are waiting on this phone. */
  lockedPhotos: number;
  differentPerson: boolean;
}

/** Look before a login takes effect, so the screen can tell the person what will happen. Changes nothing. */
export async function previewLoginTransition(newUserId: string): Promise<LoginTransitionPreview> {
  const owner = readLastUserId(localStorage);
  const locked = await photosLockedToOthers(newUserId);
  return { lockedPhotos: locked, differentPerson: !!owner && owner !== newUserId };
}

/**
 * A person signed in. Keeps everything waiting for the same person; parks (never deletes) a different person's
 * waiting work and hands back anything parked for the person signing in.
 * Returns false only if the previous person's work could not be safely copied aside, in which case NOTHING was
 * changed and the login must not go on.
 */
export async function startClientSession(newUserId: string): Promise<boolean> {
  const owner = readLastUserId(localStorage);
  const waiting = await hasWaitingWork();
  const plan = planSessionTransition({ event: 'login', ownerId: owner, newUserId, hasWaitingWork: waiting });

  if (plan.parkPrevious && owner) {
    // Pin every older photo to its person first, so nothing is ever attributed to the wrong login.
    await claimUnownedPhotos(owner);
    flushAllDebouncedStorage();
    const ok = parkWork(localStorage, owner, {
      workflow: localStorage.getItem(WORKFLOW_STORE_KEY),
      writes: exportWriteQueueRaw(),
    });
    if (!ok) return false;
    useWorkflowStore.getState().resetToSeed();
    clearWriteQueue();
  } else if (plan.wipe) {
    useWorkflowStore.getState().resetToSeed();
    clearWriteQueue();
    await clearFileUploadQueue();
  }

  // Force WorkflowApiBootstrap to fetch a fresh snapshot (retry nonce + loading), even when the same user
  // re-authenticates. Waiting pins are protected inside the snapshot merge.
  useWorkflowStore.getState().retryApiSnapshot();
  useSettingsStore.getState().resetToDefaults();
  clearCachesAndSelections();

  if (plan.restoreForNewUser) {
    const parked = readParkedWork(localStorage, newUserId);
    if (parked) {
      flushAllDebouncedStorage();
      try {
        if (parked.workflow) localStorage.setItem(WORKFLOW_STORE_KEY, parked.workflow);
        await useWorkflowStore.persist.rehydrate();
        replaceWriteQueueFromRaw(parked.writes);
        useWorkflowStore.getState().retryApiSnapshot();
        dropParkedWork(localStorage, newUserId);
      } catch {
        /* the parked copy is kept; nothing is lost if handing it back fails */
      }
    }
  }

  writeLastUserId(localStorage, newUserId);
  return true;
}
