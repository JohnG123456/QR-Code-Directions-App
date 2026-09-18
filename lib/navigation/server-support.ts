import type { SupabaseClient } from "@supabase/supabase-js";

// Whether this deployment's database can actually do live directions.
//
// Asked on the server, while the page is being built, rather than found
// out by a guest. Without this the button was offered to everyone and
// only withdrawn once someone had pressed it: the failure arrived on the
// first route request, which is after the browser has asked for a
// location permission. Offering a feature, taking a permission for it
// and then removing it is a worse thing to do than never offering it.
//
// The probe is `live_snap_limit_m()` - argument-free, does no work, and
// created by the same migration as `route_from_point`, so whether it
// answers is exactly the question "has 0015 been applied here". Keep the
// two in one migration; splitting them would make this lie.

import { MISSING_FUNCTION_CODES } from "./missing-function";

// Once true it stays true: a function does not disappear from under a
// running deployment. A false is never cached, so applying the migration
// switches the feature on by itself, without a redeploy and without
// anyone having to remember this cache exists.
let known = false;

/**
 * Whether this resort is recording what the receiver saw.
 *
 * Read here rather than from a public view, so the answer reaches the
 * page without also being published to everyone who loads it. Never
 * cached: it is a switch staff expect to take effect on the next page
 * load, not on the next deployment.
 */
export async function fetchDiagnosticsEnabled(
  supabase: SupabaseClient,
  resortId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("route_diagnostics_enabled", {
      p_resort_id: resortId,
    });
    if (error) {
      if (!MISSING_FUNCTION_CODES.has(error.code ?? "")) {
        console.error(
          "[visitor] couldn't check diagnostics switch:",
          error.message,
          error.code
        );
      }
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
}

export async function fetchLiveDirectionsSupport(
  supabase: SupabaseClient
): Promise<boolean> {
  if (known) return true;

  try {
    const { error } = await supabase.rpc("live_snap_limit_m");
    if (error) {
      // Not migrated yet is the expected answer, not a fault - the page
      // simply doesn't offer live directions. Anything else is worth a
      // line in the log, where staff can read it.
      if (!MISSING_FUNCTION_CODES.has(error.code ?? "")) {
        console.error(
          "[visitor] couldn't check live directions support:",
          error.message,
          error.code
        );
      }
      return false;
    }
    known = true;
    return true;
  } catch {
    // A thrown client error must not reach the page: directions from the
    // entrance still work, and that is what a guest is here for.
    return false;
  }
}
