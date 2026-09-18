import type { SupabaseClient } from "@supabase/supabase-js";
import { MISSING_FUNCTION_CODES } from "./missing-function";

// What the admin page needs to draw the recording switch.
//
// Read separately from the resort's own row, and allowed to fail, for
// the reason lib/resorts/public-resort.ts spells out: Postgres answers a
// missing column by failing the whole query, so selecting one the
// database hasn't got yet takes the entire page down with it. A
// deployment without migration 0017 should show a switch that says it
// isn't set up, not a broken resort page.

/** Postgres and PostgREST for "that column isn't there". */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

export interface DiagnosticsStatus {
  /** Null where the migration hasn't been applied - told apart from
   *  false, which means applied and switched off. */
  recording: boolean | null;
  rowCount: number | null;
  openUntil: string | null;
}

export async function fetchDiagnosticsStatus(
  supabase: SupabaseClient,
  resortId: string
): Promise<DiagnosticsStatus> {
  const [recording, rowCount, openUntil] = await Promise.all([
    readSwitch(supabase, resortId),
    readRowCount(supabase, resortId),
    readOpenUntil(supabase),
  ]);
  return { recording, rowCount, openUntil };
}

async function readSwitch(
  supabase: SupabaseClient,
  resortId: string
): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from("resorts")
      .select("record_diagnostics")
      .eq("id", resortId)
      .maybeSingle();
    if (error) {
      if (!MISSING_COLUMN_CODES.has(error.code ?? "")) {
        console.error("[admin] couldn't read the diagnostics switch:", error.message);
      }
      return null;
    }
    return (data as { record_diagnostics: boolean } | null)?.record_diagnostics ?? null;
  } catch {
    return null;
  }
}

async function readRowCount(
  supabase: SupabaseClient,
  resortId: string
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from("route_diagnostics")
      .select("id", { count: "exact", head: true })
      .eq("resort_id", resortId);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function readOpenUntil(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("route_diagnostics_open_until");
    if (error) {
      if (!MISSING_FUNCTION_CODES.has(error.code ?? "")) {
        console.error("[admin] couldn't read the diagnostics cut-off:", error.message);
      }
      return null;
    }
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}
