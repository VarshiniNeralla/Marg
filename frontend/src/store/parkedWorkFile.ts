/**
 * Roomy second home for parked work.
 *
 * When a different person signs in, the previous person's unsent floors/changes are parked so nothing is lost. The
 * first choice is browser local storage, but that holds only about 5 MB and the saved floor data alone can be 3 MB,
 * so the parked copy can fail to fit. This keeps the same copy in the app's file storage (IndexedDB in a browser, a
 * real file on the tablet), which has far more room. A copy is only reported saved after reading it back identical.
 */
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { ParkedWork } from './uploadOwnership';

export interface ParkFs {
  writeFile(o: { path: string; data: string; directory: Directory; encoding: Encoding; recursive?: boolean }): Promise<unknown>;
  readFile(o: { path: string; directory: Directory; encoding: Encoding }): Promise<{ data: string | Blob }>;
  deleteFile(o: { path: string; directory: Directory }): Promise<unknown>;
}

const DIR = 'sitesurelabs-parked';
const pathFor = (ownerId: string) => `${DIR}/${encodeURIComponent(ownerId)}.json`;
const realFs: ParkFs = Filesystem as unknown as ParkFs;

async function asText(data: string | Blob): Promise<string> {
  return typeof data === 'string' ? data : data.text();
}

/** True only when the copy is saved and reads back identical. */
export async function parkWorkFile(
  ownerId: string, work: Omit<ParkedWork, 'parkedAt'>, now = Date.now(), fs: ParkFs = realFs,
): Promise<boolean> {
  try {
    const payload = JSON.stringify({ ...work, parkedAt: now } satisfies ParkedWork);
    await fs.writeFile({ path: pathFor(ownerId), data: payload, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    const back = await fs.readFile({ path: pathFor(ownerId), directory: Directory.Data, encoding: Encoding.UTF8 });
    return (await asText(back.data)) === payload;
  } catch {
    return false;
  }
}

export async function readParkedWorkFile(ownerId: string, fs: ParkFs = realFs): Promise<ParkedWork | null> {
  try {
    const back = await fs.readFile({ path: pathFor(ownerId), directory: Directory.Data, encoding: Encoding.UTF8 });
    const parsed = JSON.parse(await asText(back.data)) as ParkedWork;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Only call once the parked work has been handed back and is safely in place. */
export async function dropParkedWorkFile(ownerId: string, fs: ParkFs = realFs): Promise<void> {
  try {
    await fs.deleteFile({ path: pathFor(ownerId), directory: Directory.Data });
  } catch {
    /* nothing there, or already gone */
  }
}
