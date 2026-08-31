// How far a cut-off junction sits from the network it was meant to join.
//
// The usual break is a road that stops a couple of metres short of
// another one: on screen at low zoom the two look joined, and the only
// way to tell them apart is the number. Measuring the gap turns "one
// junction isn't connected" into "it's 1.8 m from the nearest road",
// which is the difference between hunting and dragging.
//
// Pure and free of Leaflet so it can be tested without a browser.

import { EARTH_RADIUS_M, type LatLng } from "@/lib/geo/distance";
import { closestPointOnPolyline, type Pt } from "@/lib/network/snap";

export interface Road {
  id: string;
  shape: [number, number][];
}

export interface Gap {
  /** Straight-line distance to the nearest point on the nearest road. */
  distanceM: number;
  /** That point, so the map can show what it nearly joins onto. */
  lat: number;
  lng: number;
  roadId: string;
}

// Flat-earth projection about a local origin. Over the tens of metres
// this ever measures, the error is far below the metre the answer is
// rounded to, and it lets the same closest-point-on-line maths the
// snapping uses do the work.
function project(origin: LatLng, point: LatLng): Pt {
  const rad = Math.PI / 180;
  return {
    x: (point.lng - origin.lng) * rad * EARTH_RADIUS_M * Math.cos(origin.lat * rad),
    y: (point.lat - origin.lat) * rad * EARTH_RADIUS_M,
  };
}

function unproject(origin: LatLng, point: Pt): LatLng {
  const rad = Math.PI / 180;
  return {
    lat: origin.lat + point.y / EARTH_RADIUS_M / rad,
    lng: origin.lng + point.x / EARTH_RADIUS_M / Math.cos(origin.lat * rad) / rad,
  };
}

/** The nearest point on any of the given roads to a junction. Pass only
 *  the roads that are actually reachable - the gap that matters is the
 *  one to the connected part of the network, not to the orphan's own
 *  roads, which it is already joined to. */
export function nearestGap(from: LatLng, roads: Road[]): Gap | null {
  const origin = from;
  const at = project(origin, from);

  let best: Gap | null = null;
  for (const road of roads) {
    if (road.shape.length < 2) continue;
    const hit = closestPointOnPolyline(
      at,
      road.shape.map(([lat, lng]) => project(origin, { lat, lng }))
    );
    if (!hit) continue;
    if (best && hit.distance >= best.distanceM) continue;
    const point = unproject(origin, hit.point);
    best = { distanceM: hit.distance, lat: point.lat, lng: point.lng, roadId: road.id };
  }
  return best;
}
