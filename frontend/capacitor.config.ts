import type { CapacitorConfig } from '@capacitor/cli';

// Phase 0 (mobile-app branch): wrap the existing SPA as an Android app with
// zero behavior change. webDir points at the same Vite build every other
// deploy target uses; no native plugins are registered yet.
//
// server.hostname: the WebView serves the bundled files under this host instead of "localhost". The backend in
// production refuses a "localhost" CORS origin (and the app's own settings validation rejects it), so the app needs
// a real origin it can be allowed under: https://app.sitevision.sitesurelabs.com. No DNS record is needed, because
// Capacitor answers requests for this host from the bundled files on the device; the API is called on its own host
// (https://sitevision.sitesurelabs.com) and counts as the SAME SITE, so the refresh-token cookie works.
const config: CapacitorConfig = {
  appId: 'com.sitevision.fieldapp',
  appName: 'SiteVision',
  webDir: 'dist',
  server: {
    hostname: 'app.sitevision.sitesurelabs.com',
    androidScheme: 'https',
  },
};

export default config;
