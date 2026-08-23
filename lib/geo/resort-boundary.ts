// The resort's outline, as the visitor page needs it.
//
// PostGIS hands back GeoJSON, which can be a Polygon or - if a resort
// ever ended up in two separate pieces - a MultiPolygon. Both are
// flattened to a list of rings so the map has one shape to draw
// regardless, and anything unrecognisable becomes an empty list: no
// outline is a map without the surroundings greyed out, which is worse
// than it could be but still perfectly usable.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Rings as [lng, lat], the order GeoJSON uses. */
export type BoundaryRings = [number, number][][];

export function boundaryToRings(geojson: unknown): BoundaryRings {
  if (!geojson || typeof geojson !== "object") return [];
  const shape = geojson as { type?: unknown; coordinates?: unknown };

  if (shape.type === "Polygon" && Array.isArray(shape.coordinates)) {
    return (shape.coordinates as [number, number][][]).filter(
      (ring) => Array.isArray(ring) && ring.length >= 4
    );
  }
  if (shape.type === "MultiPolygon" && Array.isArray(shape.coordinates)) {
    // Only each piece's outer ring: the mask cuts out the resort, and
    // punching a polygon's own holes through would grey out its middle.
    return (shape.coordinates as [number, number][][][])
      .map((polygon) => polygon[0])
      .filter((ring) => Array.isArray(ring) && ring.length >= 4);
  }
  return [];
}

export async function fetchResortBoundary(
  supabase: SupabaseClient,
  resortId: string
): Promise<BoundaryRings> {
  const { data, error } = await supabase
    .from("public_resort_boundaries")
    .select("boundary")
    .eq("resort_id", resortId)
    .maybeSingle();

  // A missing view means migration 0007 hasn't been run. That's a reason
  // to skip the mask, not to fail the visitor's page.
  if (error || !data) return [];
  return boundaryToRings((data as { boundary: unknown }).boundary);
}
