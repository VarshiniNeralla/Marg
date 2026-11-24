/**
 * Plain-language wording for the errors a field engineer can hit while capturing and uploading.
 *
 * The server and the camera plugin report technical text ("422: Could not stitch IMG_2018....insp with either
 * stitching engine (MediaSDK: stitch worker refused the capture (HTTP 422): output is mostly flat colour
 * (flat_rows=0.98 ...") that means nothing to the person holding the tablet. Everything shown to people goes through
 * these functions: one short sentence that says what happened and what to do next. The original text is never
 * thrown away; it stays on the stored record for support, it just is not what gets displayed.
 */

export const UPLOAD_MESSAGES = {
  damaged: 'This photo came out damaged or incomplete. Open the point and tap Capture Again.',
  missing: 'The saved copy of this photo is no longer on this device. Please capture it again.',
  session: 'Your sign-in expired. Sign in again and this photo will send.',
  offline: 'No connection. The photo is safe on this device and will send when you are back online.',
  slow: 'This photo is taking too long to process. Tap Retry.',
  tooLarge: 'This photo is too large to send. Please capture it again.',
  server: 'The server could not process this photo. It is safe on this device. Tap Retry.',
  generic: 'Something went wrong with this photo. Tap Retry, or capture it again.',
} as const;

const KNOWN_UPLOAD_MESSAGES = new Set<string>(Object.values(UPLOAD_MESSAGES));

function has(text: string, ...needles: string[]): boolean {
  return needles.some(n => text.includes(n));
}

/** One short, clear sentence for a photo that failed to stitch or upload. Safe to call on already-friendly text. */
export function friendlyUploadMessage(raw?: string | null, kind?: 'corrupt' | 'upload' | 'stitch'): string {
  const text = String(raw ?? '').trim();
  if (KNOWN_UPLOAD_MESSAGES.has(text)) return text; // already plain

  const e = text.toLowerCase();
  if (!e) {
    return kind === 'stitch' || kind === 'corrupt' ? UPLOAD_MESSAGES.damaged : UPLOAD_MESSAGES.generic;
  }

  // A photo the server judged unusable (the long stitch / flat colour / MediaSDK texts all mean this).
  if (has(e,
    'could not stitch', 'flat colour', 'flat_rows', 'flat color', 'mediasdk', 'stitch worker', 'unusable panorama',
    'low_sphere_coverage', 'insta360 studio', 'corrupt', 'incomplete', 'unsupported', 'could not decode', 'imdecode',
    'blank', 'damaged')) {
    // "damaged" also appears in the lost-copy wording; that one has its own message.
    if (has(e, 'no longer on this device', 'camera original')) return UPLOAD_MESSAGES.missing;
    return UPLOAD_MESSAGES.damaged;
  }
  if (has(e, 'file was lost', 'no longer on this device', 'saved copy')) return UPLOAD_MESSAGES.missing;
  if (has(e, '401', 'session expired', 'sign in', 'unauthorized')) return UPLOAD_MESSAGES.session;
  if (has(e, '413', 'too large', 'payload')) return UPLOAD_MESSAGES.tooLarge;
  if (has(e, 'timed out', 'took too long')) {
    return has(e, 'network', 'fetch', 'connection') ? UPLOAD_MESSAGES.offline : UPLOAD_MESSAGES.slow;
  }
  if (has(e, 'network', 'failed to fetch', 'offline', 'no internet', 'econn', 'connection')) return UPLOAD_MESSAGES.offline;
  if (has(e, '422', '500', '502', '503', '504', 'server', 'validation')) return UPLOAD_MESSAGES.server;
  return UPLOAD_MESSAGES.generic;
}

export const CAMERA_MESSAGES = {
  permission: 'Allow "Nearby devices" access in the app settings so the tablet can reach the camera.',
  unreachable: 'Cannot reach the camera. Turn it on, make sure its WiFi is on, then tap Try again.',
  password: 'The camera did not accept the WiFi password. Check it and try again.',
  incomplete: 'The photo did not finish copying from the camera. Keep the tablet close to the camera and try again.',
  notFinished: 'The camera did not finish taking the photo. Check that it is on and try again.',
  generic: 'Could not take the photo with the camera. Check it is on, then try again.',
} as const;

/** One short, clear sentence for a camera connection or capture failure. */
export function friendlyCameraMessage(raw?: string | null): string {
  const e = String(raw ?? '').toLowerCase();
  if (!e) return CAMERA_MESSAGES.generic;
  if (has(e, 'permission')) return CAMERA_MESSAGES.permission;
  if (has(e, 'transfer_incomplete', 'did not finish copying', 'incomplete transfer')) return CAMERA_MESSAGES.incomplete;
  // Only when the password is explicitly the problem. The plugin's generic "could not connect" text also mentions
  // the password as one possible cause, and the usual cause is simply that the camera is off or asleep.
  if (has(e, 'wrong password', 'incorrect password', 'password rejected', 'password was rejected')) {
    return CAMERA_MESSAGES.password;
  }
  if (has(e, 'not connected', 'not_connected', 'timed out waiting for the camera\'s wifi', 'could not connect',
    'osc/info', 'unreachable', 'failed to connect', 'no route', 'econn', 'connect to')) {
    return CAMERA_MESSAGES.unreachable;
  }
  if (has(e, 'finish capturing', 'capture error', 'timed out')) return CAMERA_MESSAGES.notFinished;
  return CAMERA_MESSAGES.generic;
}
