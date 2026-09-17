"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo/distance";
import { gradeAccuracy, usableHeading, type AccuracyGrade } from "./live-route";

// The browser's position stream, in the shape the visitor page wants it.
//
// Geolocation on the web has a hard limit that shapes everything here:
// watchPosition stops when the tab is backgrounded or the screen locks,
// on both iOS and Android, and there is no background geolocation to
// fall back on. So this is a foreground-only feature by construction -
// the page holds a wake lock while it runs, and the visitor has to leave
// it on screen. Anything else needs a native app.

export type LivePositionStatus =
  | "unsupported"
  | "idle"
  | "starting"
  | "active"
  | "denied"
  | "unavailable";

export interface LiveFix {
  position: LatLng;
  accuracyM: number | null;
  grade: AccuracyGrade;
  /** GPS course over ground, only once moving fast enough to mean it. */
  headingDeg: number | null;
  speedMs: number | null;
  at: number;
}

export interface LivePosition {
  status: LivePositionStatus;
  fix: LiveFix | null;
  /** Set when the browser refused or couldn't answer, for the page to
   *  show as itself rather than as a silent nothing. */
  message: string | null;
  start: () => void;
  stop: () => void;
}

export function useLivePosition(): LivePosition {
  const [status, setStatus] = useState<LivePositionStatus>("idle");
  const [fix, setFix] = useState<LiveFix | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  // Support is not checked up front, deliberately. `navigator` doesn't
  // exist on the server, so testing for it during render would make the
  // first client render disagree with the markup sent down, and testing
  // for it in an effect is a render's worth of cascade to answer a
  // question nothing asks until the visitor presses the button. `start`
  // checks, and says so.

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setStatus((current) => (current === "unsupported" ? current : "idle"));
    setFix(null);
    setMessage(null);
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      setMessage(
        "This browser can't share your location, so we can't follow you. The route from the entrance is still on the map."
      );
      return;
    }
    if (watchId.current !== null) return;

    setStatus("starting");
    setMessage(null);

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        setStatus("active");
        setMessage(null);
        setFix({
          position: { lat: latitude, lng: longitude },
          accuracyM: Number.isFinite(accuracy) ? accuracy : null,
          grade: gradeAccuracy(Number.isFinite(accuracy) ? accuracy : null),
          headingDeg: usableHeading(heading, speed),
          speedMs: Number.isFinite(speed) ? speed : null,
          at: Date.now(),
        });
      },
      (error) => {
        // PERMISSION_DENIED is the one worth telling apart: it is the
        // only one the visitor can do something about, and on Android it
        // is also what an in-app browser - a QR scanned from inside
        // Facebook or Instagram - reports when it simply never passes
        // the prompt on.
        if (error.code === error.PERMISSION_DENIED) {
          // Cleared, because a refusal is final until the visitor does
          // something about it, and a watch left registered would make
          // `start` think one was already running - so pressing the
          // button again after fixing the permission would do nothing at
          // all. The other errors are transient and the watch is left in
          // place to recover from them on its own.
          if (watchId.current !== null) {
            navigator.geolocation.clearWatch(watchId.current);
            watchId.current = null;
          }
          setStatus("denied");
          setMessage(
            "This page doesn't have permission to use your location. Allow it in your browser, or open this page in Chrome or Safari if you scanned the code from inside another app."
          );
        } else {
          setStatus("unavailable");
          setMessage(
            "Your phone couldn't get a GPS fix just now. Under a carport or heavy trees it can take a moment - or follow the route from the entrance instead."
          );
        }
      },
      {
        enableHighAccuracy: true,
        // A fix a few seconds old is fine and saves the receiver work;
        // much older than that and a car has moved somewhere else.
        maximumAge: 3000,
        timeout: 15000,
      }
    );
  }, []);

  // A watch left running after the page goes is a receiver left on in
  // someone's pocket.
  useEffect(() => {
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, []);

  return { status, fix, message, start, stop };
}
