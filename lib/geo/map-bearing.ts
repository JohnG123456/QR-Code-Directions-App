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
  return normaliseBearing(bearingDegrees(entrance, middle));
}
