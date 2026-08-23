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

import { bearingDegrees, type LatLng } from "./distance";
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
  sites: LatLng[]
): number | null {
  if (override !== null && override !== undefined && Number.isFinite(override)) {
    return normaliseBearing(override);
  }
  if (!entrance) return null;
  const middle = centroid(sites);
  if (!middle) return null;
  // Two points in the same place have no direction between them.
  if (middle.lat === entrance.lat && middle.lng === entrance.lng) return null;

  // The resort's own long axis where there are enough homes to find one,
  // because that's what makes the estate look square rather than merely
  // pointed the right way. Straight entrance-to-centre otherwise.
  return resortAxisBearing(entrance, sites) ?? normaliseBearing(bearingDegrees(entrance, middle));
}
