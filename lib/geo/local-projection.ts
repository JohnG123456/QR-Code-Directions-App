import { EARTH_RADIUS_M, type LatLng } from "./distance";

// Derived from the same sphere lib/geo/distance.ts measures on, rather
// than hand-picked WGS84 figures. The two models differ by about 0.5%,
// which sounds harmless but isn't quite: they disagree by different
// amounts in latitude and longitude, so a plan sheet projected with one
// and measured with the other comes out very slightly skewed - about a
// third of a degree of false rotation across a 400m drawing. Sharing one
// model makes the round trip exact.
const METERS_PER_DEGREE_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

// Equirectangular approximation: accurate to well under a meter over the
// few-hundred-metre span of a single resort, which is all this is used
// for (never for distances spanning multiple degrees).
export function toLocalMeters(point: LatLng, reference: LatLng): { x: number; y: number } {
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.cos((reference.lat * Math.PI) / 180);
  return {
    x: (point.lng - reference.lng) * metersPerDegreeLng,
    y: (point.lat - reference.lat) * METERS_PER_DEGREE_LAT,
  };
}

export function fromLocalMeters(xy: { x: number; y: number }, reference: LatLng): LatLng {
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.cos((reference.lat * Math.PI) / 180);
  return {
    lat: reference.lat + xy.y / METERS_PER_DEGREE_LAT,
    lng: reference.lng + xy.x / metersPerDegreeLng,
  };
}
