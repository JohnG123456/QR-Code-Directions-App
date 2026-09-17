"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo/distance";
import {
  hasArrived,
  projectOntoRoute,
  shouldRecomputeRoute,
  OFF_ROUTE_FIXES,
  OFF_ROUTE_M,
} from "./live-route";
import { useLivePosition, type LiveFix, type LivePositionStatus } from "./use-live-position";
import { useWakeLock } from "./use-wake-lock";

// Live directions: the position stream, the route recomputed from it,
// and the decisions about when to do that, in one place.
//
// The loop is deliberately conservative. A fix arrives about once a
// second; the server is asked for a new route only when the one on
// screen has stopped being the right answer, and the distance still
// counts down every second in between because it is measured against the
// line the browser already has. See live-route.ts for the thresholds and
// why each is where it is.

export interface LiveRoute {
  distanceM: number;
  points: [number, number][];
}

export interface LiveDirections {
  active: boolean;
  status: LivePositionStatus;
  message: string | null;
  fix: LiveFix | null;
  /** The route from where the visitor is, once one has been computed. */
  route: LiveRoute | null;
  /** How far is left, updated between requests from the line on screen. */
  remainingM: number | null;
  arrived: boolean;
  /** The position couldn't be placed on any road at this resort: out of
   *  range, or off the traced network. */
  unplaced: boolean;
  /** The fix is too vague to place on a road at all. */
  coarse: boolean;
  /** This deployment's database hasn't got route_from_point yet. */
  unsupportedByServer: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * A stand-in for the receiver, used by the test rig.
 *
 * Passing this at all puts the hook in simulation: the real watch is
 * never started, so no permission is asked for and nothing about the
 * browser's own position reaches the page. Everything downstream - the
 * recompute loop, the thresholds, the server call - runs exactly as it
 * does for a real fix, which is the point of testing this way.
 */
export interface PositionSimulation {
  fix: LiveFix | null;
}

export function useLiveDirections(
  siteId: string | null,
  site: LatLng | null,
  simulation?: PositionSimulation | null
): LiveDirections {
  const {
    status: watchStatus,
    fix: watchFix,
    message,
    start: startWatch,
    stop: stopWatch,
  } = useLivePosition();

  const simulating = simulation != null;
  const fix = simulating ? simulation.fix : watchFix;
  const [requested, setRequested] = useState(false);
  const [route, setRoute] = useState<LiveRoute | null>(null);
  const [unplaced, setUnplaced] = useState(false);
  const [unsupportedByServer, setUnsupportedByServer] = useState(false);

  // Derived rather than stored, all three of them.
  //
  // Each is a fact about the values already in hand - has the browser
  // refused, is the fix too vague to use, is the visitor there yet - and
  // storing a fact like that means an effect to keep it in step, a
  // render to apply it, and a window in between where the page is
  // showing the answer to the previous fix.

  // A simulated run has no receiver to refuse it, so it is running as
  // soon as it is asked for.
  const status: LivePositionStatus = simulating
    ? requested
      ? "active"
      : "idle"
    : watchStatus;

  // A refusal ends the trip: there is nothing to follow, so the page
  // drops back to the route from the entrance rather than leaving a
  // half-started trip on screen.
  const active =
    requested &&
    status !== "denied" &&
    status !== "unavailable" &&
    status !== "unsupported" &&
    status !== "stopped-idle";

  // A coarse fix is not evidence of anything. On Android with Location
  // set to battery-saving, or GPS off, Chrome returns a cell-tower
  // position hundreds of metres wide rather than refusing - it arrives
  // looking like any other fix, and routing from it would confidently
  // send someone down the wrong street.
  const coarse = active && fix?.grade === "coarse";

  const arrived =
    active && fix !== null && site !== null && hasArrived(fix.position, site);

  // Where this fix falls against the line already on screen. Measured
  // here rather than by asking the server again, which is what lets the
  // distance count down every second instead of stepping whenever a
  // request happens to come back.
  const projection = useMemo(
    () => (active && fix && route ? projectOntoRoute(fix.position, route.points) : null),
    [active, fix, route]
  );

  // The route's own total until the first fix has been placed against
  // it, which is the same number a moment earlier.
  const remainingM = projection?.remainingM ?? route?.distanceM ?? null;

  // Loop state that must not itself cause a render: where the current
  // route was computed from, when, whether a request is already out, and
  // how many fixes in a row have said "off the line".
  const routedFrom = useRef<LatLng | null>(null);
  const routedAt = useRef<number | null>(null);
  const inFlight = useRef(false);
  const offRouteFixes = useRef(0);

  useWakeLock(active);

  // Called by the page whenever the destination changes as well as when
  // the visitor stops following: directions to somewhere they are no
  // longer going are worse than none.
  const stop = useCallback(() => {
    setRequested(false);
    if (!simulating) stopWatch();
    setRoute(null);
    setUnplaced(false);
    routedFrom.current = null;
    routedAt.current = null;
    offRouteFixes.current = 0;
  }, [stopWatch, simulating]);

  const start = useCallback(() => {
    setUnplaced(false);
    routedFrom.current = null;
    routedAt.current = null;
    offRouteFixes.current = 0;
    setRequested(true);
    if (!simulating) startWatch();
  }, [startWatch, simulating]);

  useEffect(() => {
    if (!active || !fix || !siteId || !site) return;
    // Nothing left to route to, and nothing worth routing from. The dot
    // and its accuracy circle still show either way, so the visitor can
    // see for themselves why nothing is moving.
    if (arrived || coarse) return;

    if (projection) {
      offRouteFixes.current =
        projection.offsetM > OFF_ROUTE_M ? offRouteFixes.current + 1 : 0;
    }

    if (inFlight.current) return;
    if (
      !shouldRecomputeRoute({
        routedFrom: routedFrom.current,
        routedAt: routedAt.current,
        position: fix.position,
        offRouteFixes: offRouteFixes.current,
        now: fix.at,
      })
    ) {
      return;
    }

    const from = fix.position;
    inFlight.current = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/route?site=${encodeURIComponent(siteId)}` +
            `&lat=${encodeURIComponent(from.lat)}&lng=${encodeURIComponent(from.lng)}`
        );
        const data = (await response.json()) as {
          route?: LiveRoute | null;
          liveUnavailable?: boolean;
        };

        if (data.liveUnavailable) {
          setUnsupportedByServer(true);
          setUnplaced(true);
          return;
        }
        if (!response.ok || !data.route) {
          // Off the traced network, or outside the resort. Keep the last
          // good route on screen rather than blanking it - it is still
          // roughly where they are going.
          setUnplaced(true);
          return;
        }

        setUnplaced(false);
        setRoute({ distanceM: data.route.distanceM, points: data.route.points });
        routedFrom.current = from;
        routedAt.current = Date.now();
        offRouteFixes.current = 0;
      } catch {
        // A dropped request is not a reason to tear the trip down; the
        // next fix will try again.
      } finally {
        inFlight.current = false;
      }
    })();
    // `projection` is read to count off-route fixes, but re-running when
    // it changes would fire a second request off the back of the
    // response to the first. Each new fix is the trigger, and the fix is
    // what carries the time the decision is made against.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, arrived, coarse, fix, siteId, site?.lat, site?.lng]);

  return {
    active,
    status,
    message,
    fix,
    route,
    remainingM,
    arrived,
    unplaced,
    coarse,
    unsupportedByServer,
    start,
    stop,
  };
}

export { OFF_ROUTE_FIXES };
