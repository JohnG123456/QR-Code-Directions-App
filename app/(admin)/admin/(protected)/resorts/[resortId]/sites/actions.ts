"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dedupeImportRows, mergeImportRows } from "@/lib/sites/merge-import-rows";
import { normaliseSiteNumber } from "@/lib/sites/site-number";

export interface ActionState {
  error?: string;
  success?: boolean;
  /** Id of the row just created, so the caller can address it afterwards
   *  (to move, delete or activate it) without reloading the page. */
  siteId?: string;
}

// Stored the way it is written down: three digits with any leading
// zeros, and an upper-case letter where a block has been split. Done
// here rather than in each screen so a number typed on the map, typed
// on the sites list, or read off a plan all end up identical - which is
// what stops the same home appearing twice under 13 and 013.
const siteNumberSchema = z
  .string()
  .trim()
  .min(1, "Site number is required")
  .transform((raw, ctx) => {
    const normalised = normaliseSiteNumber(raw);
    if (!normalised) {
      ctx.addIssue({
        code: "custom",
        message:
          "A site number is up to three digits, with an optional letter for a duplex - like 87 or 87A.",
      });
      return z.NEVER;
    }
    return normalised;
  });


const addSiteSchema = z.object({
  resortId: z.string().uuid(),
  siteNumber: siteNumberSchema,
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

  // Putting the number back by hand withdraws the note left when it was
  // deleted - that's someone saying it is a site here after all, and a
  // later import should treat it as one.
  await supabase
    .from("removed_site_numbers")
    .delete()
    .eq("resort_id", parsed.data.resortId)
    .eq("site_number", parsed.data.siteNumber);

  revalidatePath(`/admin/resorts/${parsed.data.resortId}/sites`);
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/capture-sites`);
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/capture-map`);
  return { success: true, siteId: data.id };
}

const importRowSchema = z.object({
  // Same rule as typing one by hand: a CSV or a scanned plan that says
  // "13" means site 013, and must not create a second home beside it.
  site_number: siteNumberSchema,
  label: z.string().trim().optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export interface ImportResult {
  inserted: number;
  /** Numbers not already stored: genuinely new homes. */
  adding?: number;
  /** Numbers already stored, whose position the import would overwrite -
   *  which is where hand-corrected positions go. */
  moving?: number;
  /** Numbers left out because they were deliberately removed before. */
  skipped?: number;
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
  rows: Record<string, string>[],
  /** Works out what the import would do and reports it without writing
   *  anything, so the tool can say what is about to happen while it can
   *  still be called off. */
  options: { dryRun?: boolean } = {}
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

  // Numbers someone has already decided are not sites here. Left out, or
  // a plan revision undoes every one of those decisions at once.
  //
  // A missing table means migration 0011 hasn't been run: skip nothing
  // rather than fail the import, which is how it behaved before.
  const { data: removedRows } = await supabase
    .from("removed_site_numbers")
    .select("site_number")
    .eq("resort_id", resortId);
  const removed = new Set((removedRows ?? []).map((r) => r.site_number as string));

  const wanted = uniqueRows.filter((row) => !removed.has(row.site_number));
  const skipped = uniqueRows.length - wanted.length;
  // Not on a dry run: the confirmation panel words the skipped count
  // itself, and saying it twice on the one screen just reads as noise.
  if (skipped > 0 && !options.dryRun) {
    warnings.push(
      `${skipped} number${skipped === 1 ? "" : "s"} you previously removed ` +
        `${skipped === 1 ? "was" : "were"} left out. Add ${
          skipped === 1 ? "it" : "them"
        } back by hand if the new plan really does have ${
          skipped === 1 ? "a home" : "homes"
        } there.`
    );
  }

  const existingNumbers = new Set((existing ?? []).map((site) => site.site_number));
  const adding = wanted.filter((row) => !existingNumbers.has(row.site_number)).length;
  const moving = wanted.length - adding;

  if (options.dryRun) {
    return { inserted: 0, errors, warnings, adding, moving, skipped };
  }

  if (wanted.length === 0) {
    return { inserted: 0, errors, warnings, adding, moving, skipped };
  }

  const { error, count } = await supabase
    .from("sites")
    .upsert(mergeImportRows(resortId, wanted, existing ?? []), {
      onConflict: "resort_id,site_number",
      count: "exact",
    });

  if (error) {
    errors.push(error.message);
    return { inserted: 0, errors, warnings };
  }

  revalidatePath(`/admin/resorts/${resortId}/sites`);
  revalidatePath(`/admin/resorts/${resortId}/capture-map`);
  return { inserted: count ?? wanted.length, errors, warnings, adding, moving, skipped };
}

const restoreSiteSchema = z.object({
  resortId: z.string().uuid(),
  siteNumber: siteNumberSchema,
  label: z.string().nullable(),
  status: z.enum(["active", "inactive", "draft"]),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// Puts back a site that was just deleted, for Undo. Unlike addSite this
// restores the label and status it had, so undoing a deletion actually
// returns things to how they were rather than leaving a bare draft pin.
//
// The row gets a new id - the old one is gone for good - which is why the
// map replaces its copy with what comes back.
export async function restoreSite(
  input: z.infer<typeof restoreSiteSchema>
): Promise<ActionState> {
  const parsed = restoreSiteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .insert({
      resort_id: parsed.data.resortId,
      site_number: parsed.data.siteNumber,
      label: parsed.data.label,
      status: parsed.data.status,
      location: `SRID=4326;POINT(${parsed.data.lng} ${parsed.data.lat})`,
    })
    .select("id")
    .single();

  if (error) {
    return {
      error:
        error.code === "23505"
          ? `Site ${parsed.data.siteNumber} already exists again — nothing to undo.`
          : error.message,
    };
  }

  revalidatePath(`/admin/resorts/${parsed.data.resortId}/sites`);
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/capture-map`);
  return { success: true, siteId: data.id };
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
  const { data, error } = await supabase
    .from("sites")
    .update({ status: parsed.status })
    .eq("id", parsed.siteId)
    .select("id");

  if (error) throw new Error(error.message);
  // Postgres treats "no row matched" as a perfectly successful update, so
  // without this an edit aimed at a stale id reports success and changes
  // nothing. Asking for the row back is what makes the difference
  // visible - see the note on updateSiteLocation.
  if (!data?.length) throw new Error("That site no longer exists — reload the page.");
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
  const { data, error } = await supabase
    .from("sites")
    .delete()
    .eq("id", parsed.siteId)
    .select("id, site_number");

  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("That site no longer exists — reload the page.");

  // Leave a note that this number isn't a site here, so re-importing the
  // plan doesn't put it straight back. Best effort: a note that fails to
  // save is a nuisance at the next import, not a reason to fail a
  // deletion that has already happened.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("removed_site_numbers").upsert(
    {
      resort_id: parsed.resortId,
      site_number: data[0].site_number,
      removed_at: new Date().toISOString(),
      removed_by: user?.id ?? null,
    },
    { onConflict: "resort_id,site_number" }
  );
  revalidatePath(`/admin/resorts/${parsed.resortId}/sites`);
  revalidatePath(`/admin/resorts/${parsed.resortId}/capture-map`);
}

const updateSiteDetailsSchema = z.object({
  siteId: z.string().uuid(),
  resortId: z.string().uuid(),
  siteNumber: siteNumberSchema,
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
  // .select() rather than a row count: it makes PostgREST return the rows
  // it actually touched, which is the only unambiguous way to tell "the
  // edit was applied" from "nothing matched". A count on a mutation
  // depends on the server sending Content-Range back for it, and getting
  // that wrong would mean telling staff their edit failed when it saved
  // perfectly well.
  const { data, error } = await supabase
    .from("sites")
    .update({ location: `SRID=4326;POINT(${parsed.data.lng} ${parsed.data.lat})` })
    .eq("id", parsed.data.siteId)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "That site no longer exists — reload the page." };

  revalidatePath(`/admin/resorts/${parsed.data.resortId}/capture-map`);
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/sites`);
  return { success: true };
}

const activateDraftsSchema = z.object({ resortId: z.string().uuid() });

// Makes every draft site visible to visitors in one go.
//
// Importing a master plan lands a few hundred sites as drafts on purpose,
// so nothing half-checked goes live. But turning them on afterwards meant
// working a dropdown once per site - 244 of them at Piara Waters - which
// is not a step anyone would finish. This is the moment a resort actually
// goes live, so it should be one deliberate action, not an afternoon.
export async function activateAllDrafts(formData: FormData): Promise<void> {
  const parsed = activateDraftsSchema.parse({ resortId: formData.get("resortId") });

  const supabase = await createClient();
  const { error } = await supabase
    .from("sites")
    .update({ status: "active" })
    .eq("resort_id", parsed.resortId)
    .eq("status", "draft");

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/resorts/${parsed.resortId}/sites`);
  revalidatePath(`/admin/resorts/${parsed.resortId}/capture-map`);
}
