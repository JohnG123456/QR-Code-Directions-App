import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Pushes a draft that only exists in this browser up to the account,
// exactly as it stands.
//
// Until now the only way to get a plan onto the server was to upload the
// PDF again - which re-scans the sheet and throws away the reviewed site
// numbers and the calibration with it. For a draft representing hours of
// review that's a rotten trade, and it's the wrong answer to "my work is
// only on this device".
//
// A Route Handler rather than a Server Action because of the image: a
// couple of MB of base64 is far past the 1MB cap on a Server Action
// request body.

export const runtime = "nodejs";
export const maxDuration = 60;

// Comfortably above a rendered plan sheet, comfortably below Vercel's
// request body limit.
const MAX_IMAGE_CHARS = 8_000_000;

const bodySchema = z.object({
  fileName: z.string().nullable(),
  step: z.string().min(1),
  imageDataUrl: z.string().startsWith("data:image/").max(MAX_IMAGE_CHARS),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  labels: z.array(
    z.object({ id: z.string(), text: z.string(), x: z.number(), y: z.number() })
  ),
  pairs: z.array(
    z.object({
      plan: z.object({ x: z.number(), y: z.number() }),
      world: z.object({ x: z.number(), y: z.number() }),
    })
  ),
  lastImportedAt: z.number().nullable().optional(),
});

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Couldn't read that draft." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${issue?.path.join(".") || "draft"}: ${issue?.message}` },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("masterplan_drafts").upsert(
    {
      resort_id: resortId,
      file_name: parsed.data.fileName,
      step: parsed.data.step,
      image_data_url: parsed.data.imageDataUrl,
      image_width: parsed.data.imageWidth,
      image_height: parsed.data.imageHeight,
      labels: parsed.data.labels,
      pairs: parsed.data.pairs,
      last_imported_at: parsed.data.lastImportedAt
        ? new Date(parsed.data.lastImportedAt).toISOString()
        : null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "resort_id" }
  );

  // The real message, not a guess: this is the request run when someone
  // has been told their work isn't reaching the account, so it needs to
  // say what stopped it.
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}
