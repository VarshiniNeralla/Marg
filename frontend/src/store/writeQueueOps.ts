/**
 * Pure array helpers for the durable write queue (kept free of Capacitor / store imports so they can be unit tested).
 *
 * The queue sends its first entry, waits for the server, then used to call `queue.shift()`. While it waited, a newer
 * change could replace that very entry (a newer capture list for the same point supersedes the older one), so the
 * later shift() removed the NEXT, unrelated entry instead, and that change was never sent. Removing by identity makes
 * that impossible: it only ever removes the exact entry that was just handled, and does nothing if it is already gone.
 */

/** Remove exactly this entry (by identity). Returns false when it is no longer in the queue. */
export function removeEntry<T>(queue: T[], entry: T): boolean {
  const index = queue.indexOf(entry);
  if (index < 0) return false;
  queue.splice(index, 1);
  return true;
}

/** Move exactly this entry to the back (by identity). Does nothing if it is no longer in the queue. */
export function moveEntryToBack<T>(queue: T[], entry: T): void {
  if (removeEntry(queue, entry)) queue.push(entry);
}
