"use client";

import { useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { BasemapTileLayer } from "@/components/map/basemap-tile-layer";
import { PlanImageOverlay } from "@/components/map/plan-image-overlay";
import { siteDivIcon } from "@/lib/map/site-icon";
import { georeferencePlan } from "@/lib/geo/plan-georeference";
import { distanceMeters, formatDistance } from "@/lib/geo/distance";
import { loadMasterplanDraft } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/import-masterplan/actions";
import type { PointPair } from "@/lib/geo/similarity-transform";
import type { SiteStatus } from "@/lib/types";
import type { NetworkActionState } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/network/actions";
import { countConnectedToEntrance } from "@/lib/network/connectivity";
import "leaflet/dist/leaflet.css";

// Snapping radius in screen pixels. Generous on purpose: joining a new
// road to an existing junction is the single most common action, and a
// junction that looks joined but isn't is the failure mode that quietly
// breaks routing later.
const SNAP_PIXELS = 16;

interface GraphNode {
  id: string;
  lat: number;
  lng: number;
  node_type: string;
}

interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  pathType: string;
  lengthM: number | null;
  shape: [number, number][];
}

interface SiteMarker {
  id: string;
  site_number: string;
  lat: number;
  lng: number;
  status: SiteStatus;
}

type Mode = "draw" | "edit";

function nodeIcon(isEntrance: boolean, isSelected: boolean, isChainHead: boolean) {
  const size = isEntrance || isSelected || isChainHead ? 16 : 11;
  const color = isEntrance ? "#7c3aed" : isChainHead ? "#2563eb" : "#111827";
  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;width:${size}px;height:${size}px;border-radius:9999px;
      background:${color};border:2px solid white;
      box-shadow:0 1px 3px rgba(0,0,0,0.5);
    "></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function NetworkEditor({
  resortId,
  centerLat,
  centerLng,
  defaultZoom,
  entranceNodeId,
  initialNodes,
  initialEdges,
  sites,
  planCalibration,
  addGraphNode,
  addGraphEdge,
  moveGraphNode,
  deleteGraphNode,
  deleteGraphEdge,
  setEntranceNode,
}: {
  resortId: string;
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  entranceNodeId: string | null;
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
  sites: SiteMarker[];
  planCalibration: {
    pairs: PointPair[];
    imageWidth: number;
    imageHeight: number;
    fileName: string | null;
  } | null;
  addGraphNode: (input: {
    resortId: string;
    lat: number;
    lng: number;
  }) => Promise<NetworkActionState>;
  addGraphEdge: (input: {
    resortId: string;
    fromNodeId: string;
    toNodeId: string;
    shape: { lat: number; lng: number }[];
  }) => Promise<NetworkActionState>;
  moveGraphNode: (input: {
    resortId: string;
    nodeId: string;
    lat: number;
    lng: number;
  }) => Promise<NetworkActionState>;
  deleteGraphNode: (input: {
    resortId: string;
    nodeId: string;
  }) => Promise<NetworkActionState>;
  deleteGraphEdge: (input: {
    resortId: string;
    edgeId: string;
  }) => Promise<NetworkActionState>;
  setEntranceNode: (input: {
    resortId: string;
    nodeId: string;
  }) => Promise<NetworkActionState>;
}) {
  const [nodes, setNodes] = useState<GraphNode[]>(initialNodes);
  const [edges, setEdges] = useState<GraphEdge[]>(initialEdges);
  const [entranceId, setEntranceId] = useState<string | null>(entranceNodeId);
  const [mode, setMode] = useState<Mode>("draw");
  const [chainNodeId, setChainNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPlan, setShowPlan] = useState(false);
  const [planOpacity, setPlanOpacity] = useState(0.65);
  const [planImage, setPlanImage] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const reference = { lat: centerLat, lng: centerLng };

  const georeference = useMemo(
    () =>
      planCalibration
        ? georeferencePlan(
            planCalibration.pairs,
            planCalibration.imageWidth,
            planCalibration.imageHeight,
            reference
          )
        : null,
    // reference is derived from two numbers that don't change while the
    // page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planCalibration, centerLat, centerLng]
  );

  // Fetch the plan image only when it's actually switched on - it's a
  // couple of MB, and the parts of the resort that are already built can
  // be traced on satellite without it.
  function togglePlan(wanted: boolean) {
    setShowPlan(wanted);
    if (!wanted || planImage || planLoading || !georeference) return;
    setPlanLoading(true);
    setError(null);
    loadMasterplanDraft(resortId)
      .then((draft) => {
        if (draft?.imageDataUrl) setPlanImage(draft.imageDataUrl);
        else setError("There's no saved master plan image for this resort yet.");
      })
      .catch(() => setError("Couldn't load the master plan image."))
      .finally(() => setPlanLoading(false));
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const edgesAtSelectedNode = selectedNode
    ? edges.filter((e) => e.fromNodeId === selectedNode.id || e.toNodeId === selectedNode.id)
    : [];

  const totalLength = edges.reduce((sum, edge) => sum + (edge.lengthM ?? 0), 0);
  const connectivity = useMemo(
    () => countConnectedToEntrance(nodes.map((n) => n.id), edges, entranceId),
    [nodes, edges, entranceId]
  );

  async function run<T extends NetworkActionState>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result.error) {
        setError(result.error);
        return null;
      }
      return result;
    } catch {
      setError("That didn't save — check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Extends the road being drawn: snap to an existing junction if one is
  // close, otherwise drop a new one, then join it to the previous point.
  async function extendChain(lat: number, lng: number, snappedNodeId: string | null) {
    let nodeId = snappedNodeId;

    if (!nodeId) {
      const created = await run(() => addGraphNode({ resortId, lat, lng }));
      if (!created?.nodeId) return;
      nodeId = created.nodeId;
      setNodes((prev) => [...prev, { id: nodeId!, lat, lng, node_type: "intersection" }]);
    }

    const from = chainNodeId;
    if (from && from !== nodeId) {
      const fromNode = nodes.find((n) => n.id === from);
      const created = await run(() =>
        addGraphEdge({ resortId, fromNodeId: from, toNodeId: nodeId!, shape: [] })
      );
      if (created?.edgeId && fromNode) {
        const lengthM = distanceMeters(fromNode, { lat, lng });
        setEdges((prev) => [
          ...prev,
          {
            id: created.edgeId!,
            fromNodeId: from,
            toNodeId: nodeId!,
            pathType: "road",
            lengthM,
            shape: [
              [fromNode.lat, fromNode.lng],
              [lat, lng],
            ],
          },
        ]);
      }
    }

    setChainNodeId(nodeId);
  }

  async function handleDeleteNode(nodeId: string) {
    const attached = edges.filter((e) => e.fromNodeId === nodeId || e.toNodeId === nodeId);
    if (
      attached.length > 0 &&
      !window.confirm(
        `Deleting this junction also deletes the ${attached.length} road${
          attached.length === 1 ? "" : "s"
        } joined to it. Continue?`
      )
    ) {
      return;
    }
    const ok = await run(() => deleteGraphNode({ resortId, nodeId }));
    if (!ok) return;
    setEdges((prev) => prev.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId));
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    if (chainNodeId === nodeId) setChainNodeId(null);
    if (entranceId === nodeId) setEntranceId(null);
    setSelectedNodeId(null);
  }

  async function handleNodeMoved(nodeId: string, lat: number, lng: number) {
    const ok = await run(() => moveGraphNode({ resortId, nodeId, lat, lng }));
    if (!ok) return;
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, lat, lng } : n)));
    // Keep the drawn roads attached to the junction that just moved -
    // the database does the same thing to their stored geometry.
    setEdges((prev) =>
      prev.map((edge) => {
        if (edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId) return edge;
        const shape = [...edge.shape];
        if (edge.fromNodeId === nodeId) shape[0] = [lat, lng];
        if (edge.toNodeId === nodeId) shape[shape.length - 1] = [lat, lng];
        return { ...edge, shape };
      })
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-neutral-300">
          <button
            type="button"
            onClick={() => {
              setMode("draw");
              setSelectedEdgeId(null);
              setSelectedNodeId(null);
            }}
            className={`px-3 py-2 text-sm ${
              mode === "draw" ? "bg-neutral-900 text-white" : "bg-white"
            }`}
          >
            Draw roads
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("edit");
              setChainNodeId(null);
            }}
            className={`px-3 py-2 text-sm ${
              mode === "edit" ? "bg-neutral-900 text-white" : "bg-white"
            }`}
          >
            Select &amp; fix
          </button>
        </div>

        {mode === "draw" && chainNodeId && (
          <button
            type="button"
            onClick={() => setChainNodeId(null)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            Finish this road
          </button>
        )}

        {georeference && (
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={showPlan}
              onChange={(e) => togglePlan(e.target.checked)}
            />
            Master plan
          </label>
        )}

        {showPlan && planImage && (
          <label className="flex items-center gap-2 text-xs text-neutral-500">
            Fade
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={planOpacity}
              onChange={(e) => setPlanOpacity(Number(e.target.value))}
            />
          </label>
        )}

        {busy && <span className="text-xs text-neutral-500">Saving…</span>}
      </div>

      <p className="text-sm text-neutral-600">
        {mode === "draw"
          ? chainNodeId
            ? "Keep tapping along the street — each tap continues the road. Tap an existing junction to join onto it, then Finish."
            : "Tap where a street starts, then tap along it. Snap onto an existing junction to connect roads together."
          : "Tap a junction or a road to move or delete it. Drag a junction to reposition it — the roads follow."}
      </p>

      {planLoading && (
        <p className="text-xs text-neutral-500">Loading the master plan image…</p>
      )}
      {!georeference && (
        <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          The master plan can&apos;t be shown as a backdrop yet — it needs at
          least two calibration points from the master plan import. Satellite
          imagery still works for streets that have been built.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="h-[70vh] w-full overflow-hidden rounded-md border border-neutral-200">
        <MapContainer
          center={[centerLat, centerLng]}
          zoom={defaultZoom}
          className="h-full w-full"
        >
          <BasemapTileLayer />

          {showPlan && planImage && georeference && planCalibration && (
            <PlanImageOverlay
              imageUrl={planImage}
              imageWidth={planCalibration.imageWidth}
              imageHeight={planCalibration.imageHeight}
              topLeft={georeference.topLeft}
              topRight={georeference.topRight}
              bottomLeft={georeference.bottomLeft}
              opacity={planOpacity}
            />
          )}

          <MapClickHandler
            enabled={mode === "draw" && !busy}
            nodes={nodes}
            onPlace={extendChain}
          />

          {sites.map((site) => (
            <Marker
              key={site.id}
              position={[site.lat, site.lng]}
              icon={siteDivIcon(site.status)}
              opacity={0.5}
              interactive={false}
            />
          ))}

          {edges.map((edge) => (
            <Polyline
              key={edge.id}
              positions={edge.shape}
              pathOptions={{
                color: edge.id === selectedEdgeId ? "#dc2626" : "#2563eb",
                weight: edge.id === selectedEdgeId ? 7 : 5,
                opacity: 0.9,
              }}
              eventHandlers={{
                click: () => {
                  if (mode !== "edit") return;
                  setSelectedEdgeId(edge.id);
                  setSelectedNodeId(null);
                },
              }}
            />
          ))}

          {nodes.map((node) => (
            <Marker
              key={node.id}
              position={[node.lat, node.lng]}
              icon={nodeIcon(
                node.id === entranceId,
                node.id === selectedNodeId,
                node.id === chainNodeId
              )}
              draggable={mode === "edit"}
              eventHandlers={{
                click: () => {
                  if (mode === "edit") {
                    setSelectedNodeId(node.id);
                    setSelectedEdgeId(null);
                  }
                },
                dragend: (event) => {
                  const { lat, lng } = (event.target as L.Marker).getLatLng();
                  void handleNodeMoved(node.id, lat, lng);
                },
              }}
            />
          ))}
        </MapContainer>
      </div>

      {mode === "edit" && selectedNode && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 p-3">
          <span className="text-sm">
            Junction with {edgesAtSelectedNode.length} road
            {edgesAtSelectedNode.length === 1 ? "" : "s"}
            {selectedNode.id === entranceId ? " — this is the entrance" : ""}
          </span>
          {selectedNode.id !== entranceId && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await run(() =>
                  setEntranceNode({ resortId, nodeId: selectedNode.id })
                );
                if (ok) setEntranceId(selectedNode.id);
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              Set as entrance
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDeleteNode(selectedNode.id)}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700"
          >
            Delete junction
          </button>
        </div>
      )}

      {mode === "edit" && selectedEdge && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 p-3">
          <span className="text-sm">
            Road
            {selectedEdge.lengthM ? `, ${formatDistance(selectedEdge.lengthM)} long` : ""}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const ok = await run(() =>
                deleteGraphEdge({ resortId, edgeId: selectedEdge.id })
              );
              if (!ok) return;
              setEdges((prev) => prev.filter((e) => e.id !== selectedEdge.id));
              setSelectedEdgeId(null);
            }}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700"
          >
            Delete road
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1 rounded-md bg-neutral-50 p-3 text-sm text-neutral-600">
        <p>
          {nodes.length} junctions, {edges.length} roads,{" "}
          {formatDistance(totalLength)} of network.
        </p>
        {!entranceId && (
          <p className="text-amber-700">
            No entrance set yet — pick the junction at the front gate in
            &ldquo;Select &amp; fix&rdquo;. Every visitor route starts there.
          </p>
        )}
        {entranceId && connectivity.unreachable > 0 && (
          <p className="text-amber-700">
            {connectivity.unreachable} junction
            {connectivity.unreachable === 1 ? " isn't" : "s aren't"} connected
            to the entrance — routes to anything out there will fail. Usually a
            road that stops just short of joining another.
          </p>
        )}
        {entranceId && connectivity.unreachable === 0 && nodes.length > 0 && (
          <p className="text-green-700">
            Every junction is reachable from the entrance.
          </p>
        )}
      </div>
    </div>
  );
}

function MapClickHandler({
  enabled,
  nodes,
  onPlace,
}: {
  enabled: boolean;
  nodes: GraphNode[];
  onPlace: (lat: number, lng: number, snappedNodeId: string | null) => void;
}) {
  const map = useMapEvents({
    click: (event) => {
      if (!enabled) return;
      const { lat, lng } = event.latlng;

      // Snapping is judged in screen pixels, not metres, so it feels the
      // same whether you're zoomed out over the whole resort or in on one
      // corner of it.
      const clickPoint = map.latLngToContainerPoint(event.latlng);
      let snappedNodeId: string | null = null;
      let closest = SNAP_PIXELS;
      for (const node of nodes) {
        const nodePoint = map.latLngToContainerPoint([node.lat, node.lng]);
        const pixels = clickPoint.distanceTo(nodePoint);
        if (pixels <= closest) {
          closest = pixels;
          snappedNodeId = node.id;
        }
      }

      if (snappedNodeId) {
        const snapped = nodes.find((n) => n.id === snappedNodeId)!;
        onPlace(snapped.lat, snapped.lng, snappedNodeId);
      } else {
        onPlace(lat, lng, null);
      }
    },
  });
  return null;
}
