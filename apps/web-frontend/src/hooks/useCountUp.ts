import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext.js';

/** Animates a number from 0 to `target` once `start` becomes true (pair with
 * useScrollReveal's isVisible). Jumps straight to `target` with no animation when the
 * user has Reduced Motion on — mirrors this app's single source of truth for that
 * preference (ThemeContext), not a separate matchMedia check. */
export function useCountUp(target: number, start: boolean, durationMs = 1200): number {
  const { reducedMotion } = useTheme();
  const [value, setValue] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!start || startedRef.current) return;
    startedRef.current = true;

    if (reducedMotion) {
      setValue(target);
      return;
    }

    const startTime = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / durationMs, 1);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [start, target, durationMs, reducedMotion]);

  return value;
}
