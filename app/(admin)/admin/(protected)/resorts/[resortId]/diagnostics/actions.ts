"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Turning the recording of live directions on and off.
//
// Its own action rather than a field on the settings form, because it is
// not a setting: it is switched on for an afternoon's driving and off
// again afterwards, and burying it among the name and the map rotation
// would mean saving the whole form to change it. One button, one write.

const resortSchema = z.object({ resortId: z.string().uuid() });
const schema = resortSchema.extend({
  on: z.boolean(),
  /** How long this session runs before it stops by itself. The database
   *  pulls anything over 12 hours back to 12 (migration 0018). */
  hours: z.number().int().min(1).max(12).optional(),
});

export interface DiagnosticsOutcome {
  ok: boolean;
  error?: string;
  /** Where it ended up, so the page can say so without re-reading. */
  recording?: boolean;
  /** When this session stops by itself, where the database supports it. */
  recordingUntil?: string | null;
  /** How many rows are held for this resort, so it is obvious whether
   *  there is anything to look at - and whether anything needs clearing
   *  out before the codes go public. */
  rows?: number;
}

export async function setRecordDiagnostics(
  input: z.infer<typeof schema>
): Promise<DiagnosticsOutcome> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { on, resortId } = parsed.data;
  const hours = parsed.data.hours ?? 4;

  // Every session gets an end time, so a switch left on stops by itself
  // the same day (migration 0018). The database clamps it to 12 hours
  // and clears it when switched off.
  const until = on ? new Date(Date.now() + hours * 3_600_000).toISOString() : null;
  let { data, error } = await supabase
    .from("resorts")
    .update({ record_diagnostics: on, record_diagnostics_until: until })
    .eq("id", resortId)
    .select("record_diagnostics_until")
    .maybeSingle();

  // Before 0018 there's no end-time column: fall back to the switch alone,
  // which the old fixed cut-off date still covers.
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    ({ data, error } = await supabase
      .from("resorts")
      .update({ record_diagnostics: on })
      .eq("id", resortId)
      .select("id")
      .maybeSingle());
  }

  if (error) {
    // The column arrives with migration 0017; a deployment that hasn't
    // had it applied should say so rather than fail silently.
    const missing = error.code === "42703" || error.code === "PGRST204";
    return {
      ok: false,
      error: missing
        ? "This database hasn't had migration 0017 applied yet, so there's nothing to switch."
        : error.message,
    };
  }

  revalidatePath(`/admin/resorts/${resortId}`);
  const saved = (data as { record_diagnostics_until?: string | null } | null)
    ?.record_diagnostics_until;
  return { ok: true, recording: on, recordingUntil: saved ?? null };
}

/** Throws away everything recorded for this resort. */
export async function clearDiagnostics(
  input: z.infer<typeof resortSchema>
): Promise<DiagnosticsOutcome> {
  const parsed = resortSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("route_diagnostics")
    .delete()
    .eq("resort_id", parsed.data.resortId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/resorts/${parsed.data.resortId}`);
  return { ok: true, rows: 0 };
}
