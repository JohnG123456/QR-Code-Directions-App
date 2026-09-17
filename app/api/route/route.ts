import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The route a visitor gets after picking their site number.
//
// Without `lat`/`lng` the walk starts at the resort entrance, which is
// where a guest who has just scanned a sign at the gate is standing.
// With them it starts wherever the visitor currently is, which is what
// live directions ask for once they are moving.
//
// The road network itself is never sent to the browser - this returns
// one computed line and nothing else. Both route_to_site() and
// route_from_point() are SECURITY DEFINER and do the checking (published
// resort, active site, and for the live one a position that is actually
// at this resort), so anon keeps no access at all to the graph tables.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A coordinate the caller supplied, or null if it wasn't a coordinate. */
function readCoordinate(raw: string | null, limit: number): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return value;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const siteId = params.get("site");
  if (!siteId) {
    return NextResponse.json({ error: "No site given." }, { status: 400 });
  }

  const lat = readCoordinate(params.get("lat"), 90);
  const lng = readCoordinate(params.get("lng"), 180);
  // Both or neither. One on its own is a caller bug, and guessing which
  // half was meant would put a route somewhere nobody asked for.
  const fromLive = lat !== null && lng !== null;
  if (fromLive === false && (params.has("lat") || params.has("lng"))) {
    return NextResponse.json(
      { error: "lat and lng must both be given, as numbers." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = fromLive
    ? await supabase.rpc("route_from_point", {
        p_site_id: siteId,
        p_lat: lat,
        p_lng: lng,
      })
    : await supabase.rpc("route_to_site", { p_site_id: siteId });

  if (error) {
    // A resort whose database hasn't had 0015 applied yet still has to
    // be able to give directions from the entrance, so a missing live
    // function is reported as "no live route" rather than as a failure.
    // Postgres raises undefined_function as 42883.
    if (fromLive && error.code === "42883") {
      return NextResponse.json({ route: null, liveUnavailable: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // No route: the site isn't connected to the network, the network
  // doesn't reach it, or - live only - the visitor is too far from any
  // road here to be placed on one. The page falls back to the route from
  // the entrance, and past that to distance and bearing, which is still
  // useful, rather than showing nothing.
  if (!data) {
    return NextResponse.json({ route: null });
  }

  const route = data as {
    distance_m: number;
    geometry: { type: string; coordinates: [number, number][] };
    snapped_lat?: number;
    snapped_lng?: number;
    snap_distance_m?: number;
  };

  return NextResponse.json(
    {
      route: {
        distanceM: route.distance_m,
        // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
        points: route.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as [number, number]
        ),
        snappedTo:
          route.snapped_lat !== undefined && route.snapped_lng !== undefined
            ? { lat: route.snapped_lat, lng: route.snapped_lng }
            : null,
        snapDistanceM: route.snap_distance_m ?? null,
      },
    },
    {
      // A live route is only true for as long as the car stays put, so
      // it must never be served to the next request from a cache.
      headers: {
        "Cache-Control": fromLive
          ? "no-store"
          : "public, max-age=300",
      },
    }
  );
}
