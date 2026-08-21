import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The route a visitor gets after picking their site number.
//
// The road network itself is never sent to the browser - this returns
// one computed line and nothing else. route_to_site() is SECURITY
// DEFINER and does the checking (published resort, active site), so anon
// keeps no access at all to the graph tables.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const siteId = new URL(request.url).searchParams.get("site");
  if (!siteId) {
    return NextResponse.json({ error: "No site given." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("route_to_site", { p_site_id: siteId });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // No route: the site isn't connected to the network, or the network
  // doesn't reach it. The page falls back to distance and bearing, which
  // is still useful, rather than showing nothing.
  if (!data) {
    return NextResponse.json({ route: null });
  }

  const route = data as {
    distance_m: number;
    geometry: { type: string; coordinates: [number, number][] };
  };

  return NextResponse.json(
    {
      route: {
        distanceM: route.distance_m,
        // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
        points: route.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as [number, number]
        ),
      },
    },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
