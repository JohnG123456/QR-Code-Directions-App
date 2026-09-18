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
const schema = resortSchema.extend({ on: z.boolean() });

export interface DiagnosticsOutcome {
  ok: boolean;
  error?: string;
  /** Where it ended up, so the page can say so without re-reading. */
  recording?: boolean;
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
  const { error } = await supabase
    .from("resorts")
    .update({ record_diagnostics: parsed.data.on })
    .eq("id", parsed.data.resortId);

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

  revalidatePath(`/admin/resorts/${parsed.data.resortId}`);
  return { ok: true, recording: parsed.data.on };
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
