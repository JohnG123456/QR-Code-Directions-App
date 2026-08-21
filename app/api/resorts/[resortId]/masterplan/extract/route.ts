import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractMasterplan } from "@/lib/masterplan/extract-labels-server";

// @napi-rs/canvas needs a real Node process, not the Edge runtime.
export const runtime = "nodejs";
// Rendering a large architectural sheet can take a few seconds.
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ resortId: string }> }
) {
  const { resortId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF file was uploaded." }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "That file isn't a PDF." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const plan = await extractMasterplan(buffer);

    // Start the durable draft here, while the render is in hand. The
    // image is a couple of MB of base64 - far too big to push back up
    // through a Server Action later (1MB request cap), and pointless to
    // round-trip when the server just produced it.
    //
    // Uploading a PDF is an explicit "start this plan" action, so this
    // replaces any previous draft for the resort outright: a different
    // sheet would leave the old site-number positions meaningless. The
    // tool warns before letting an existing draft be replaced.
    const { error: draftError } = await supabase.from("masterplan_drafts").upsert(
      {
        resort_id: resortId,
        file_name: file.name,
        step: "review",
        image_data_url: plan.imageDataUrl,
        image_width: plan.imageWidth,
        image_height: plan.imageHeight,
        labels: plan.labels,
        pairs: [],
        last_imported_at: null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "resort_id" }
    );

    // A failed draft write must not fail the upload - the tool still
    // works from its local copy - but say so, so nobody assumes hours of
    // review are being saved to the account when they aren't.
    return NextResponse.json({
      ...plan,
      draftSaved: !draftError,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't process that PDF.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
