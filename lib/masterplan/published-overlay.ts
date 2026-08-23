// The master plan as visitors get it: read side.
//
// Two deliberate splits here.
//
// The image is never fetched with the placement. A guest's phone needs
// the corners to know where to draw the sheet, and that is a handful of
// numbers; the image itself is a separate request so the browser can
// cache it across every site they look up, instead of re-downloading it
// inside the page HTML on each search.
//
// And this reads public_plan_overlays, not the drafts table. Publishing
// is a snapshot (see supabase/migrations/0005), so a plan being
// re-uploaded and re-calibrated by staff never leaks half-done onto the
// page a guest is reading at the gate.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LatLng } from "@/lib/geo/distance";

export interface PlanOverlayPlacement {
  resortId: string;
  imageWidth: number;
  imageHeight: number;
  topLeft: LatLng;
  topRight: LatLng;
  bottomLeft: LatLng;
  /** Changes whenever staff republish, so it can bust the image cache. */
  publishedAt: string;
}

export interface PlanOverlayImage {
  dataUrl: string;
  contentType: string;
  publishedAt: string;
}

const PLACEMENT_COLUMNS =
  "resort_id, image_width, image_height, top_left_lat, top_left_lng, top_right_lat, top_right_lng, bottom_left_lat, bottom_left_lng, published_at";

interface PlacementRow {
  resort_id: string;
  image_width: number;
  image_height: number;
  top_left_lat: number;
  top_left_lng: number;
  top_right_lat: number;
  top_right_lng: number;
  bottom_left_lat: number;
  bottom_left_lng: number;
  published_at: string;
}

function rowToPlacement(row: PlacementRow): PlanOverlayPlacement {
  return {
    resortId: row.resort_id,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    topLeft: { lat: row.top_left_lat, lng: row.top_left_lng },
    topRight: { lat: row.top_right_lat, lng: row.top_right_lng },
    bottomLeft: { lat: row.bottom_left_lat, lng: row.bottom_left_lng },
    publishedAt: row.published_at,
  };
}

/** What a visitor's page needs to place the plan. Null when this resort
 *  has no published plan - the map then shows satellite imagery alone,
 *  exactly as it did before. */
export async function fetchPublicPlanPlacement(
  supabase: SupabaseClient,
  resortId: string
): Promise<PlanOverlayPlacement | null> {
  const { data, error } = await supabase
    .from("public_plan_overlays")
    .select(PLACEMENT_COLUMNS)
    .eq("resort_id", resortId)
    .maybeSingle();

  // A missing table means migration 0005 hasn't been run yet. That is a
  // reason to show no overlay, not to fail the visitor's whole page.
  if (error || !data) return null;
  return rowToPlacement(data as PlacementRow);
}

export async function fetchPublicPlanImage(
  supabase: SupabaseClient,
  resortId: string
): Promise<PlanOverlayImage | null> {
  const { data, error } = await supabase
    .from("public_plan_overlays")
    .select("image_data_url, content_type, published_at")
    .eq("resort_id", resortId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    image_data_url: string;
    content_type: string;
    published_at: string;
  };
  return {
    dataUrl: row.image_data_url,
    contentType: row.content_type,
    publishedAt: row.published_at,
  };
}

export interface PublishedOverlayStatus {
  publishedAt: string;
  sourceFileName: string | null;
  bytes: number;
}

/** Distinguishes "nothing published yet" from "the table isn't there
 *  yet", the same way describePlanOverlay does for drafts. Being told to
 *  run a migration beats clicking a button that fails. */
export type PublishedOverlayLookup =
  | { kind: "published"; status: PublishedOverlayStatus }
  | { kind: "none" }
  | { kind: "not-migrated" };

const MISSING_TABLE_CODES = new Set([
  "42P01", // Postgres: undefined_table
  "PGRST205", // PostgREST: table not found in the schema cache
]);

/** The admin side: is a plan published for this resort, and when. Reads
 *  the base table so it still answers for an unpublished resort, whose
 *  overlay is deliberately invisible through the public view. */
export async function fetchPublishedOverlayStatus(
  supabase: SupabaseClient,
  resortId: string
): Promise<PublishedOverlayLookup> {
  const { data, error } = await supabase
    .from("resort_plan_overlays")
    .select("published_at, source_file_name, image_data_url")
    .eq("resort_id", resortId)
    .maybeSingle();

  if (error) {
    return MISSING_TABLE_CODES.has(error.code) ? { kind: "not-migrated" } : { kind: "none" };
  }
  if (!data) return { kind: "none" };
  const row = data as {
    published_at: string;
    source_file_name: string | null;
    image_data_url: string;
  };
  return {
    kind: "published",
    status: {
      publishedAt: row.published_at,
      sourceFileName: row.source_file_name,
      // Base64 carries 3 bytes in every 4 characters; near enough to show
      // staff what a phone has to download.
      bytes: Math.round((row.image_data_url.length * 3) / 4),
    },
  };
}

/** Splits a stored data URL back into bytes for the image route. */
export function decodeDataUrl(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.startsWith("data:")) return null;
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}
