"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const createResortSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugPattern, "Use lowercase letters, numbers and hyphens only"),
});

export async function createResort(formData: FormData) {
  const parsed = createResortSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("resorts")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      created_by: user?.id,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      error.code === "23505"
        ? "That slug is already in use by another resort."
        : error.message
    );
  }

  revalidatePath("/admin/resorts");
  redirect(`/admin/resorts/${data.id}`);
}

const updateResortSchema = z.object({
  resortId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugPattern, "Use lowercase letters, numbers and hyphens only"),
  isPublished: z.boolean(),
  centerLat: z.coerce.number().min(-90).max(90).nullable(),
  centerLng: z.coerce.number().min(-180).max(180).nullable(),
  defaultZoom: z.coerce.number().int().min(1).max(22),
  totalHomes: z.coerce.number().int().min(1).max(5000).nullable(),
});

export async function updateResort(formData: FormData) {
  const rawLat = formData.get("centerLat");
  const rawLng = formData.get("centerLng");
  const rawTotalHomes = formData.get("totalHomes");

  const parsed = updateResortSchema.safeParse({
    resortId: formData.get("resortId"),
    name: formData.get("name"),
    slug: formData.get("slug"),
    isPublished: formData.get("isPublished") === "on",
    centerLat: rawLat ? rawLat : null,
    centerLng: rawLng ? rawLng : null,
    defaultZoom: formData.get("defaultZoom") || 19,
    totalHomes: rawTotalHomes ? rawTotalHomes : null,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const supabase = await createClient();

  const center =
    parsed.data.centerLat !== null && parsed.data.centerLng !== null
      ? `SRID=4326;POINT(${parsed.data.centerLng} ${parsed.data.centerLat})`
      : null;

  const { error } = await supabase
    .from("resorts")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      is_published: parsed.data.isPublished,
      default_zoom: parsed.data.defaultZoom,
      total_homes: parsed.data.totalHomes,
      center,
    })
    .eq("id", parsed.data.resortId);

  if (error) {
    throw new Error(
      error.code === "23505"
        ? "That slug is already in use by another resort."
        : error.message
    );
  }

  revalidatePath(`/admin/resorts/${parsed.data.resortId}`);
  revalidatePath("/admin/resorts");
}

export async function deleteResort(formData: FormData) {
  const resortId = z.string().uuid().parse(formData.get("resortId"));

  const supabase = await createClient();
  const { error } = await supabase.from("resorts").delete().eq("id", resortId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/resorts");
  redirect("/admin/resorts");
}
