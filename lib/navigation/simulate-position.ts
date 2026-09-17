import { bearingDegrees, distanceMeters, type LatLng } from "@/lib/geo/distance";
import { fromLocalMeters, toLocalMeters } from "@/lib/geo/local-projection";

// Walking a pretend visitor along a route, for testing live directions
// without standing at a resort.
//
// Pure geometry, and separate from the control that drives it, because
// the one thing a test rig must not do is have bugs of its own: if the
// dot goes somewhere odd, it needs to be obvious whether the navigation
// code or the rig put it there.

/** How long the whole route is, in metres. */
export function routeLengthM(points: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += distanceMeters(
      { lat: points[i][0], lng: points[i][1] },
      { lat: points[i + 1][0], lng: points[i + 1][1] }
    );
  }
  return total;
}

export interface PointOnRoute {
  position: LatLng;
  /** The direction of travel along the segment they're on, which is what
   *  a real GPS reports as course over ground. */
  headingDeg: number;
}

/** Where along the route a visitor is, that many metres in. */
export function pointAlongRoute(
  points: [number, number][],
  distanceAlongM: number
): PointOnRoute | null {
  if (points.length < 2) return null;

  let remaining = Math.max(0, distanceAlongM);
  for (let i = 0; i < points.length - 1; i++) {
    const from = { lat: points[i][0], lng: points[i][1] };
    const to = { lat: points[i + 1][0], lng: points[i + 1][1] };
    const segment = distanceMeters(from, to);

    // A zero-length segment has no direction to travel along; step over
    // it rather than dividing by it.
    if (segment <= 0) continue;

    if (remaining <= segment) {
      const t = remaining / segment;
      const a = toLocalMeters(from, from);
      const b = toLocalMeters(to, from);
      return {
        position: fromLocalMeters(
          { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
          from
        ),
        headingDeg: bearingDegrees(from, to),
      };
    }
    remaining -= segment;
  }

  // Past the end: stand at the last point, still facing the way the
  // final leg ran.
  const last = points[points.length - 1];
  const previous = points[points.length - 2];
  return {
    position: { lat: last[0], lng: last[1] },
    headingDeg: bearingDegrees(
      { lat: previous[0], lng: previous[1] },
      { lat: last[0], lng: last[1] }
    ),
  };
}

/**
 * Shifted sideways off the route, for testing what happens when someone
 * takes a wrong turn - or when GPS says they did.
 *
 * Sideways rather than anywhere, because that is the case the navigation
 * code actually has to judge: a fix that has drifted onto the next
 * street over looks exactly like a driver who has turned into it.
 */
export function offsetSideways(
  point: PointOnRoute,
  offsetM: number
): LatLng {
  if (offsetM === 0) return point.position;
  const radians = ((point.headingDeg + 90) * Math.PI) / 180;
  return fromLocalMeters(
    { x: offsetM * Math.sin(radians), y: offsetM * Math.cos(radians) },
    point.position
  );
}
