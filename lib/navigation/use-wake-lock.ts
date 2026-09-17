"use client";

import { useEffect } from "react";

// Keeps the screen on while live directions are running.
//
// Without it the phone dims and locks on its usual timer, and locking
// the screen stops the position watch - so the one feature that needs
// the page in front of the visitor is also the one their phone is most
// likely to put away. Supported in Chrome on Android and in Safari from
// iOS 16.4; where it isn't, directions still work and the screen still
// sleeps, which is the behaviour without this file.

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        const next = await navigator.wakeLock.request("screen");
        // The await gives the effect time to be torn down underneath us,
        // and a lock taken after that would never be released.
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
      } catch {
        // Denied, or the tab wasn't visible. Not worth telling the
        // visitor about: the screen sleeping is an inconvenience, not a
        // failure of the directions.
      }
    }

    // The lock is dropped by the browser whenever the tab is hidden -
    // switching apps, taking a call - and is not given back on return,
    // so it has to be asked for again.
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && sentinel === null) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release();
      sentinel = null;
    };
  }, [active]);
}
