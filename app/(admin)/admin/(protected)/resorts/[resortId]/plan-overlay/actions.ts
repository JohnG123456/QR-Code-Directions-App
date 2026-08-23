"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchRemoteDraft } from "@/lib/masterplan/remote-draft";
import { georeferencePlan } from "@/lib/geo/plan-georeference";
import { downscalePlanForVisitors } from "@/lib/masterplan/downscale-plan";

// Publishing the master plan to the visitor page.
//
// Everything needed is already sitting in the draft: the rendered sheet
// and the reference points that place it in the world. This takes that,
// works out where the sheet's corners fall, shrinks the image to
// something a phone will load, and writes the result as a snapshot.
//
// Stored as corners rather than reference points on purpose. They're
// absolute positions, so moving the resort's reference point afterwards
// can't shift a plan that was already correct.

const resortSchema = z.object({ resortId: z.string().uuid() });

export interface PublishOverlayOutcome {
  ok: boolean;
  /** Said plainly rather than as a generic failure - the causes here are
   *  all things staff can act on (no plan uploaded, not calibrated, no
   *  reference point set). */
  error?: string;
  /** Size of what a visitor will download, to show it was worth doing. */
  bytes?: number;
}

export async function publishPlanOverlay(
  input: z.infer<typeof resortSchema>
): Promise<PublishOverlayOutcome> {
  const parsed = resortSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid resort." };
  const { resortId } = parsed.data;

  const supabase = await createClient();

  const { data: resort, error: resortError } = await supabase
    .from("resorts")
    .select("id, center_lat, center_lng")
    .eq("id", resortId)
    .maybeSingle();

  if (resortError) return { ok: false, error: resortError.message };
  if (!resort) return { ok: false, error: "That resort no longer exists." };
  if (resort.center_lat === null || resort.center_lng === null) {
    return {
      ok: false,
      error:
        "This resort has no reference point yet, so there's nothing to place the plan against. Set one under Settings.",
    };
  }

  const draft = await fetchRemoteDraft(supabase, resortId);
  if (!draft) {
    return {
      ok: false,
      error:
        "No master plan has been uploaded for this resort yet. Upload one under “Import from master plan” first.",
    };
  }
  if (draft.pairs.length < 2) {
    return {
      ok: false,
      error:
        "This master plan hasn't been calibrated. Add at least two reference points in “Import from master plan” so the sheet can be placed on the map.",
    };
  }

  const georeference = georeferencePlan(
    draft.pairs,
    draft.imageWidth,
    draft.imageHeight,
    { lat: resort.center_lat, lng: resort.center_lng }
  );
  if (!georeference) {
    return {
      ok: false,
      error:
        "The plan's reference points don't produce a usable placement. Check them in “Import from master plan” - two points that are very close together can't fix the scale.",
    };
  }

  let shrunk;
  try {
    shrunk = await downscalePlanForVisitors(draft.imageDataUrl);
  } catch {
    return {
      ok: false,
      error:
        "The stored plan image couldn't be read. Re-upload the master plan PDF and try again.",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: writeError } = await supabase.from("resort_plan_overlays").upsert(
    {
      resort_id: resortId,
      image_data_url: shrunk.dataUrl,
      content_type: shrunk.contentType,
      image_width: shrunk.width,
      image_height: shrunk.height,
      top_left_lat: georeference.topLeft.lat,
      top_left_lng: georeference.topLeft.lng,
      top_right_lat: georeference.topRight.lat,
      top_right_lng: georeference.topRight.lng,
      bottom_left_lat: georeference.bottomLeft.lat,
      bottom_left_lng: georeference.bottomLeft.lng,
      source_file_name: draft.fileName,
      published_at: new Date().toISOString(),
      published_by: user?.id ?? null,
    },
    { onConflict: "resort_id" }
  );

  if (writeError) {
    // The one failure staff can't guess at: the table isn't there yet.
    const missingTable = writeError.code === "42P01" || writeError.code === "PGRST205";
    return {
      ok: false,
      error: missingTable
        ? "The database hasn't been updated for this feature yet. Run migration 0005_public_plan_overlay.sql in Supabase."
        : writeError.message,
    };
  }

  revalidatePath(`/admin/resorts/${resortId}`);
  return { ok: true, bytes: shrunk.bytes };
}

export async function unpublishPlanOverlay(
  input: z.infer<typeof resortSchema>
): Promise<PublishOverlayOutcome> {
  const parsed = resortSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid resort." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("resort_plan_overlays")
    .delete()
    .eq("resort_id", parsed.data.resortId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/resorts/${parsed.data.resortId}`);
  return { ok: true };
}
