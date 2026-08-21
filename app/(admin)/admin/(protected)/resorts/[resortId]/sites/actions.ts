"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dedupeImportRows, mergeImportRows } from "@/lib/sites/merge-import-rows";

export interface ActionState {
  error?: string;
  success?: boolean;
  /** Id of the row just created, so the caller can address it afterwards
   *  (to move, delete or activate it) without reloading the page. */
  siteId?: string;
}

const addSiteSchema = z.object({
  resortId: z.string().uuid(),
  siteNumber: z.string().trim().min(1, "Site number is required"),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().optional(),
});

// Used by the GPS walk-and-drop capture tool. Saves immediately as
// status='draft' - staff review/activate sites from the sites list once a
// full walkthrough is done.
export async function addSite(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = addSiteSchema.safeParse({
    resortId: formData.get("resortId"),
    siteNumber: formData.get("siteNumber"),
    lat: formData.get("lat"),
    lng: formData.get("lng"),
    accuracy: formData.get("accuracy") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  // The new row's id comes back so the map can address the pin it just
  // dropped. Inventing one client-side meant every later edit to that
  // pin - moving it, deleting it, activating it - was aimed at a row
  // that didn't exist, matched nothing, and was silently ignored.
  const { data, error } = await supabase
    .from("sites")
    .insert({
      resort_id: parsed.data.resortId,
      site_number: parsed.data.siteNumber,
      location: `SRID=4326;POINT(${parsed.data.lng} ${parsed.data.lat})`,
      gps_accuracy_m: parsed.data.accuracy ?? null,
      status: "draft",
    })
    .select("id")
    .single();

  if (error) {
    return {
      error:
        error.code === "23505"
          ? `Site ${parsed.data.siteNumber} already exists for this resort.`
          : error.message,
    };
  }

  revalidatePath(`/admin/resorts/${parsed.data.resortId}/sites`);
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/capture-sites`);
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/capture-map`);
  return { success: true, siteId: data.id };
}

const importRowSchema = z.object({
  site_number: z.string().trim().min(1),
  label: z.string().trim().optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export interface ImportResult {
  inserted: number;
  /** Rows that couldn't be written, or a failure that stopped the import. */
  errors: string[];
  /** Things worth telling staff about an import that did succeed. */
  warnings: string[];
}

// Bulk upsert from the CSV import tool. Rows are already parsed/validated
// client-side with PapaParse; we re-validate here since this is a Server
// Action any authenticated staff session can call directly.
export async function bulkUpsertSites(
  resortId: string,
  rows: Record<string, string>[]
): Promise<ImportResult> {
  const supabase = await createClient();
  const errors: string[] = [];
  const warnings: string[] = [];
  const validRows: { site_number: string; label: string | null; location: string }[] = [];

  rows.forEach((row, index) => {
    const parsed = importRowSchema.safeParse(row);
    if (!parsed.success) {
      errors.push(`Row ${index + 2}: ${parsed.error.issues[0]?.message}`);
      return;
    }
    validRows.push({
      site_number: parsed.data.site_number,
      label: parsed.data.label || null,
      location: `SRID=4326;POINT(${parsed.data.longitude} ${parsed.data.latitude})`,
    });
  });

  if (validRows.length === 0) {
    return { inserted: 0, errors, warnings };
  }

  // Collapse repeated site numbers before they reach Postgres - one
  // duplicate in the batch would otherwise fail the whole upsert and write
  // nothing at all. See lib/sites/merge-import-rows.ts.
  const { rows: uniqueRows, duplicates } = dedupeImportRows(validRows);
  if (duplicates.length > 0) {
    warnings.push(
      `Site ${duplicates.length === 1 ? "number" : "numbers"} ${duplicates.join(", ")} ` +
        `appeared more than once - the last position was kept. Check ${
          duplicates.length === 1 ? "it" : "them"
        } on the map.`
    );
  }

  // Read what's already stored so re-importing doesn't undo curation -
  // see lib/sites/merge-import-rows.ts. Fetches every site for the resort
  // rather than filtering by the incoming numbers: it's one small query
  // either way, and avoids building a filter with hundreds of values.
  const { data: existing, error: existingError } = await supabase
    .from("sites")
    .select("site_number, status, label")
    .eq("resort_id", resortId);

  if (existingError) {
    errors.push(existingError.message);
    return { inserted: 0, errors, warnings };
  }

  const { error, count } = await supabase
    .from("sites")
    .upsert(mergeImportRows(resortId, uniqueRows, existing ?? []), {
      onConflict: "resort_id,site_number",
      count: "exact",
    });

  if (error) {
    errors.push(error.message);
    return { inserted: 0, errors, warnings };
  }

  revalidatePath(`/admin/resorts/${resortId}/sites`);
  return { inserted: count ?? uniqueRows.length, errors, warnings };
}

const setSiteStatusSchema = z.object({
  siteId: z.string().uuid(),
  resortId: z.string().uuid(),
  status: z.enum(["active", "inactive", "draft"]),
});

export async function setSiteStatus(formData: FormData) {
  const parsed = setSiteStatusSchema.parse({
    siteId: formData.get("siteId"),
    resortId: formData.get("resortId"),
    status: formData.get("status"),
  });

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("sites")
    .update({ status: parsed.status }, { count: "exact" })
    .eq("id", parsed.siteId);

  if (error) throw new Error(error.message);
  // Postgres treats "no row matched" as a perfectly successful update, so
  // without this an edit aimed at a stale id reports success and changes
  // nothing.
  if (!count) throw new Error("That site no longer exists — reload the page.");
  revalidatePath(`/admin/resorts/${parsed.resortId}/sites`);
  revalidatePath(`/admin/resorts/${parsed.resortId}/capture-map`);
}

const deleteSiteSchema = z.object({
  siteId: z.string().uuid(),
  resortId: z.string().uuid(),
});

export async function deleteSite(formData: FormData) {
  const parsed = deleteSiteSchema.parse({
    siteId: formData.get("siteId"),
    resortId: formData.get("resortId"),
  });

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("sites")
    .delete({ count: "exact" })
    .eq("id", parsed.siteId);

  if (error) throw new Error(error.message);
  if (!count) throw new Error("That site no longer exists — reload the page.");
  revalidatePath(`/admin/resorts/${parsed.resortId}/sites`);
  revalidatePath(`/admin/resorts/${parsed.resortId}/capture-map`);
}

const updateSiteDetailsSchema = z.object({
  siteId: z.string().uuid(),
  resortId: z.string().uuid(),
  siteNumber: z.string().trim().min(1, "Site number is required"),
  label: z.string().trim().optional(),
});

// Renaming a site number or editing its label from the sites list.
// Site numbers are what visitors search on and what re-imports match on,
// so a typo caught later needs correcting in place rather than by
// deleting and re-adding (which would lose the captured position).
export async function updateSiteDetails(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = updateSiteDetailsSchema.safeParse({
    siteId: formData.get("siteId"),
    resortId: formData.get("resortId"),
    siteNumber: formData.get("siteNumber"),
    label: formData.get("label") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("sites")
    .update({
      site_number: parsed.data.siteNumber,
      label: parsed.data.label || null,
    })
    .eq("id", parsed.data.siteId);

  if (error) {
    return {
      error:
        error.code === "23505"
          ? `Site ${parsed.data.siteNumber} already exists for this resort.`
          : error.message,
    };
  }

  revalidatePath(`/admin/resorts/${parsed.data.resortId}/sites`);
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/capture-map`);
  return { success: true };
}

const updateSiteLocationSchema = z.object({
  siteId: z.string().uuid(),
  resortId: z.string().uuid(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// Used when a staff member drags an existing pin to correct its position
// on the satellite capture map.
export async function updateSiteLocation(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = updateSiteLocationSchema.safeParse({
    siteId: formData.get("siteId"),
    resortId: formData.get("resortId"),
    lat: formData.get("lat"),
    lng: formData.get("lng"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("sites")
    .update(
      { location: `SRID=4326;POINT(${parsed.data.lng} ${parsed.data.lat})` },
      { count: "exact" }
    )
    .eq("id", parsed.data.siteId);

  if (error) return { error: error.message };
  if (!count) return { error: "That site no longer exists — reload the page." };

  revalidatePath(`/admin/resorts/${parsed.data.resortId}/capture-map`);
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/sites`);
  return { success: true };
}
