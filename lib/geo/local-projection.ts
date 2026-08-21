import type { LatLng } from "./distance";

const METERS_PER_DEGREE_LAT = 110_540;

// Equirectangular approximation: accurate to well under a meter over the
// few-hundred-metre span of a single resort, which is all this is used
// for (never for distances spanning multiple degrees).
export function toLocalMeters(point: LatLng, reference: LatLng): { x: number; y: number } {
  const metersPerDegreeLng =
    111_320 * Math.cos((reference.lat * Math.PI) / 180);
  return {
    x: (point.lng - reference.lng) * metersPerDegreeLng,
    y: (point.lat - reference.lat) * METERS_PER_DEGREE_LAT,
  };
}

export function fromLocalMeters(xy: { x: number; y: number }, reference: LatLng): LatLng {
  const metersPerDegreeLng =
    111_320 * Math.cos((reference.lat * Math.PI) / 180);
  return {
    lat: reference.lat + xy.y / METERS_PER_DEGREE_LAT,
    lng: reference.lng + xy.x / metersPerDegreeLng,
  };
}
