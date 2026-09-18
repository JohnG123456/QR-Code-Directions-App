import { distanceMeters, type LatLng } from "@/lib/geo/distance";
import { toLocalMeters } from "@/lib/geo/local-projection";
import { closestPointOnPolyline } from "@/lib/network/snap";

// The judgement calls behind live directions, kept apart from React and
// from Leaflet so they can be read - and argued with - on their own.
//
// The thing being defended against throughout is the same: a single GPS
// fix is not evidence. Consumer GPS in a car is good to 5-15m under open
// sky, and worse under a carport, beside a two-storey facade, or under
// the mature trees these resorts are full of. The roads here are about
// six metres wide and often twenty-five metres apart, so a bad fix lands
// squarely on the next street over and looks entirely plausible. Every
// threshold below exists to stop one such fix changing what the visitor
// is told.

/** Past this, a fix is too vague to place on a road at all. */
export const UNUSABLE_ACCURACY_M = 100;

/** Past this, the fix is worth showing but worth apologising for. */
export const FAIR_ACCURACY_M = 25;

/** How far off the line counts as having left it. Wider than a road,
 *  because being told you are off-route while driving down the right one
 *  is worse than being told nothing. */
export const OFF_ROUTE_M = 30;

/** How many fixes in a row have to agree before that is acted on. */
export const OFF_ROUTE_FIXES = 3;

/** Close enough to the door to stop giving directions to it. */
export const ARRIVAL_RADIUS_M = 25;

/** Never ask the server for a new route more often than this. */
export const MIN_RECOMPUTE_MS = 4000;

/** Ask again after this long regardless, so the distance shown can't
 *  drift far from the distance actually left. */
export const MAX_ROUTE_AGE_MS = 20000;

/** Or after moving this far from wherever the current route was computed. */
export const RECOMPUTE_AFTER_MOVING_M = 40;

/** How far counts as having moved at all, rather than as a fix wobbling
 *  about a parked car. Above typical GPS jitter, well below a drive. */
export const STATIONARY_M = 10;

/** How long a visitor can stay put before the page stops following them
 *  on its own. */
export const IDLE_STOP_MS = 5 * 60 * 1000;

/** How long "Rerouting…" stays up once it appears.
 *
 *  The request it describes usually answers in a few hundred
 *  milliseconds, which is too quick to read - and a word that flickers
 *  past unread is worse than no word, because the line it was explaining
 *  changes anyway. So the notice is held long enough to be taken in. */
export const REROUTE_NOTICE_MS = 1500;

export type AccuracyGrade = "good" | "fair" | "coarse";

/**
 * How much to trust a fix.
 *
 * "coarse" is mostly an Android case and worth naming: with device
 * Location set to battery-saving, or GPS off, Chrome returns a
 * network-derived position of 50-2000m rather than refusing. It arrives
 * looking like any other fix, so without this check the page would show
 * a confident dot on a road the visitor is nowhere near.
 */
export function gradeAccuracy(accuracyM: number | null): AccuracyGrade {
  if (accuracyM === null || !Number.isFinite(accuracyM)) return "fair";
  if (accuracyM > UNUSABLE_ACCURACY_M) return "coarse";
  if (accuracyM > FAIR_ACCURACY_M) return "fair";
  return "good";
}

export interface RouteProjection {
  /** How far the visitor is from the line they were given. */
  offsetM: number;
  /** How much of that line is still in front of them. */
  remainingM: number;
}

/**
 * Where a position falls against the route, and how much is left.
 *
 * Measured against the line the visitor already has rather than by
 * asking the server again, so the distance counts down smoothly between
 * requests instead of stepping every few seconds.
 */
export function projectOntoRoute(
  position: LatLng,
  routePoints: [number, number][]
): RouteProjection | null {
  if (routePoints.length < 2) return null;

  // Local metres about the visitor: the route spans a few hundred metres
  // at most, where the flat-earth approximation is good to well under a
  // metre.
  const projected = routePoints.map(([lat, lng]) => toLocalMeters({ lat, lng }, position));
  const hit = closestPointOnPolyline({ x: 0, y: 0 }, projected);
  if (!hit) return null;

  let remainingM = Math.hypot(
    projected[hit.index + 1].x - hit.point.x,
    projected[hit.index + 1].y - hit.point.y
  );
  for (let i = hit.index + 1; i < projected.length - 1; i++) {
    remainingM += Math.hypot(
      projected[i + 1].x - projected[i].x,
      projected[i + 1].y - projected[i].y
    );
  }

  return { offsetM: hit.distance, remainingM };
}

export interface RecomputeInput {
  /** Where the route currently on screen was computed from, if any. */
  routedFrom: LatLng | null;
  /** When it was computed. */
  routedAt: number | null;
  /** Where the visitor is now. */
  position: LatLng;
  /** How many consecutive fixes have put them off the line. */
  offRouteFixes: number;
  now: number;
}

/**
 * Whether to ask the server for a new route.
 *
 * Deliberately not "on every fix": the fixes arrive about once a second,
 * and at the 200-600m these drives run to, a request per fix is a lot of
 * traffic to change a number by three metres. The route is re-asked for
 * when it has actually stopped being the right answer - they have left
 * it, they have covered enough ground, or it has simply been a while.
 */
export function shouldRecomputeRoute({
  routedFrom,
  routedAt,
  position,
  offRouteFixes,
  now,
}: RecomputeInput): boolean {
  if (routedFrom === null || routedAt === null) return true;

  // One throttle over everything below, so a stretch of bad fixes can't
  // turn into a request per second.
  if (now - routedAt < MIN_RECOMPUTE_MS) return false;

  if (offRouteFixes >= OFF_ROUTE_FIXES) return true;

  const movedM = distanceMeters(routedFrom, position);
  if (movedM >= RECOMPUTE_AFTER_MOVING_M) return true;

  // The age trigger only applies to someone who is actually moving.
  //
  // It is here because a route slowly stops describing where a visitor
  // is as they drive along it. A parked car is not that case: nothing
  // about its route has gone stale, and re-asking on a timer alone turns
  // a page left open on a seat into a request every twenty seconds for
  // as long as the phone is awake - which, since this feature holds a
  // wake lock, could be all afternoon. Movement is what makes a route
  // stale, so movement is what re-asks for one.
  return now - routedAt >= MAX_ROUTE_AGE_MS && movedM >= STATIONARY_M;
}

/** Close enough to the site to say so. */
export function hasArrived(position: LatLng, site: LatLng): boolean {
  return distanceMeters(position, site) <= ARRIVAL_RADIUS_M;
}

/**
 * Which way the visitor is pointing, when that can be known.
 *
 * GPS course-over-ground, not the device compass. In a car the compass
 * reads the car's own metal and whatever the phone is sitting in, and a
 * heading arrow that points the wrong way is worse than no arrow. Course
 * is only meaningful once actually moving, hence the speed floor - a
 * stationary receiver reports a heading that wanders freely.
 */
export function usableHeading(
  headingDeg: number | null,
  speedMs: number | null
): number | null {
  if (headingDeg === null || !Number.isFinite(headingDeg)) return null;
  if (speedMs === null || !Number.isFinite(speedMs) || speedMs < 1.5) return null;
  return ((headingDeg % 360) + 360) % 360;
}
