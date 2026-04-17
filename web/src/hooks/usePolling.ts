import { useCallback, useEffect, useRef } from 'react';

/**
 * Polls `fn` every `intervalMs` milliseconds while `active` is true.
 * Calls `fn` immediately on mount (if active) and again each interval.
 * Stops automatically when `active` becomes false.
 */
export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  active: boolean,
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const tick = useCallback(() => {
    void fnRef.current();
  }, []);

  useEffect(() => {
    if (!active) return;
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, tick]);
}
