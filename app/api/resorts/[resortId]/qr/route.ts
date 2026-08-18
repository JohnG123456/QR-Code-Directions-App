import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateQrPngBuffer, generateQrSvgString, resortUrl } from "@/lib/qr/generate";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ resortId: string }> }
) {
  const { resortId } = await params;
  const format = new URL(request.url).searchParams.get("format") === "svg" ? "svg" : "png";

  const supabase = await createClient();
  const { data: resort, error } = await supabase
    .from("resorts")
    .select("slug")
    .eq("id", resortId)
    .single();

  if (error || !resort) {
    return NextResponse.json({ error: "Resort not found" }, { status: 404 });
  }

  const url = resortUrl(resort.slug);

  if (format === "svg") {
    const svg = await generateQrSvgString(url);
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="${resort.slug}-qr.svg"`,
      },
    });
  }

  const png = await generateQrPngBuffer(url);
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${resort.slug}-qr.png"`,
    },
  });
}
