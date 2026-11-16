/**
 * Connection settings shared by every Insta360 camera (X3, X4, X5, X6 and whatever ships next).
 *
 * Nothing here names a camera model or holds a password. The camera is found by the shape of its own WiFi name,
 * and which model it is gets read from the camera itself (OSC /osc/info) once connected.
 */
import type { Insta360SsidPattern } from '@/plugins/insta360Camera';

/**
 * Tried in order. Insta360 cameras advertise their own access point as "<model> <serial>.OSC"
 * (confirmed on a real X3: "X3 8TV8SF.OSC"), so:
 *  1. names starting with "X"    -> X3, X4, X5, X6, X4 Air and later X-series
 *  2. names starting with "ONE " -> ONE X2, ONE RS and other ONE-series
 *  3. any name ending in ".OSC"  -> a catch-all for a naming scheme we have not seen yet
 */
export const INSTA360_SSID_PATTERNS: Insta360SsidPattern[] = [
  { pattern: 'X', mode: 'prefix' },
  { pattern: 'ONE ', mode: 'prefix' },
  { pattern: '.*\\.OSC', mode: 'glob' },
];

const PASSWORD_KEY = 'sitesurelabs-insta360-wifi-password-v1';

/**
 * The camera WiFi password saved on this device ('' when none yet). Passwords differ per camera (newer models
 * generate their own), so nothing is built in: the engineer enters it once and it is remembered.
 */
export function getInsta360Password(): string {
  try {
    return localStorage.getItem(PASSWORD_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

/** Remember the password once it has worked (it is shown in the camera's own WiFi settings). */
export function saveInsta360Password(password: string): void {
  try {
    const p = password.trim();
    if (p) localStorage.setItem(PASSWORD_KEY, p);
    else localStorage.removeItem(PASSWORD_KEY);
  } catch {
    /* storage unavailable: it will be asked again next time */
  }
}
