"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Saving the traced resort perimeter.
//
// Stored as a polygon rather than a list of points so the database can
// answer questions about it - area, whether something is inside - and so
// the visitor page gets one shape whatever produced it.

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const saveSchema = z.object({
  resortId: z.string().uuid(),
  // Three points is the fewest that enclose anything.
  points: z.array(pointSchema).min(3).max(500),
});

export interface BoundarySaveState {
  error?: string;
  savedAt?: number;
  /** Reported back so staff can sanity-check the traced shape against
   *  what they know the resort to be. */
  hectares?: number;
}

export async function saveResortBoundary(
  input: z.infer<typeof saveSchema>
): Promise<BoundarySaveState> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.code === "too_small"
          ? "A boundary needs at least three corners."
          : parsed.error.issues[0]?.message ?? "That boundary isn't valid.",
    };
  }

  // A polygon's ring has to come back to where it started; the editor
  // works in open points, so it's closed here rather than asking staff
  // to place the last corner exactly on the first.
  const ring = [...parsed.data.points, parsed.data.points[0]];
  const wkt = `SRID=4326;POLYGON((${ring.map((p) => `${p.lng} ${p.lat}`).join(", ")}))`;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("set_resort_boundary", { p_resort_id: parsed.data.resortId, p_wkt: wkt })
    .single();

  if (error) {
    const missing = error.code === "42883" || error.code === "PGRST202";
    return {
      error: missing
        ? "Saving a boundary needs a database update that hasn't been run yet — run supabase/migrations/0008_resort_boundary.sql in Supabase."
        : error.message,
    };
  }

  revalidatePath(`/admin/resorts/${parsed.data.resortId}/boundary`);
  revalidatePath(`/r`);
  return {
    savedAt: Date.now(),
    hectares: typeof data === "number" ? data : undefined,
  };
}

const clearSchema = z.object({ resortId: z.string().uuid() });

export async function clearResortBoundary(
  input: z.infer<typeof clearSchema>
): Promise<BoundarySaveState> {
  const parsed = clearSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid resort." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("resorts")
    .update({ boundary: null })
    .eq("id", parsed.data.resortId);

  if (error) return { error: error.message };

  revalidatePath(`/admin/resorts/${parsed.data.resortId}/boundary`);
  revalidatePath(`/r`);
  return { savedAt: Date.now() };
}
