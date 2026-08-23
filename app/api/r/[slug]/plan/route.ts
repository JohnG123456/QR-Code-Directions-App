import { createClient } from "@/lib/supabase/server";
import { fetchPublicPlanImage, decodeDataUrl } from "@/lib/masterplan/published-overlay";

// The master plan image, as a real image request rather than bytes
// inlined in the page.
//
// That split is the whole point of this route. A guest looks up two or
// three site numbers while they're standing there, and the page
// re-renders each time; inlined, the plan would come down the wire again
// on every one of those. As its own request it is fetched once and served
// from the browser cache after that.
//
// Keyed by ?v=<published_at>, so a republished plan is a different URL
// and the cached copy is bypassed without anyone clearing anything.

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: resort } = await supabase
    .from("public_resorts")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (!resort) return new Response("Not found", { status: 404 });

  const image = await fetchPublicPlanImage(supabase, resort.id);
  if (!image) return new Response("Not found", { status: 404 });

  const bytes = decodeDataUrl(image.dataUrl);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(bytes.byteLength),
      // A year is safe because the URL carries the publish time: the only
      // way the bytes at this address change is if the plan is
      // republished, and that produces a different address.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
