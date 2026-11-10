/**
 * Rules for a point that exists on this device but not (yet) in the server's snapshot.
 * Pure (no store / Capacitor imports) so they can be unit tested.
 *
 * Background: a post-login refresh replaces local data with the server's. A point missing from that snapshot is
 * either (a) deleted by someone else, which should converge, or (b) never made it to the server because its "create"
 * message was lost (offline queue overflow, a rejected request...). Treating (b) like (a) threw away a point that had
 * photos on it, and the photos with it. Each point now carries `serverSeen`: false from the moment this device creates
 * it, true once a snapshot has contained it. Only a point the server has NEVER confirmed is protected, so a point a
 * manager deleted (which had been seen) still goes away as before.
 */

type PinLike = { serverSeen?: boolean; captureIds?: readonly string[] };

/** Created on this device, never confirmed by the server, and it already holds photos. */
export function isUnconfirmedCapturedPin(pin: PinLike): boolean {
  return pin.serverSeen === false && (pin.captureIds?.length ?? 0) > 0;
}

/** Mark every pin in a server snapshot as confirmed. */
export function markServerSeen<T extends PinLike>(pins: readonly T[] | undefined): T[] | undefined {
  if (!pins) return undefined;
  return pins.map(p => (p.serverSeen === true ? p : { ...p, serverSeen: true }));
}
