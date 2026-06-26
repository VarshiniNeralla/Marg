import { useEffect, useState } from 'react';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

/**
 * Detects the device class so the pin-capture workflow can branch:
 *   mobile / tablet → open the back camera (getUserMedia)
 *   desktop         → open the existing upload dialog
 *
 * Detection combines a coarse-pointer + touch check (true touch devices) with
 * viewport width as the tablet/mobile cut-off. It re-evaluates on resize and
 * orientation change so a tablet rotating between portrait/landscape stays
 * classified correctly.
 */
function detect(): DeviceType {
  if (typeof window === 'undefined') return 'desktop';

  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const width = window.innerWidth;

  // A device that is neither touch nor coarse-pointer is a desktop regardless of
  // a narrow window (e.g. a resized browser).
  if (!hasTouch && !coarse) return 'desktop';

  if (width <= 600) return 'mobile';
  if (width <= 1024) return 'tablet';
  // Large touch screens (kiosks, big tablets) — treat as tablet so the camera
  // flow is still used rather than the desktop upload dialog.
  return 'tablet';
}

export function useDeviceType(): DeviceType {
  const [device, setDevice] = useState<DeviceType>(() => detect());

  useEffect(() => {
    const update = () => setDevice(detect());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return device;
}

/** True when the device should use the camera flow rather than file upload. */
export function usesCameraCapture(device: DeviceType): boolean {
  return device === 'mobile' || device === 'tablet';
}
