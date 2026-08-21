// Puts the master plan drawing onto the map in its real-world position.
//
// The import tool already fits a similarity transform from plan-image
// pixels to local metres so it can turn printed site numbers into
// coordinates. The same transform georeferences the whole sheet: convert
// three corners of the image and you know exactly where the drawing sits,
// how big it is, and how much it's rotated relative to north.
//
// That matters for the road digitizer. Satellite imagery only shows roads
// that have actually been built, and these resorts are half-built by
// definition - the master plan is the only place the full street layout
// exists. Tracing over the georeferenced plan means the network is right
// before the asphalt is.
//
// Three corners rather than four: a similarity transform has no shear, so
// the fourth is implied, and three points are exactly what an affine
// CSS/canvas transform needs.

import { fitPlanToWorldTransform, type PointPair } from "./similarity-transform";
import { fromLocalMeters } from "./local-projection";
import type { LatLng } from "./distance";

export interface PlanGeoreference {
  topLeft: LatLng;
  topRight: LatLng;
  bottomLeft: LatLng;
  /** Degrees clockwise from north, for showing staff how the sheet sits. */
  rotationDegrees: number;
  /** Metres per plan pixel - a sanity check on the calibration. */
  metresPerPixel: number;
}

export function georeferencePlan(
  pairs: PointPair[],
  imageWidth: number,
  imageHeight: number,
  reference: LatLng
): PlanGeoreference | null {
  // Two points is the minimum the fit needs; fewer means the plan was
  // never calibrated and there's nothing to place it by.
  if (pairs.length < 2 || imageWidth <= 0 || imageHeight <= 0) return null;

  let fit;
  try {
    fit = fitPlanToWorldTransform(pairs);
  } catch {
    return null;
  }

  const corner = (x: number, y: number) =>
    fromLocalMeters(fit.transform.apply({ x, y }), reference);

  return {
    topLeft: corner(0, 0),
    topRight: corner(imageWidth, 0),
    bottomLeft: corner(0, imageHeight),
    // The fit's rotation is measured in the y-flipped frame it solves in,
    // so it's already the angle from north, just anticlockwise-positive.
    rotationDegrees: (((-fit.transform.rotationRadians * 180) / Math.PI) + 360) % 360,
    metresPerPixel: fit.transform.scale,
  };
}
