"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SiteStatus } from "@/lib/types";

export interface ActionState {
  error?: string;
  success?: boolean;
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
  const { error } = await supabase.from("sites").insert({
    resort_id: parsed.data.resortId,
    site_number: parsed.data.siteNumber,
    location: `SRID=4326;POINT(${parsed.data.lng} ${parsed.data.lat})`,
    gps_accuracy_m: parsed.data.accuracy ?? null,
    status: "draft",
  });

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
  return { success: true };
}

const importRowSchema = z.object({
  site_number: z.string().trim().min(1),
  label: z.string().trim().optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export interface ImportResult {
  inserted: number;
  errors: string[];
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
    return { inserted: 0, errors };
  }

  const { error, count } = await supabase
    .from("sites")
    .upsert(
      validRows.map((row) => ({ ...row, resort_id: resortId, status: "draft" as SiteStatus })),
      { onConflict: "resort_id,site_number", count: "exact" }
    );

  if (error) {
    errors.push(error.message);
    return { inserted: 0, errors };
  }

  revalidatePath(`/admin/resorts/${resortId}/sites`);
  return { inserted: count ?? validRows.length, errors };
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
  const { error } = await supabase
    .from("sites")
    .update({ status: parsed.status })
    .eq("id", parsed.siteId);

  if (error) throw new Error(error.message);
  revalidatePath(`/admin/resorts/${parsed.resortId}/sites`);
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
  const { error } = await supabase.from("sites").delete().eq("id", parsed.siteId);

  if (error) throw new Error(error.message);
  revalidatePath(`/admin/resorts/${parsed.resortId}/sites`);
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
  const { error } = await supabase
    .from("sites")
    .update({
      location: `SRID=4326;POINT(${parsed.data.lng} ${parsed.data.lat})`,
    })
    .eq("id", parsed.data.siteId);

  if (error) return { error: error.message };

  revalidatePath(`/admin/resorts/${parsed.data.resortId}/capture-map`);
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/sites`);
  return { success: true };
}
