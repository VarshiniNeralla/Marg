import { useCallback, useRef, useState } from 'react';

interface LongPressOptions {
  /** Hold duration in ms before the long-press fires. Default 500. */
  threshold?: number;
  /** Movement (px) beyond which the gesture is treated as a drag and cancelled. Default 10. */
  moveTolerance?: number;
  /** Fired on a short press/click that was released before the threshold. */
  onClick?: () => void;
}

/**
 * Unified long-press detection for touch and mouse, designed to coexist with a
 * pan/zoom surface: any pointer movement past `moveTolerance` cancels the press
 * so dragging the floor plan never triggers a capture.
 *
 * Returns pointer handlers to spread onto the target plus `progress` (0→1) for a
 * radial "hold to capture" indicator, and `isPressing`.
 */
export function useLongPress(onLongPress: () => void, options: LongPressOptions = {}) {
  const { threshold = 500, moveTolerance = 10, onClick } = options;

  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef({ x: 0, y: 0, t: 0 });
  const firedRef = useRef(false);

  const [isPressing, setIsPressing] = useState(false);
  const [progress, setProgress] = useState(0);

  const clear = useCallback(() => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setIsPressing(false);
    setProgress(0);
  }, []);

  const tick = useCallback(() => {
    const elapsed = performance.now() - startRef.current.t;
    setProgress(Math.min(1, elapsed / threshold));
    if (elapsed < threshold) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [threshold]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    firedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    setIsPressing(true);
    setProgress(0);
    rafRef.current = requestAnimationFrame(tick);
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      clear();
      onLongPress();
    }, threshold);
  }, [clear, onLongPress, threshold, tick]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (timerRef.current === null) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > moveTolerance) clear();
  }, [clear, moveTolerance]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    const wasShort = timerRef.current !== null && !firedRef.current;
    clear();
    if (wasShort && onClick) onClick();
  }, [clear, onClick]);

  const onPointerLeave = useCallback(() => clear(), [clear]);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerLeave, onPointerCancel: onPointerLeave },
    isPressing,
    progress,
  };
}
