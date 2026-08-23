// Which way "up" points on the visitor map.
//
// A guest is standing at the entrance holding a phone. If the map is
// drawn north-up, they have to work out which way north is before they
// can take a step - and these resorts sit at whatever angle the land
// does, so north is almost never the way in. Turning the map so that
// walking in is up the page removes that step entirely: what's ahead of
// them on the ground is ahead of them on the screen.
//
// The bearing from the entrance towards the middle of the resort is a
// good stand-in for "the way you're facing as you walk in", and it needs
// no setting up per resort. Where the automatic answer doesn't line up
// with the main boulevard, a resort can override it.
//
// Pure, so it can be tested without a map.

import { bearingDegrees, distanceMeters, type LatLng } from "./distance";
import { toLocalMeters } from "./local-projection";

/** Mean position of a set of points. Good enough at resort scale, where
 *  the whole site is a few hundred metres across. */
export function centroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

export function normaliseBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * The direction the resort's streets run in.
 *
 * This is what "straight" actually means to the eye. Aligning the homes
 * gets close, but homes are not the thing anyone looks at for
 * squareness - and their spread is pulled about by whatever isn't a
 * home: a clubhouse in one corner, a wetland in the middle, a stage
 * that hasn't been built out yet. The streets have none of that. They
 * are drawn square to each other, so lining them up squares the whole
 * drawing up with them.
 *
 * A street grid runs in two directions ninety degrees apart, and each
 * street runs both ways, so a direction only means anything modulo 90.
 * Angles that wrap can't be averaged by adding them up - 1 degree and
 * 89 degrees average to 45, which is exactly wrong - so each is turned
 * into a point on a circle four times round, averaged there, and turned
 * back. Longer streets count for more, since a long boulevard says more
 * about how the estate is laid out than a short spur.
 */
export function roadGridBearing(
  roads: { shape: [number, number][] }[],
  entrance: LatLng,
  middle: LatLng
): number | null {
  let x = 0;
  let y = 0;
  let total = 0;

  for (const road of roads) {
    for (let i = 0; i < road.shape.length - 1; i++) {
      const from = { lat: road.shape[i][0], lng: road.shape[i][1] };
      const to = { lat: road.shape[i + 1][0], lng: road.shape[i + 1][1] };
      const metres = distanceMeters(from, to);
      // Below a few metres a segment is a bend in a curve, not a
      // direction anyone would call a street.
      if (metres < 5) continue;
      const radians = (bearingDegrees(from, to) * Math.PI) / 180;
      x += metres * Math.cos(4 * radians);
      y += metres * Math.sin(4 * radians);
      total += metres;
    }
  }

  if (total === 0) return null;
  // No dominant direction at all - streets pointing every way, which a
  // real estate never does, but a half-traced one might.
  if (Math.hypot(x, y) / total < 0.05) return null;

  return bearingFromGrid((Math.atan2(y, x) * 180) / Math.PI / 4, entrance, middle);
}

/**
 * Turns a street grid's angle into the one direction to draw up the page.
 *
 * A grid angle is only meaningful modulo 90, so it offers four
 * directions. The right one is whichever comes closest to the way you
 * travel walking in from the entrance - that keeps the estate square
 * and the guest facing forwards at the same time.
 */
export function bearingFromGrid(
  gridDeg: number,
  entrance: LatLng,
  middle: LatLng
): number {
  const grid = normaliseBearing(gridDeg);
  const inward = bearingDegrees(entrance, middle);
  let best = grid;
  let bestGap = 360;
  for (let turn = 0; turn < 4; turn++) {
    const candidate = normaliseBearing(grid + turn * 90);
    const gap = Math.abs(((candidate - inward + 540) % 360) - 180);
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  return best;
}

/**
 * The direction the resort itself runs in.
 *
 * Pointing the map from the entrance towards the middle of the homes
 * gets a guest facing the right way, but it leaves the resort sitting on
 * a slight lean - the entrance is rarely dead in line with the centre,
 * and a few degrees out is very visible on a rectangular estate. What
 * actually wants to be vertical is the resort's long axis, which is the
 * main boulevard: that's the line everything else is built square to, so
 * squaring it up squares up every street with it.
 *
 * The long axis is found by principal component analysis of the homes -
 * the direction along which they're most spread out. That leaves two
 * opposite answers, and the entrance picks between them: the one you
 * travel as you come in from the gate.
 */
export function resortAxisBearing(
  entrance: LatLng,
  sites: LatLng[]
): number | null {
  // Two homes define a line but not a spread; below that there's no axis
  // to speak of and the caller should fall back.
  if (sites.length < 3) return null;
  const middle = centroid(sites);
  if (!middle) return null;

  // Metres about the middle, so the sums below aren't dominated by the
  // difference in size between a degree of latitude and one of longitude.
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const site of sites) {
    const { x, y } = toLocalMeters(site, middle);
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }

  // A perfectly square or circular spread has no long axis - every
  // direction is equally the answer - so don't invent one.
  const spread = Math.hypot(sxx - syy, 2 * sxy);
  if (spread < 1e-6) return null;

  // Angle of the principal axis, measured anticlockwise from east.
  const axisFromEast = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // Compass bearings run clockwise from north, so east-anticlockwise
  // becomes north-clockwise by subtracting from 90.
  const axis = normaliseBearing(90 - (axisFromEast * 180) / Math.PI);

  // The axis is a line, not an arrow. Take whichever of its two
  // directions leads away from the entrance and into the resort.
  const inward = bearingDegrees(entrance, middle);
  const difference = Math.abs(((axis - inward + 540) % 360) - 180);
  return difference <= 90 ? axis : normaliseBearing(axis + 180);
}

/**
 * The compass bearing to draw straight up the page.
 *
 * `override` wins when set - that's a resort saying "the main boulevard
 * runs this way, use that". Otherwise it's entrance towards the middle
 * of the homes. Null when there's nothing to work it out from, and the
 * map stays north-up rather than guessing.
 */
export function resolveMapBearing(
  override: number | null | undefined,
  entrance: LatLng | null,
  sites: LatLng[],
  /** The traced streets, when there are any. Preferred over the homes:
   *  see roadGridBearing. */
  roads: { shape: [number, number][] }[] = [],
  /** The street grid's angle, when the database has worked it out. The
   *  road geometry itself isn't readable by visitors, so on that page
   *  this number arrives instead of `roads`. */
  gridDeg: number | null = null
): number | null {
  if (override !== null && override !== undefined && Number.isFinite(override)) {
    return normaliseBearing(override);
  }
  if (!entrance) return null;
  const middle = centroid(sites);
  if (!middle) return null;
  // Two points in the same place have no direction between them.
  if (middle.lat === entrance.lat && middle.lng === entrance.lng) return null;

  // Best to worst: the streets, then the spread of the homes, then
  // simply pointing at the middle. Each is a better answer than the one
  // after it, and each needs more to have been captured first.
  return (
    (gridDeg === null ? null : bearingFromGrid(gridDeg, entrance, middle)) ??
    roadGridBearing(roads, entrance, middle) ??
    resortAxisBearing(entrance, sites) ??
    normaliseBearing(bearingDegrees(entrance, middle))
  );
}
