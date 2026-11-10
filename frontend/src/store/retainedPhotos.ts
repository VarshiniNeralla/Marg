/**
 * Photos that have been sent but whose phone copy is kept until the server proves it holds an exact copy.
 *
 * A separate small list (not the upload queue), so a finished photo stops showing as "waiting" in the app while its
 * file is still protected. Stored in Capacitor Preferences like the upload queue.
 */
import { Preferences } from '@capacitor/preferences';
import type { RetainedPhoto } from './reconcilePlan';

const KEY = 'sitesurelabs-retained-photos-v1';

let cache: RetainedPhoto[] | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** Serialise read-modify-write so two updates can never overwrite each other. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function loadList(): Promise<RetainedPhoto[]> {
  if (cache) return cache;
  try {
    const { value } = await Preferences.get({ key: KEY });
    const parsed = value ? (JSON.parse(value) as RetainedPhoto[]) : [];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function saveList(list: RetainedPhoto[]): Promise<void> {
  cache = list;
  await Preferences.set({ key: KEY, value: JSON.stringify(list) });
}

export function listRetainedPhotos(): Promise<RetainedPhoto[]> {
  return exclusive(async () => [...(await loadList())]);
}

export function addRetainedPhoto(photo: RetainedPhoto): Promise<void> {
  return exclusive(async () => {
    const list = await loadList();
    if (list.some(p => p.id === photo.id)) return;
    await saveList([...list, photo]);
  });
}

export function removeRetainedPhotos(ids: string[]): Promise<void> {
  return exclusive(async () => {
    const drop = new Set(ids);
    const list = await loadList();
    await saveList(list.filter(p => !drop.has(p.id)));
  });
}
