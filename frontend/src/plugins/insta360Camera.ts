import { registerPlugin } from '@capacitor/core';

export interface Insta360ConnectResult {
  connected: boolean;
  ssid: string;
}

export interface Insta360CaptureResult {
  /** Absolute path to the downloaded JPEG/INSP file inside the app's cache dir. */
  filePath: string;
  fileName: string;
}

export interface Insta360Plugin {
  /**
   * Requests the camera's WiFi access point as a local-only network (does not
   * touch the device's default WiFi/cellular route to the backend) and binds
   * subsequent OSC calls to it. Resolves once the network is available and
   * `/osc/info` responds. `ssidPattern` matches the camera's own AP name
   * (e.g. an Insta360 X3 advertises as "X3 XXXXXXXX.OSC" — note the space).
   * `password` is the camera's WPA2 WiFi password (visible in the camera's own
   * WiFi settings / the official Insta360 app); omit only for an open AP.
   */
  connect(options: { ssidPattern: string; password?: string }): Promise<Insta360ConnectResult>;

  /** Triggers camera.takePicture, polls camera.commands.status, downloads the
   *  resulting file into the app's cache dir, and returns its local path. */
  capturePhoto(): Promise<Insta360CaptureResult>;

  /** Releases the NetworkCallback, letting the ephemeral local-only network tear down. */
  disconnect(): Promise<void>;
}

export const Insta360Camera = registerPlugin<Insta360Plugin>('Insta360Camera');
