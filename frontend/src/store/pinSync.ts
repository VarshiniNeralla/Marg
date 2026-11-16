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

type PlacedPinLike = PinLike & { flatName?: string; roomName?: string; isPredefined?: boolean };

/**
 * A LABELLED point placed on this device (admin / manager annotation) that the server has never confirmed.
 * It used to be kept for only a few minutes after placing; if its create had not reached the server by then, the next
 * refresh dropped it and the point silently disappeared. It is protected until the server confirms it, and re-sent.
 */
export function isUnconfirmedPlacedPin(pin: PlacedPinLike): boolean {
  if (pin.serverSeen !== false) return false;
  return Boolean(pin.isPredefined || (pin.flatName && pin.roomName));
}

/**
 * How long ago this device placed the point, for the short "keep it until the server has it" window.
 * Only a point that carries a real timestamp from THIS device has an age. A point with no such timestamp (older data, or a
 * copy that came from the server) has none, so it can never be kept alive by the window and then re-sent. Treating the text
 * "Just now" as age 0 kept such points protected forever, and a device with a stale copy kept re-creating points that had
 * since been deleted or replaced elsewhere (stacked duplicates).
 */
export function pinClientAgeMs(pin: { clientCreatedAt?: unknown }, now: number): number {
  return typeof pin.clientCreatedAt === 'number' ? now - pin.clientCreatedAt : Infinity;
}

/** Mark every pin in a server snapshot as confirmed. */
export function markServerSeen<T extends PinLike>(pins: readonly T[] | undefined): T[] | undefined {
  if (!pins) return undefined;
  return pins.map(p => (p.serverSeen === true ? p : { ...p, serverSeen: true }));
}
