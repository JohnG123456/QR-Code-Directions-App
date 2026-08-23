import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { describePlanOverlay } from "@/lib/masterplan/remote-draft";
import { NetworkEditorClient } from "./network-editor-client";
import { ConnectSitesPanel } from "@/components/admin/network/connect-sites-panel";
import {
  addGraphNode,
  addGraphEdge,
  moveGraphNode,
  deleteGraphNode,
  deleteGraphEdge,
  setEntranceNode,
  clearEntranceNode,
  connectSitesToNetwork,
} from "./actions";

interface EdgeRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  path_type: string;
  length_m: number | null;
  geojson: { type: string; coordinates: [number, number][] } | null;
}

export default async function NetworkPage({
  params,
}: {
  params: Promise<{ resortId: string }>;
}) {
  const { resortId } = await params;
  const supabase = await createClient();

  const { data: resort } = await supabase
    .from("resorts")
    .select("id, name, default_zoom, center_lat, center_lng, entrance_node_id")
    .eq("id", resortId)
    .single();

  if (!resort) notFound();

  const [{ data: nodes }, { data: edges }, { data: sites }, planOverlay] = await Promise.all([
    supabase
      .from("graph_nodes")
      .select("id, lat, lng, node_type")
      .eq("resort_id", resortId),
    supabase
      .from("graph_edges_view")
      .select("id, from_node_id, to_node_id, path_type, length_m, geojson")
      .eq("resort_id", resortId),
    supabase
      .from("sites")
      .select("id, site_number, lat, lng, status, graph_node_id")
      .eq("resort_id", resortId)
      .order("site_number"),
    // The calibration from the master plan import is what lets the plan
    // be shown in its real-world position. Only the reference points are
    // needed here - the image itself is fetched on demand, since it's a
    // couple of MB and most visits don't need it.
    describePlanOverlay(supabase, resortId),
  ]);

  if (resort.center_lat === null || resort.center_lng === null) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href={`/admin/resorts/${resortId}`}
          className="text-sm text-neutral-500 hover:underline"
        >
          ← {resort.name}
        </Link>
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This resort needs a reference point before the road network can be
          drawn. Set one under the resort&apos;s Settings.
        </p>
      </div>
    );
  }

  const edgeRows = (edges ?? []) as EdgeRow[];

  // The connectors that "Connect sites to the roads" generates - a node
  // at each house and a short spur to it - are kept out of the editor's
  // hands. At a couple of hundred homes they'd bury the streets being
  // traced, and they're derived data: the way to change one is to move
  // the site and reconnect, not to drag its spur about.
  const siteNodeIds = new Set(
    (nodes ?? []).filter((n) => n.node_type === "site").map((n) => n.id)
  );
  const isConnector = (edge: EdgeRow) =>
    siteNodeIds.has(edge.from_node_id) || siteNodeIds.has(edge.to_node_id);

  const toShape = (edge: EdgeRow) =>
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
    (edge.geojson?.coordinates ?? []).map(([lng, lat]) => [lat, lng] as [number, number]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={`/admin/resorts/${resortId}`}
          className="text-sm text-neutral-500 hover:underline"
        >
          ← {resort.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Road network</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Trace the resort&apos;s internal streets so visitors get directions
          along the roads instead of a straight line.
        </p>
      </div>

      <NetworkEditorClient
        resortId={resort.id}
        centerLat={resort.center_lat}
        centerLng={resort.center_lng}
        defaultZoom={resort.default_zoom}
        entranceNodeId={resort.entrance_node_id}
        initialNodes={(nodes ?? []).filter(
          (n): n is typeof n & { lat: number; lng: number } =>
            n.lat !== null && n.lng !== null && n.node_type !== "site"
        )}
        initialEdges={edgeRows.flatMap((edge) =>
          edge.geojson && !isConnector(edge)
            ? [
                {
                  id: edge.id,
                  fromNodeId: edge.from_node_id,
                  toNodeId: edge.to_node_id,
                  pathType: edge.path_type,
                  lengthM: edge.length_m,
                  shape: toShape(edge),
                },
              ]
            : []
        )}
        connectors={edgeRows.flatMap((edge) =>
          edge.geojson && isConnector(edge) ? [toShape(edge)] : []
        )}
        sites={(sites ?? []).filter(
          (s): s is typeof s & { lat: number; lng: number } =>
            s.lat !== null && s.lng !== null
        )}
        planCalibration={
          planOverlay.kind === "ready"
            ? {
                pairs: planOverlay.summary.pairs,
                imageWidth: planOverlay.summary.imageWidth,
                imageHeight: planOverlay.summary.imageHeight,
                fileName: planOverlay.summary.fileName,
              }
            : null
        }
        planUnavailable={planOverlay.kind === "ready" ? null : planOverlay.kind}
        addGraphNode={addGraphNode}
        addGraphEdge={addGraphEdge}
        moveGraphNode={moveGraphNode}
        deleteGraphNode={deleteGraphNode}
        deleteGraphEdge={deleteGraphEdge}
        setEntranceNode={setEntranceNode}
        clearEntranceNode={clearEntranceNode}
      />

      <ConnectSitesPanel
        resortId={resort.id}
        totalSites={(sites ?? []).length}
        connectedSites={(sites ?? []).filter((s) => s.graph_node_id !== null).length}
        hasRoads={edgeRows.length > 0}
        connectSitesToNetwork={connectSitesToNetwork}
      />
    </div>
  );
}
