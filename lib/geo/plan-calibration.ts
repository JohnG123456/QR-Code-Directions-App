// Where a master plan sheet sits in the world, stored so that it stays
// put.
//
// A calibration point pairs a spot on the plan image with the real place
// it sits. Both halves have to be written down, and the second half used
// to be written as metres east and north of the resort's reference point
// - which is the same record the visitor page uses as the entrance.
//
// That coupling was invisible and expensive. Moving the entrance (to the
// actual gate, say, months after the plan was calibrated) left every
// stored point measured from a landmark that was no longer where it had
// been, so the next time anything re-derived the sheet's position it
// placed the whole drawing off by exactly the distance the entrance had
// moved. The site pins, traced roads and boundary stayed where they
// were, because those are absolute, so the drawing and everything drawn
// over it silently disagreed. The published overlay was already stored
// as absolute corners to dodge this - but republishing, the one thing
// anyone would try when a plan looked wrong, re-derived those corners
// and moved it again.
//
// So a calibration point now records an absolute position. Nothing about
// the resort record can move it.
//
// The fit itself still happens in metres, because that is the only frame
// in which "uniform scale plus rotation" means what it should. The
// difference is that the origin for that frame now comes from the
// calibration points themselves, and the same origin is used to convert
// back, so the round trip cancels out and the answer doesn't depend on
// the origin at all.

import type { LatLng } from "./distance";
import { toLocalMeters, fromLocalMeters } from "./local-projection";
import type { Point2D, PointPair } from "./similarity-transform";

/** A calibration point: a spot on the plan image, and where it really is. */
export interface CalibrationPoint {
  plan: Point2D;
  world: LatLng;
}

/** How points were stored before 0013: `world` in metres east/north of
 *  the resort's reference point at the moment the point was clicked. */
export interface LegacyCalibrationPoint {
  plan: Point2D;
  world: { x: number; y: number };
}

/** What a draft can hold. Migration 0013 converts the stored rows, but a
 *  draft saved by a tab that was already open, or a resort whose
 *  migration hasn't been run yet, can still arrive in the old shape. */
export type StoredCalibrationPoint = CalibrationPoint | LegacyCalibrationPoint;

function isLegacy(point: StoredCalibrationPoint): point is LegacyCalibrationPoint {
  return !("lat" in point.world);
}

// Reads either shape, and turns the old one into the new using the
// reference point it was measured from.
//
// NB this reproduces where the plan sits *today*, not where it sat when
// the point was clicked: if the reference point has moved since, the old
// measurement has already lost that information, and no conversion can
// invent it back. A plan that drifted before this migration is still
// drifted after it, and has to be recalibrated. What the conversion buys
// is that it cannot drift again.
export function normalizeCalibrationPoints(
  points: StoredCalibrationPoint[],
  legacyReference: LatLng | null
): CalibrationPoint[] {
  const normalized: CalibrationPoint[] = [];
  for (const point of points) {
    if (!isLegacy(point)) {
      normalized.push(point);
      continue;
    }
    // Nothing to measure the old point from: drop it rather than place
    // the sheet somewhere arbitrary. Fewer than two points reads as
    // "never calibrated", which is the honest answer here.
    if (!legacyReference) continue;
    normalized.push({
      plan: point.plan,
      world: fromLocalMeters(point.world, legacyReference),
    });
  }
  return normalized;
}

// The origin for the metre frame the transform is fitted in.
//
// Any origin gives the same answer, because the same one converts back
// again. Taking the middle of the calibration points keeps the numbers
// small and the equirectangular approximation at its most accurate
// across the sheet, and - the point of the exercise - depends on nothing
// outside the points themselves.
export function calibrationOrigin(points: CalibrationPoint[]): LatLng | null {
  if (points.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const point of points) {
    lat += point.world.lat;
    lng += point.world.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

/** Calibration points in the form the least-squares fit takes: plan
 *  pixels against metres from `origin`. */
export function toPointPairs(points: CalibrationPoint[], origin: LatLng): PointPair[] {
  return points.map((point) => ({
    plan: point.plan,
    world: toLocalMeters(point.world, origin),
  }));
}
