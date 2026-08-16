import { useEffect, useRef } from "react";

/** Re-run `callback` on an interval while `enabled`, and again when the tab becomes visible. */
export function usePollingWhileVisible(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void callbackRef.current();
    };
    run();
    const timer = window.setInterval(run, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, intervalMs]);
}
