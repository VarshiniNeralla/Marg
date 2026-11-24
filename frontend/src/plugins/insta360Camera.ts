import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface Insta360SsidPattern {
  pattern: string;
  /** "prefix": the AP name starts with the pattern. "glob": Android advanced glob ("." = any char, "*" repeats). */
  mode: 'prefix' | 'glob';
}

export interface Insta360ConnectResult {
  connected: boolean;
  ssid: string;
  /** Model the camera reports about itself (e.g. "Insta360 X3"); empty when it does not say. */
  model?: string;
  firmwareVersion?: string;
}

export interface Insta360CaptureResult {
  /** Absolute path to the downloaded JPEG/INSP file inside the app's cache dir. */
  filePath: string;
  fileName: string;
  model?: string;
}

export interface Insta360Plugin {
  /**
   * Requests the camera's WiFi access point as a local-only network (does not
   * touch the device's default WiFi/cellular route to the backend) and binds
   * subsequent OSC calls to it. Resolves once the network is available and
   * `/osc/info` responds. `ssidPatterns` are tried in order against the camera's own AP name, so no camera
   * model is assumed (an X3 advertises "X3 XXXXXXXX.OSC"). `ssidPattern` is the older single-prefix form.
   * `password` is the camera's WPA2 WiFi password (shown in the camera's own WiFi settings / the official
   * Insta360 app); omit only for an open AP.
   */
  connect(options: { ssidPatterns?: Insta360SsidPattern[]; ssidPattern?: string; password?: string }): Promise<Insta360ConnectResult>;

  /** Triggers camera.takePicture, polls camera.commands.status, downloads the
   *  resulting file into the app's cache dir, and returns its local path. */
  capturePhoto(): Promise<Insta360CaptureResult>;

  /** Releases the NetworkCallback, letting the ephemeral local-only network tear down. */
  disconnect(): Promise<void>;

  /** Reads the camera's current capture mode and OSC state (for troubleshooting over USB debugging). */
  diagnose(): Promise<{ captureMode: string; state: string }>;

  /**
   * Fired when the camera connection drops without being asked to (the camera slept or powered off, went out of range,
   * or Android released the network). The next `connect()` starts from a clean reconnect.
   */
  addListener(
    eventName: 'connectionLost',
    listener: (event: { reason: string; connectedForMs: number }) => void,
  ): Promise<PluginListenerHandle>;
}

/**
 * Code on a rejected `capturePhoto()` when the camera was not reachable BEFORE the shutter, so nothing was taken and
 * it is safe to reconnect and try again.
 */
export const INSTA360_NOT_CONNECTED = 'NOT_CONNECTED';

export const Insta360Camera = registerPlugin<Insta360Plugin>('Insta360Camera');
