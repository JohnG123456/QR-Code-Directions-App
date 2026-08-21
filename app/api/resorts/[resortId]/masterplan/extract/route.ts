import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractMasterplan } from "@/lib/masterplan/extract-labels-server";

// @napi-rs/canvas needs a real Node process, not the Edge runtime.
export const runtime = "nodejs";
// Rendering a large architectural sheet can take a few seconds.
export const maxDuration = 60;

export async function POST(request: Request) {
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
    return NextResponse.json(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't process that PDF.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
