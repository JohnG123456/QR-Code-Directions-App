import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  backupFileName,
  resortsToCsv,
  sitesToCsv,
  type Backup,
  type BackupBoundary,
  type BackupGraphEdge,
  type BackupGraphNode,
  type BackupPlanOverlay,
  type BackupResort,
  type BackupSite,
} from "@/lib/backup/export";

// Downloads the whole database as a file. Staff-only: this is every
// site's exact position for every resort.
//
// ?format=sites-csv    one row per site, opens in Excel/Sheets (default)
// ?format=resorts-csv  one row per resort
// ?format=json         everything, in the shape the restore tool reads

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // RLS would already block the reads below for a non-staff account, but
  // an explicit check gives an honest error instead of an empty backup -
  // an empty file that looks like a successful backup is the worst
  // possible outcome here.
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!staff) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  const [
    { data: resorts, error: resortsError },
    { data: sites, error: sitesError },
    { data: nodes, error: nodesError },
    { data: edges, error: edgesError },
    { data: overlays, error: overlaysError },
  ] = await Promise.all([
    supabase
      .from("resorts")
      .select(
        "id, name, slug, is_published, default_zoom, total_homes, center_lat, center_lng, entrance_node_id, map_bearing_deg, created_at"
      )
      .order("name"),
    supabase
      .from("sites")
      .select(
        "id, resort_id, site_number, label, status, lat, lng, gps_accuracy_m, graph_node_id, created_at, updated_at"
      )
      .order("resort_id")
      .order("site_number"),
    supabase
      .from("graph_nodes")
      .select("id, resort_id, lat, lng, node_type")
      .order("resort_id"),
    supabase
      .from("graph_edges_view")
      .select("id, resort_id, from_node_id, to_node_id, path_type, is_bidirectional, geojson")
      .order("resort_id"),
    supabase
      .from("resort_plan_overlays")
      .select(
        "resort_id, image_data_url, content_type, image_width, image_height, top_left_lat, top_left_lng, top_right_lat, top_right_lng, bottom_left_lat, bottom_left_lng, source_file_name, published_at"
      ),
  ]);

  // Never hand back a partial backup as if it were complete. That
  // applies to the newer tables as much as the original two: a file that
  // quietly lacks the road network looks exactly like one that has it.
  const readError =
    resortsError ?? sitesError ?? nodesError ?? edgesError ?? overlaysError;
  if (readError) {
    return NextResponse.json(
      { error: readError.message ?? "Couldn't read the data." },
      { status: 500 }
    );
  }

  // Boundaries come one resort at a time: the function tells drawn from
  // computed, and only a drawn one is worth keeping - the fallback
  // re-derives itself from wherever the homes end up.
  const boundaries: BackupBoundary[] = [];
  for (const resort of (resorts ?? []) as BackupResort[]) {
    const { data, error } = await supabase
      .rpc("resort_boundary_geojson", { p_resort_id: resort.id })
      .single();
    if (error) continue;
    const result = data as { boundary: unknown; is_drawn: boolean } | null;
    if (result?.is_drawn && result.boundary) {
      boundaries.push({ resort_id: resort.id, geojson: result.boundary });
    }
  }

  const backup: Backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    resorts: (resorts ?? []) as BackupResort[],
    sites: (sites ?? []) as BackupSite[],
    graphNodes: (nodes ?? []) as BackupGraphNode[],
    graphEdges: (edges ?? []) as BackupGraphEdge[],
    boundaries,
    planOverlays: (overlays ?? []) as BackupPlanOverlay[],
  };

  const format = new URL(request.url).searchParams.get("format") ?? "sites-csv";

  if (format === "json") {
    return fileResponse(
      JSON.stringify(backup, null, 2),
      "application/json",
      backupFileName("json")
    );
  }
  if (format === "resorts-csv") {
    return fileResponse(
      resortsToCsv(backup),
      "text/csv; charset=utf-8",
      backupFileName("resorts.csv")
    );
  }
  return fileResponse(
    sitesToCsv(backup),
    "text/csv; charset=utf-8",
    backupFileName("sites.csv")
  );
}

function fileResponse(body: string, contentType: string, fileName: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      // A backup must always be freshly read, never a cached copy from an
      // earlier download.
      "Cache-Control": "no-store",
    },
  });
}
