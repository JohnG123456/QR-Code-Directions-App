"use client";

import { Polygon } from "react-leaflet";

// Greys out everything that isn't the resort.
//
// A guest is looking for one home. The surrounding suburb - other
// estates, main roads, bare sand waiting to be built on - is all
// competing for that glance, and none of it helps. This covers it.
//
// It's one polygon with a hole in it: the outer ring is a rectangle big
// enough to cover the world at any zoom, the inner ring is the resort,
// and the fill rule leaves the hole clear. Drawing it that way rather
// than as four rectangles around the resort means it stays correct
// however the map is panned, zoomed or rotated.

/** GeoJSON polygon rings as [lng, lat], the way PostGIS hands them over. */
export type BoundaryRings = [number, number][][];

// Latitude is clamped short of the poles because Web Mercator can't
// project them - at 90 the projected y is infinite and nothing draws.
const WORLD: [number, number][] = [
  [-85, -180],
  [-85, 180],
  [85, 180],
  [85, -180],
];

export function OutsideMask({
  rings,
  colour = "#ffffff",
  opacity = 0.82,
}: {
  rings: BoundaryRings;
  colour?: string;
  opacity?: number;
}) {
  if (rings.length === 0) return null;

  // Only the outer ring of the resort is cut out. A boundary with holes
  // of its own would be odd here, and punching them through would mean
  // greying out the middle of the resort.
  const resort = rings[0].map(([lng, lat]) => [lat, lng] as [number, number]);

  return (
    <Polygon
      positions={[WORLD, resort]}
      interactive={false}
      pathOptions={{
        // No stroke on the mask itself; the outline is drawn separately
        // so it can be a brand colour rather than the mask's.
        stroke: false,
        fillColor: colour,
        fillOpacity: opacity,
        fillRule: "evenodd",
      }}
    />
  );
}

/** The resort's own edge, drawn as a line so the boundary reads as
 *  deliberate rather than as the mask having failed to load. */
export function BoundaryOutline({
  rings,
  colour = "#702890",
}: {
  rings: BoundaryRings;
  colour?: string;
}) {
  if (rings.length === 0) return null;
  const resort = rings[0].map(([lng, lat]) => [lat, lng] as [number, number]);
  return (
    <Polygon
      positions={resort}
      interactive={false}
      pathOptions={{ color: colour, weight: 2, opacity: 0.5, fill: false, dashArray: "6 5" }}
    />
  );
}
