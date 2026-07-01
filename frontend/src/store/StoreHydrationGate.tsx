import React, { useEffect, useState } from 'react';
import LoadingScreen from '@shared/components/LoadingScreen/LoadingScreen';
import { restoreSessionFromCookie } from '@/services/sessionRefresh';
import { useAuthStore } from './authStore';
import { useWorkflowStore } from './workflowStore';
import { useSettingsStore } from './settingsStore';
import { useUserStore } from './userStore';

type PersistStore = {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (fn: () => void) => () => void;
  };
};

const STORES: PersistStore[] = [
  useAuthStore,
  useWorkflowStore,
  useSettingsStore,
  useUserStore,
];

function waitForHydration(store: PersistStore): Promise<void> {
  return new Promise(resolve => {
    if (store.persist.hasHydrated()) {
      resolve();
      return;
    }
    const unsub = store.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}

/** Block render until all persisted stores have rehydrated from localStorage,
 *  then restore the access token via the httpOnly refresh cookie when a live
 *  session was persisted. Guests skip the refresh call entirely. */
export default function StoreHydrationGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all(STORES.map(waitForHydration))
      .then(() => restoreSessionFromCookie())
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <LoadingScreen />;
  return <>{children}</>;
}
