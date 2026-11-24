import { describe, expect, it } from 'vitest';
import { CAMERA_MESSAGES, UPLOAD_MESSAGES, friendlyCameraMessage, friendlyUploadMessage } from './friendlyErrors';

// The exact texts from the tablet screenshots.
const STITCH_422 =
  '422: Could not stitch IMG_20181013_121705_00_307.insp with either stitching engine (MediaSDK: stitch worker refused the capture (HTTP 422): output is mostly flat colour (flat_rows=0.98, dominant=1.00); the original capture is probably corrupt or incomplete; built-in stitcher: output is mostly flat colour (flat_rows=0.96, dominant=1.00); the original capture is probably corrupt or incomplete). The file may be corrupt or incomplete - re-capture it, or export an equirectangular JPEG from Insta360 Studio';

describe('friendlyUploadMessage', () => {
  it('turns the long stitch failure into one short sentence', () => {
    const m = friendlyUploadMessage(STITCH_422);
    expect(m).toBe(UPLOAD_MESSAGES.damaged);
    expect(m.length).toBeLessThan(100);
  });

  it('never shows a file name, a number from the server, or engine names', () => {
    const all = [
      STITCH_422, 'HTTP 500: boom', 'Request failed with status code 422', 'weird thing 123', 'Network Error',
      'Stitching produced an unusable panorama. Retry stitch, or upload an equirectangular JPEG from Insta360 Studio.',
    ].map(r => friendlyUploadMessage(r));
    for (const m of all) {
      expect(m).not.toMatch(/IMG_|\.insp|HTTP|MediaSDK|flat_rows|422|Studio|stitch/i);
    }
  });

  it('gives the right advice for each kind of problem', () => {
    expect(friendlyUploadMessage('Network Error')).toBe(UPLOAD_MESSAGES.offline);
    expect(friendlyUploadMessage('Failed to fetch')).toBe(UPLOAD_MESSAGES.offline);
    expect(friendlyUploadMessage('Request failed with status code 401')).toBe(UPLOAD_MESSAGES.session);
    expect(friendlyUploadMessage('413 Payload Too Large')).toBe(UPLOAD_MESSAGES.tooLarge);
    expect(friendlyUploadMessage('Stitch timed out')).toBe(UPLOAD_MESSAGES.slow);
    expect(friendlyUploadMessage('HTTP 503 Service Unavailable')).toBe(UPLOAD_MESSAGES.server);
    expect(friendlyUploadMessage('Capture file was lost on this device — please capture again.')).toBe(UPLOAD_MESSAGES.missing);
    expect(friendlyUploadMessage('The saved copy of this photo is damaged and the camera original is no longer on this device — please capture it again.'))
      .toBe(UPLOAD_MESSAGES.missing);
  });

  it('falls back to a safe sentence for anything unknown, and uses the failure kind when nothing was reported', () => {
    expect(friendlyUploadMessage('zzz')).toBe(UPLOAD_MESSAGES.generic);
    expect(friendlyUploadMessage('', 'stitch')).toBe(UPLOAD_MESSAGES.damaged);
    expect(friendlyUploadMessage(undefined, 'upload')).toBe(UPLOAD_MESSAGES.generic);
    expect(friendlyUploadMessage(null)).toBe(UPLOAD_MESSAGES.generic);
  });

  it('leaves already-plain wording alone, so it is safe to apply twice', () => {
    for (const m of Object.values(UPLOAD_MESSAGES)) expect(friendlyUploadMessage(m)).toBe(m);
    expect(friendlyUploadMessage(friendlyUploadMessage(STITCH_422))).toBe(UPLOAD_MESSAGES.damaged);
  });

  it('uses no em dashes in any message', () => {
    for (const m of [...Object.values(UPLOAD_MESSAGES), ...Object.values(CAMERA_MESSAGES)]) expect(m).not.toContain('—');
  });
});

describe('friendlyCameraMessage', () => {
  it('replaces the long WiFi and camera texts with one clear sentence', () => {
    expect(friendlyCameraMessage('Could not connect to the camera\'s WiFi network. Make sure the camera is powered on and its WiFi is enabled, and that the camera WiFi password is correct (newer cameras such as the X4 and X5 use their own password, shown in the camera\'s WiFi settings).'))
      .toBe(CAMERA_MESSAGES.unreachable);
    expect(friendlyCameraMessage('Timed out waiting for the camera\'s WiFi network. The camera stops broadcasting its WiFi after a while: press its power button')).toBe(CAMERA_MESSAGES.unreachable);
    expect(friendlyCameraMessage('Connected to camera WiFi but /osc/info did not respond: timeout')).toBe(CAMERA_MESSAGES.unreachable);
    expect(friendlyCameraMessage('Not connected to the camera. Call connect() first.')).toBe(CAMERA_MESSAGES.unreachable);
  });

  it('covers permission, transfer and capture problems', () => {
    expect(friendlyCameraMessage('Permission required to connect to the camera\'s WiFi network was denied.')).toBe(CAMERA_MESSAGES.permission);
    expect(friendlyCameraMessage('Capture failed: TRANSFER_INCOMPLETE received 100 of 900 bytes')).toBe(CAMERA_MESSAGES.incomplete);
    expect(friendlyCameraMessage('Timed out waiting for the camera to finish capturing.')).toBe(CAMERA_MESSAGES.notFinished);
    expect(friendlyCameraMessage('')).toBe(CAMERA_MESSAGES.generic);
    expect(friendlyCameraMessage('Capture failed: something odd')).toBe(CAMERA_MESSAGES.generic);
  });
});
