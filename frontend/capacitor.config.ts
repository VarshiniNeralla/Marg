import type { CapacitorConfig } from '@capacitor/cli';

// Phase 0 (mobile-app branch): wrap the existing SPA as an Android app with
// zero behavior change. webDir points at the same Vite build every other
// deploy target uses; no native plugins are registered yet.
const config: CapacitorConfig = {
  appId: 'com.sitevision.fieldapp',
  appName: 'SiteVision',
  webDir: 'dist',
};

export default config;
