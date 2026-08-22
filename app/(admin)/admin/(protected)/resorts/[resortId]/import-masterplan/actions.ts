"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  fetchRemoteDraft,
  fetchRemoteDraftSummary,
  type RemoteDraft,
  type RemoteDraftSummary,
} from "@/lib/masterplan/remote-draft";

// Autosave/load/clear for the durable copy of a master plan draft.
// See lib/masterplan/remote-draft.ts for why there are two copies.
//
// These deliberately never carry the plan image: it's written once by the
// extract API route, and a Server Action request body is capped at 1MB by
// default - a couple of MB of base64 would fail every autosave.

const saveDraftSchema = z.object({
  resortId: z.string().uuid(),
  fileName: z.string().nullable(),
  step: z.string().min(1),
  labels: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      x: z.number(),
      y: z.number(),
    })
  ),
  pairs: z.array(
    z.object({
      plan: z.object({ x: z.number(), y: z.number() }),
      world: z.object({ x: z.number(), y: z.number() }),
    })
  ),
  lastImportedAt: z.number().nullable(),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export interface SaveDraftOutcome {
  ok: boolean;
  /** What actually went wrong, so the tool can say so instead of
   *  guessing. "Your connection is probably down" is a poor thing to tell
   *  someone whose real problem is an un-run migration. */
  error?: string;
}

export async function saveMasterplanDraft(
  input: SaveDraftInput
): Promise<SaveDraftOutcome> {
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid draft" };
  }

  const supabase = await createClient();
  // update, not upsert: the row is created by the extract route along
  // with the image, and a draft without an image can't be resumed.
  //
  // .select() rather than a row count - it returns the rows actually
  // touched, which is unambiguous, where a count on a mutation depends on
  // the server sending Content-Range back for it.
  const { data, error } = await supabase
    .from("masterplan_drafts")
    .update({
      file_name: parsed.data.fileName,
      step: parsed.data.step,
      labels: parsed.data.labels,
      pairs: parsed.data.pairs,
      last_imported_at: parsed.data.lastImportedAt
        ? new Date(parsed.data.lastImportedAt).toISOString()
        : null,
    })
    .eq("resort_id", parsed.data.resortId)
    .select("resort_id");

  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return {
      ok: false,
      error:
        "There's no saved plan on the server to update. Upload the PDF again on this page — that's what creates it.",
    };
  }

  return { ok: true };
}

// Used on page load, to describe an unfinished draft without shipping
// the plan image to the browser before anyone asks for it.
export async function loadMasterplanDraftSummary(
  resortId: string
): Promise<RemoteDraftSummary | null> {
  if (!z.string().uuid().safeParse(resortId).success) return null;
  const supabase = await createClient();
  return fetchRemoteDraftSummary(supabase, resortId);
}

export async function loadMasterplanDraft(resortId: string): Promise<RemoteDraft | null> {
  if (!z.string().uuid().safeParse(resortId).success) return null;
  const supabase = await createClient();
  return fetchRemoteDraft(supabase, resortId);
}

export async function clearMasterplanDraft(resortId: string): Promise<void> {
  if (!z.string().uuid().safeParse(resortId).success) return;
  const supabase = await createClient();
  await supabase.from("masterplan_drafts").delete().eq("resort_id", resortId);
}
