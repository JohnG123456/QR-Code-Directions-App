import { createClient } from "@/lib/supabase/server";
import { RouteMap } from "./route-map";

// Anything that goes wrong here used to end up as the same bare 404.
//
// A resort that doesn't exist, one that isn't published yet, a view the
// visitor's anonymous role can't read, a database that's asleep - all of
// them produced "This page could not be found", which is both unhelpful
// to a guest standing at a gate and impossible to diagnose from the
// outside. The two cases are now told apart and both say something true.

export default async function VisitorResortPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: resort, error } = await supabase
    .from("public_resorts")
    .select("id, name, slug, default_zoom, entrance_lat, entrance_lng, is_routable")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    // Goes to the server log, where staff can actually read it - the
    // guest gets the plain message below.
    console.error(`[visitor] couldn't read resort "${slug}":`, error.message, error.code);
    return (
      <VisitorMessage
        heading="Directions are temporarily unavailable"
        body="We couldn't load this resort's map just now. Please try again in a moment, or ask at reception."
        detail={`Reference: ${error.code ?? "read-failed"}`}
      />
    );
  }

  if (!resort) {
    return (
      <VisitorMessage
        heading="No directions for this address"
        body="This QR code points at a resort that isn't set up yet, or isn't published. If you scanned a sign here, please let reception know."
        detail={`Address: /r/${slug}`}
      />
    );
  }

  const { data: sites, error: sitesError } = await supabase
    .from("public_sites")
    .select("id, resort_id, site_number, label, lat, lng")
    .eq("resort_id", resort.id)
    .order("site_number");

  if (sitesError) {
    console.error(`[visitor] couldn't read sites for "${slug}":`, sitesError.message);
    return (
      <VisitorMessage
        heading="Directions are temporarily unavailable"
        body={`We found ${resort.name} but couldn't load its site list. Please try again in a moment, or ask at reception.`}
        detail={`Reference: ${sitesError.code ?? "read-failed"}`}
      />
    );
  }

  // A published resort with nothing to search is worth saying plainly,
  // rather than handing over a search box that can never match.
  if ((sites ?? []).length === 0) {
    return (
      <VisitorMessage
        heading={resort.name}
        body="No site numbers have been published for this resort yet. Please ask at reception for directions."
        detail={null}
      />
    );
  }

  return <RouteMap resort={resort} sites={sites ?? []} />;
}

function VisitorMessage({
  heading,
  body,
  detail,
}: {
  heading: string;
  body: string;
  detail: string | null;
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-neutral-900">{heading}</h1>
      <p className="text-sm text-neutral-600">{body}</p>
      {detail && <p className="text-xs text-neutral-400">{detail}</p>}
    </div>
  );
}
