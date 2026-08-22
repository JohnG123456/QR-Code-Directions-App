// The durable half of master plan draft storage: one in-progress draft
// per resort, in Postgres, readable from any signed-in staff device.
//
// lib/masterplan/draft-store.ts keeps the same draft in the browser's
// IndexedDB. Both are written, and whichever is newer wins on load. The
// local copy is instant and survives a flaky connection; the remote copy
// survives a different device, a cleared browser, or private browsing -
// which is what actually bit us.
//
// The plan image is written once, by the extract API route (which has
// the render in hand already). Everything else - the reviewed site
// numbers and calibration points - is small, and is what autosave sends.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface RemoteDraft {
  resortId: string;
  fileName: string | null;
  savedAt: number;
  lastImportedAt?: number;
  step: string;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  labels: { id: string; text: string; x: number; y: number }[];
  pairs: { plan: { x: number; y: number }; world: { x: number; y: number } }[];
}

interface DraftRow {
  resort_id: string;
  file_name: string | null;
  step: string;
  image_data_url: string | null;
  image_width: number | null;
  image_height: number | null;
  labels: RemoteDraft["labels"] | null;
  pairs: RemoteDraft["pairs"] | null;
  last_imported_at: string | null;
  updated_at: string;
}

export function rowToDraft(row: DraftRow): RemoteDraft | null {
  // A row without its image can't be resumed - there'd be nothing to
  // show the site numbers against - so treat it as no draft at all.
  if (!row.image_data_url || !row.image_width || !row.image_height) return null;

  return {
    resortId: row.resort_id,
    fileName: row.file_name,
    savedAt: new Date(row.updated_at).getTime(),
    lastImportedAt: row.last_imported_at
      ? new Date(row.last_imported_at).getTime()
      : undefined,
    step: row.step,
    imageDataUrl: row.image_data_url,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    labels: row.labels ?? [],
    pairs: row.pairs ?? [],
  };
}

/** Everything about a draft except the image, which is by far the
 *  biggest part of it. Enough to describe the draft in the "pick up where
 *  I left off" banner without making a phone download a couple of MB of
 *  base64 just to open the page. */
export type RemoteDraftSummary = Omit<RemoteDraft, "imageDataUrl">;

export async function fetchRemoteDraftSummary(
  supabase: SupabaseClient,
  resortId: string
): Promise<RemoteDraftSummary | null> {
  const { data, error } = await supabase
    .from("masterplan_drafts")
    .select(
      "resort_id, file_name, step, image_width, image_height, labels, pairs, last_imported_at, updated_at"
    )
    .eq("resort_id", resortId)
    .maybeSingle();

  if (error || !data) return null;
  // image_data_url isn't selected, so stand in a placeholder for the "is
  // this draft resumable" check, then hand back everything but the image.
  const draft = rowToDraft({ ...(data as Omit<DraftRow, "image_data_url">), image_data_url: "-" });
  if (!draft) return null;

  return {
    resortId: draft.resortId,
    fileName: draft.fileName,
    savedAt: draft.savedAt,
    lastImportedAt: draft.lastImportedAt,
    step: draft.step,
    imageWidth: draft.imageWidth,
    imageHeight: draft.imageHeight,
    labels: draft.labels,
    pairs: draft.pairs,
  };
}

export async function fetchRemoteDraft(
  supabase: SupabaseClient,
  resortId: string
): Promise<RemoteDraft | null> {
  const { data, error } = await supabase
    .from("masterplan_drafts")
    .select(
      "resort_id, file_name, step, image_data_url, image_width, image_height, labels, pairs, last_imported_at, updated_at"
    )
    .eq("resort_id", resortId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToDraft(data as DraftRow);
}

// Why the master plan can't be shown as an overlay, when it can't.
//
// The tools used to just hide the toggle if anything was missing, which
// left no way to tell "you haven't uploaded a plan" from "the migration
// hasn't been run" from "this plan was never calibrated" - the control
// simply wasn't there, with nothing to explain it.
export type PlanOverlayAvailability =
  | { kind: "ready"; summary: RemoteDraftSummary }
  /** The masterplan_drafts table doesn't exist yet. */
  | { kind: "not-migrated" }
  /** No plan has been uploaded for this resort since drafts moved to the
   *  account - including a plan imported before that, which only ever
   *  existed in one browser. */
  | { kind: "no-plan" }
  /** A plan is saved, but without the two reference points that place it
   *  on the map. */
  | { kind: "not-calibrated" };

const MISSING_TABLE_CODES = new Set([
  "42P01", // Postgres: undefined_table
  "PGRST205", // PostgREST: table not found in the schema cache
]);

export async function describePlanOverlay(
  supabase: SupabaseClient,
  resortId: string
): Promise<PlanOverlayAvailability> {
  const { data, error } = await supabase
    .from("masterplan_drafts")
    .select(
      "resort_id, file_name, step, image_width, image_height, labels, pairs, last_imported_at, updated_at"
    )
    .eq("resort_id", resortId)
    .maybeSingle();

  if (error) {
    return MISSING_TABLE_CODES.has(error.code) ? { kind: "not-migrated" } : { kind: "no-plan" };
  }
  if (!data) return { kind: "no-plan" };

  const draft = rowToDraft({ ...(data as Omit<DraftRow, "image_data_url">), image_data_url: "-" });
  if (!draft) return { kind: "no-plan" };
  if (draft.pairs.length < 2) return { kind: "not-calibrated" };

  return {
    kind: "ready",
    summary: {
      resortId: draft.resortId,
      fileName: draft.fileName,
      savedAt: draft.savedAt,
      lastImportedAt: draft.lastImportedAt,
      step: draft.step,
      imageWidth: draft.imageWidth,
      imageHeight: draft.imageHeight,
      labels: draft.labels,
      pairs: draft.pairs,
    },
  };
}
