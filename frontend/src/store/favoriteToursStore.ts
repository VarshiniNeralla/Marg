import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { FAVORITE_TOURS_STORE_KEY, STORE_VERSION } from './persistence';

type FavoriteSet = Record<string, true>;

/** Stable empty map — never allocate a new `{}` in selectors (causes infinite re-renders). */
export const EMPTY_FAVORITES: FavoriteSet = Object.freeze({}) as FavoriteSet;

function idsToSet(ids: readonly string[]): FavoriteSet {
  const next: FavoriteSet = {};
  for (const id of ids) {
    const s = (id || '').trim();
    if (s) next[s] = true;
  }
  return next;
}

interface FavoriteToursState {
  /** Per-user favorites: userId → (tourId → true). Only that user sees their set. */
  byUser: Record<string, FavoriteSet>;
  /** True after localStorage rehydrate — guards against wiping favorites on early writes. */
  hasHydrated: boolean;
  toggleFavorite: (userId: string, tourId: string) => void;
  isFavorite: (userId: string, tourId: string) => boolean;
  removeFavorite: (userId: string, tourId: string) => void;
  replaceForUser: (userId: string, tourIds: readonly string[]) => void;
  favoritesFor: (userId: string) => FavoriteSet;
  /** Load from API (migrate local → server when server is empty). */
  syncFromServer: (userId: string) => Promise<void>;
}

function persistUserFavorites(userId: string, favSet: FavoriteSet) {
  const tourIds = Object.keys(favSet);
  // Dynamic import avoids circular deps (userService → apiClient → authStore → …).
  void import('@/services/userService')
    .then(({ userService }) => userService.setFavoriteTours(tourIds))
    .catch(() => {
      /* offline / auth race — local persist still holds the set */
    });
}

export const useFavoriteToursStore = create<FavoriteToursState>()(
  persist(
    (set, get) => ({
      byUser: {},
      hasHydrated: false,

      favoritesFor(userId) {
        if (!userId) return EMPTY_FAVORITES;
        return get().byUser[userId] ?? EMPTY_FAVORITES;
      },

      replaceForUser(userId, tourIds) {
        if (!userId) return;
        set(s => ({
          byUser: { ...s.byUser, [userId]: idsToSet(tourIds) },
        }));
      },

      toggleFavorite(userId, tourId) {
        if (!userId || !tourId) return;
        // Avoid clobbering rehydrated favorites with a pre-hydrate empty write.
        if (!get().hasHydrated) return;
        set(s => {
          const current = { ...(s.byUser[userId] ?? {}) };
          if (current[tourId]) delete current[tourId];
          else current[tourId] = true;
          persistUserFavorites(userId, current);
          return { byUser: { ...s.byUser, [userId]: current } };
        });
      },

      isFavorite(userId, tourId) {
        if (!userId || !tourId) return false;
        return !!get().byUser[userId]?.[tourId];
      },

      removeFavorite(userId, tourId) {
        if (!userId || !tourId) return;
        if (!get().hasHydrated) return;
        set(s => {
          const current = s.byUser[userId];
          if (!current?.[tourId]) return s;
          const next = { ...current };
          delete next[tourId];
          persistUserFavorites(userId, next);
          return { byUser: { ...s.byUser, [userId]: next } };
        });
      },

      async syncFromServer(userId) {
        if (!userId) return;

        const waitHydrated = () => new Promise<void>(resolve => {
          if (get().hasHydrated || useFavoriteToursStore.persist.hasHydrated()) {
            if (!get().hasHydrated) set({ hasHydrated: true });
            resolve();
            return;
          }
          const unsub = useFavoriteToursStore.persist.onFinishHydration(() => {
            unsub();
            set({ hasHydrated: true });
            resolve();
          });
          if (useFavoriteToursStore.persist.hasHydrated()) {
            unsub();
            set({ hasHydrated: true });
            resolve();
          }
        });

        await waitHydrated();

        try {
          const { userService } = await import('@/services/userService');
          const serverIds = await userService.getFavoriteTours();
          const localIds = Object.keys(get().byUser[userId] ?? {});

          // First login on this account with only local favorites → push up.
          if (serverIds.length === 0 && localIds.length > 0) {
            await userService.setFavoriteTours(localIds);
            return;
          }

          // Server is source of truth once populated.
          get().replaceForUser(userId, serverIds);
        } catch {
          /* keep local favorites when offline */
        }
      },
    }),
    {
      name: FAVORITE_TOURS_STORE_KEY,
      version: STORE_VERSION.favoriteTours,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ byUser: s.byUser }),
      migrate: (persisted) => {
        // v1 stored a shared `favorites` map — that leaked across roles. Drop it.
        const raw = persisted as { byUser?: Record<string, FavoriteSet>; favorites?: FavoriteSet } | null;
        return { byUser: raw?.byUser ?? {} };
      },
      onRehydrateStorage: () => () => {
        useFavoriteToursStore.setState({ hasHydrated: true });
      },
    },
  ),
);

// If persist finished before onRehydrateStorage was wired (HMR / race), mark ready.
if (typeof window !== 'undefined') {
  queueMicrotask(() => {
    if (useFavoriteToursStore.persist.hasHydrated()) {
      useFavoriteToursStore.setState({ hasHydrated: true });
    }
  });
}
