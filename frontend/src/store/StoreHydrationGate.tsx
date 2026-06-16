import React, { useEffect, useState } from 'react';
import LoadingScreen from '@shared/components/LoadingScreen/LoadingScreen';
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

/** Block render until all persisted stores have rehydrated from localStorage. */
export default function StoreHydrationGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(() => STORES.every(s => s.persist.hasHydrated()));

  useEffect(() => {
    if (ready) return;
    Promise.all(STORES.map(waitForHydration)).then(() => setReady(true));
  }, [ready]);

  if (!ready) return <LoadingScreen />;
  return <>{children}</>;
}
