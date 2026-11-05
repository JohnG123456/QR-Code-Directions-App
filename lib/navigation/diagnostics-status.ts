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
   *  false, which means applied and switched off. A session whose end
   *  time has passed counts as off, whatever the switch column says. */
  recording: boolean | null;
  /** When the current session stops by itself (migration 0018). */
  recordingUntil: string | null;
  /** True once 0018 is applied: recording runs in sessions with an end
   *  time, and there is no fixed cut-off date any more. */
  sessions: boolean;
  rowCount: number | null;
  /** The old fixed cut-off date from 0016. Null once 0018 has dropped it. */
  openUntil: string | null;
}

export async function fetchDiagnosticsStatus(
  supabase: SupabaseClient,
  resortId: string
): Promise<DiagnosticsStatus> {
  const [session, rowCount, openUntil] = await Promise.all([
    readSession(supabase, resortId),
    readRowCount(supabase, resortId),
    readOpenUntil(supabase),
  ]);
  return { ...session, rowCount, openUntil };
}

type SessionState = Pick<DiagnosticsStatus, "recording" | "recordingUntil" | "sessions">;

// Tries the 0018 shape first (switch + end time) and falls back to the
// 0017 shape (switch only), so this code can be deployed before or after
// the migration is applied.
async function readSession(
  supabase: SupabaseClient,
  resortId: string
): Promise<SessionState> {
  try {
    const { data, error } = await supabase
      .from("resorts")
      .select("record_diagnostics, record_diagnostics_until")
      .eq("id", resortId)
      .maybeSingle();
    if (!error) {
      const row = data as {
        record_diagnostics: boolean;
        record_diagnostics_until: string | null;
      } | null;
      if (!row) return { recording: null, recordingUntil: null, sessions: true };
      const until = row.record_diagnostics_until;
      const live =
        row.record_diagnostics && until !== null && new Date(until).getTime() > Date.now();
      return { recording: live, recordingUntil: live ? until : null, sessions: true };
    }
    if (!MISSING_COLUMN_CODES.has(error.code ?? "")) {
      console.error("[admin] couldn't read the diagnostics session:", error.message);
    }
  } catch {
    // fall through to the older shape
  }
  return {
    recording: await readSwitch(supabase, resortId),
    recordingUntil: null,
    sessions: false,
  };
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
