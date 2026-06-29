import { useCallback, useRef } from 'react';

interface DoubleTapOptions {
  /** Max ms between two taps to count as a double-tap. Default 280. */
  delay?: number;
  /** Movement (px) beyond which any pending tap is cancelled. Default 10. */
  moveTolerance?: number;
  /** Fired on a single tap that was NOT followed by a second tap. */
  onSingleTap?: () => void;
}

/**
 * Double-tap (and double-click) detection that coexists with a pan/zoom surface.
 *
 * Single tap  → onSingleTap (after the delay window has passed with no second tap)
 * Double tap  → onDoubleTap (fires immediately on the second tap)
 *
 * Any pointer movement past moveTolerance resets the tap counter, so dragging
 * the floor plan never accidentally triggers a capture.
 *
 * Returns pointer event handlers to spread onto the target element.
 */
export function useDoubleTap(onDoubleTap: () => void, options: DoubleTapOptions = {}) {
  const { delay = 280, moveTolerance = 10, onSingleTap } = options;

  const lastTapRef  = useRef<number>(0);
  const timerRef    = useRef<number | null>(null);
  const startPosRef = useRef({ x: 0, y: 0 });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    // Track start position so we can cancel on move.
    startPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const dx = e.clientX - startPosRef.current.x;
    const dy = e.clientY - startPosRef.current.y;
    if (Math.hypot(dx, dy) > moveTolerance) {
      // Treat as drag — reset tap state.
      lastTapRef.current = 0;
      clearTimer();
    }
  }, [clearTimer, moveTolerance]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    // Guard: only primary button / touch.
    if (e.button !== undefined && e.button !== 0) return;

    const dx = e.clientX - startPosRef.current.x;
    const dy = e.clientY - startPosRef.current.y;
    if (Math.hypot(dx, dy) > moveTolerance) return; // was a drag, ignore

    const now = performance.now();
    const elapsed = now - lastTapRef.current;

    if (elapsed < delay && lastTapRef.current !== 0) {
      // Second tap within window → double tap
      clearTimer();
      lastTapRef.current = 0;
      onDoubleTap();
    } else {
      // First tap — start the window timer
      lastTapRef.current = now;
      clearTimer();
      if (onSingleTap) {
        timerRef.current = window.setTimeout(() => {
          lastTapRef.current = 0;
          onSingleTap();
        }, delay);
      } else {
        // No single-tap handler — just reset after window
        timerRef.current = window.setTimeout(() => {
          lastTapRef.current = 0;
        }, delay);
      }
    }
  }, [clearTimer, delay, moveTolerance, onDoubleTap, onSingleTap]);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
  };
}
