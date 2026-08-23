// Reads of the visitor-facing resort view that are allowed to fail.
//
// The visitor page's main query sticks to columns that have existed
// since the first migration, and anything newer is read separately
// through here. That split exists because of a real failure: a column
// added to the resorts table was selected through public_resorts before
// the view exposed it, and Postgres answers a missing column by failing
// the whole query - so every resort's directions page went down at once,
// showing a guest at a gate "directions are temporarily unavailable".
//
// The rule this encodes: a feature that hasn't been switched on yet must
// degrade to not having it, never to a broken page.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Postgres and PostgREST for "that column isn't there". */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

/**
 * The resort's map rotation override, or null when there isn't one -
 * including when the database hasn't been migrated for it yet, in which
 * case the map simply stays north-up.
 */
export async function fetchMapBearingOverride(
  supabase: SupabaseClient,
  resortId: string
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("public_resorts")
      .select("map_bearing_deg")
      .eq("id", resortId)
      .maybeSingle();

    if (error) {
      // Worth a line in the server log when it's something other than
      // the column not existing yet, which is expected before 0007.
      if (!MISSING_COLUMN_CODES.has(error.code ?? "")) {
        console.error("[visitor] couldn't read map rotation:", error.message, error.code);
      }
      return null;
    }
    if (!data) return null;

    const value = (data as { map_bearing_deg: number | null }).map_bearing_deg;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    // A thrown client error must not reach the page either.
    return null;
  }
}

/**
 * The angle the resort's streets run at, worked out by the database.
 *
 * The road network itself is not readable by visitors and shouldn't be;
 * this asks for the one number the map needs and gets nothing else.
 * Null whenever it can't be had - no roads traced, the migration not
 * run - and the map falls back to squaring up on the homes instead.
 */
export async function fetchRoadGridDegrees(
  supabase: SupabaseClient,
  resortId: string
): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc("resort_road_grid_deg", {
      p_resort_id: resortId,
    });
    if (error) {
      const missing = error.code === "42883" || error.code === "PGRST202";
      if (!missing) {
        console.error("[visitor] couldn't read the street grid:", error.message, error.code);
      }
      return null;
    }
    return typeof data === "number" && Number.isFinite(data) ? data : null;
  } catch {
    return null;
  }
}
