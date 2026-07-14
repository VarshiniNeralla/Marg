import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { FAVORITE_TOURS_STORE_KEY, STORE_VERSION } from './persistence';

type FavoriteSet = Record<string, true>;

/** Stable empty map — never allocate a new `{}` in selectors (causes infinite re-renders). */
export const EMPTY_FAVORITES: FavoriteSet = Object.freeze({}) as FavoriteSet;

interface FavoriteToursState {
  /** Per-user favorites: userId → (tourId → true). Only that user sees their set. */
  byUser: Record<string, FavoriteSet>;
  toggleFavorite: (userId: string, tourId: string) => void;
  isFavorite: (userId: string, tourId: string) => boolean;
  removeFavorite: (userId: string, tourId: string) => void;
  favoritesFor: (userId: string) => FavoriteSet;
}

export const useFavoriteToursStore = create<FavoriteToursState>()(
  persist(
    (set, get) => ({
      byUser: {},

      favoritesFor(userId) {
        if (!userId) return EMPTY_FAVORITES;
        return get().byUser[userId] ?? EMPTY_FAVORITES;
      },

      toggleFavorite(userId, tourId) {
        if (!userId || !tourId) return;
        set(s => {
          const current = { ...(s.byUser[userId] ?? {}) };
          if (current[tourId]) delete current[tourId];
          else current[tourId] = true;
          return { byUser: { ...s.byUser, [userId]: current } };
        });
      },

      isFavorite(userId, tourId) {
        if (!userId || !tourId) return false;
        return !!get().byUser[userId]?.[tourId];
      },

      removeFavorite(userId, tourId) {
        if (!userId || !tourId) return;
        set(s => {
          const current = s.byUser[userId];
          if (!current?.[tourId]) return s;
          const next = { ...current };
          delete next[tourId];
          return { byUser: { ...s.byUser, [userId]: next } };
        });
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
    },
  ),
);
