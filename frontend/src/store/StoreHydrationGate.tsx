import React, { useEffect, useState } from 'react';
import axios from 'axios';
import LoadingScreen from '@shared/components/LoadingScreen/LoadingScreen';
import { useAuthStore } from './authStore';
import { useWorkflowStore } from './workflowStore';
import { useSettingsStore } from './settingsStore';
import { useUserStore } from './userStore';

const BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000';

async function tryRestoreToken(): Promise<void> {
  const { isAuthenticated, accessToken, setAccessToken, clearAuth } = useAuthStore.getState();
  if (!isAuthenticated || accessToken) return;
  try {
    const { data } = await axios.post<{ data: { access_token: string } }>(
      `${BASE_URL}/api/v1/auth/refresh`,
      {},
      { withCredentials: true }
    );
    setAccessToken(data.data.access_token);
  } catch {
    clearAuth();
  }
}

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
 *  then restore the access token via the httpOnly refresh cookie if needed. */
export default function StoreHydrationGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all(STORES.map(waitForHydration))
      .then(() => tryRestoreToken())
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <LoadingScreen />;
  return <>{children}</>;
}
