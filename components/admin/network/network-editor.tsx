"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// One entry per thing you did, not per thing the database did.
//
// A single tap while drawing can write two rows - a new junction and the
// road joining it to the last one - and undo has to take back the tap,
// not half of it. Deleting a junction is the same in reverse: it takes
// its roads with it, so putting it back has to put them back too.
//
// There is no server-side history to roll back to, so each step carries
// whatever it needs to describe the opposite action. Recreated rows come
// back with new ids, which is why the steps store whole records rather
// than just ids: the *shape* of the network is restored exactly, even
// though the identifiers underneath it change.
type UndoStep =
  | {
      kind: "add-node";
      /** Undoing this deletes the junction, and any road created with it
       *  goes too - the database cascades, and so does the map. */
      nodeId: string;
      chainNodeIdBefore: string | null;
    }
  | { kind: "add-edge"; edgeId: string; chainNodeIdBefore: string | null }
  | { kind: "move-node"; nodeId: string; from: { lat: number; lng: number } }
  | {
      kind: "delete-node";
      node: GraphNode;
      /** The roads that went with it. Restored between the junction's
       *  replacement and whichever ends still exist. */
      attachedEdges: GraphEdge[];
      wasEntrance: boolean;
    }
  | { kind: "delete-edge"; edge: GraphEdge }
  | { kind: "set-entrance"; previousEntranceId: string | null };

// What the button says it will take back, so nobody has to remember.
function describeStep(step: UndoStep): string {
  switch (step.kind) {
    case "add-node":
      return "the junction you just added";
    case "add-edge":
      return "the road you just drew";
    case "move-node":
      return "moving that junction";
    case "delete-node":
      return step.attachedEdges.length > 0
        ? `deleting that junction and its ${step.attachedEdges.length} road${
            step.attachedEdges.length === 1 ? "" : "s"
          }`
        : "deleting that junction";
    case "delete-edge":
      return "deleting that road";
    case "set-entrance":
      return "setting the entrance";
  }
}

// Deep enough to cover a bad run of taps, shallow enough that the oldest
// entries can't be referring to a network that has moved on beneath them.
const UNDO_LIMIT = 50;

// Rewrites the ids held by the remaining undo steps.
//
// Undoing a delete can't resurrect a row - it inserts a new one, with a
// new id. Every older step still naming the old id would then be
// pointing at nothing: undoing further would appear to work while
// silently leaving stray junctions behind, which is the worst way for an
// undo button to fail. Rebinding the stack to the replacements keeps the
// whole history usable.
export function remapUndoStack(stack: UndoStep[], idMap: Map<string, string>): UndoStep[] {
  if (idMap.size === 0) return stack;
  const to = (id: string) => idMap.get(id) ?? id;
  const toMaybe = (id: string | null) => (id === null ? null : to(id));

  return stack.map((step) => {
    switch (step.kind) {
      case "add-node":
        return {
          ...step,
          nodeId: to(step.nodeId),
          chainNodeIdBefore: toMaybe(step.chainNodeIdBefore),
        };
      case "add-edge":
        return {
          ...step,
          edgeId: to(step.edgeId),
          chainNodeIdBefore: toMaybe(step.chainNodeIdBefore),
        };
      case "move-node":
        return { ...step, nodeId: to(step.nodeId) };
      case "delete-node":
        return {
          ...step,
          node: { ...step.node, id: to(step.node.id) },
          attachedEdges: step.attachedEdges.map((edge) => ({
            ...edge,
            id: to(edge.id),
            fromNodeId: to(edge.fromNodeId),
            toNodeId: to(edge.toNodeId),
          })),
        };
      case "delete-edge":
        return {
          ...step,
          edge: {
            ...step.edge,
            id: to(step.edge.id),
            fromNodeId: to(step.edge.fromNodeId),
            toNodeId: to(step.edge.toNodeId),
          },
        };
      case "set-entrance":
        return { ...step, previousEntranceId: toMaybe(step.previousEntranceId) };
    }
  });
}

// Cached for the same reason as the site icons: a new icon object on
// every render makes Leaflet rebuild the marker, which closes any popup
// open on it. See lib/map/site-icon.ts.
const nodeIconCache = new Map<string, L.DivIcon>();

function nodeIcon(isEntrance: boolean, isSelected: boolean, isChainHead: boolean) {
  const key = `${isEntrance}|${isSelected}|${isChainHead}`;
  const cached = nodeIconCache.get(key);
  if (cached) return cached;
  const icon = buildNodeIcon(isEntrance, isSelected, isChainHead);
  nodeIconCache.set(key, icon);
  return icon;
}

function buildNodeIcon(isEntrance: boolean, isSelected: boolean, isChainHead: boolean) {
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
  connectors,
  planCalibration,
  planUnavailable,
  addGraphNode,
  addGraphEdge,
  moveGraphNode,
  deleteGraphNode,
  deleteGraphEdge,
  setEntranceNode,
  clearEntranceNode,
}: {
  resortId: string;
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  entranceNodeId: string | null;
  initialNodes: GraphNode[];
  initialEdges: GraphEdge[];
  sites: SiteMarker[];
  /** Generated site spurs, drawn for context but not editable here. */
  connectors: [number, number][][];
  planCalibration: {
    pairs: PointPair[];
    imageWidth: number;
    imageHeight: number;
    fileName: string | null;
  } | null;
  /** Why there's no overlay to offer, when there isn't. */
  planUnavailable: "not-migrated" | "no-plan" | "not-calibrated" | null;
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
  clearEntranceNode: (input: { resortId: string }) => Promise<NetworkActionState>;
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
  const [undoStack, setUndoStack] = useState<UndoStep[]>([]);
  const [undoNote, setUndoNote] = useState<string | null>(null);

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

  function pushUndo(step: UndoStep) {
    setUndoNote(null);
    setUndoStack((prev) => [...prev, step].slice(-UNDO_LIMIT));
  }

  // Extends the road being drawn: snap to an existing junction if one is
  // close, otherwise drop a new one, then join it to the previous point.
  async function extendChain(lat: number, lng: number, snappedNodeId: string | null) {
    let nodeId = snappedNodeId;
    const chainBefore = chainNodeId;
    // A tap that lands on empty ground creates the junction; one that
    // snaps onto an existing junction creates only the road. Which of
    // those happened decides what undoing the tap has to take back.
    let createdNodeId: string | null = null;

    if (!nodeId) {
      const created = await run(() => addGraphNode({ resortId, lat, lng }));
      if (!created?.nodeId) return;
      nodeId = created.nodeId;
      createdNodeId = created.nodeId;
      setNodes((prev) => [...prev, { id: nodeId!, lat, lng, node_type: "intersection" }]);
    }

    let createdEdgeId: string | null = null;
    const from = chainBefore;
    if (from && from !== nodeId) {
      const fromNode = nodes.find((n) => n.id === from);
      const created = await run(() =>
        addGraphEdge({ resortId, fromNodeId: from, toNodeId: nodeId!, shape: [] })
      );
      if (created?.edgeId && fromNode) {
        createdEdgeId = created.edgeId;
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

    // One tap, one undo step. Deleting the junction cascades to the road
    // drawn with it, so the junction step covers both.
    if (createdNodeId) {
      pushUndo({ kind: "add-node", nodeId: createdNodeId, chainNodeIdBefore: chainBefore });
    } else if (createdEdgeId) {
      pushUndo({ kind: "add-edge", edgeId: createdEdgeId, chainNodeIdBefore: chainBefore });
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
    // Captured before the delete: afterwards there is nothing left to
    // describe what has to come back.
    const node = nodes.find((n) => n.id === nodeId);
    const wasEntrance = entranceId === nodeId;

    const ok = await run(() => deleteGraphNode({ resortId, nodeId }));
    if (!ok) return;
    setEdges((prev) => prev.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId));
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    if (chainNodeId === nodeId) setChainNodeId(null);
    if (wasEntrance) setEntranceId(null);
    setSelectedNodeId(null);
    if (node) {
      pushUndo({ kind: "delete-node", node, attachedEdges: attached, wasEntrance });
    }
  }

  async function handleNodeMoved(nodeId: string, lat: number, lng: number) {
    const before = nodes.find((n) => n.id === nodeId);
    const ok = await run(() => moveGraphNode({ resortId, nodeId, lat, lng }));
    if (!ok) return;
    if (before && (before.lat !== lat || before.lng !== lng)) {
      pushUndo({ kind: "move-node", nodeId, from: { lat: before.lat, lng: before.lng } });
    }
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


  // Takes back the last thing you did, by doing its opposite against the
  // database. Nothing is queued locally: the network on screen and the
  // network stored are the same thing at every point, including
  // mid-undo, so closing the page never leaves half a change behind.
  async function undoLast() {
    const step = undoStack[undoStack.length - 1];
    if (!step || busy) return;

    // Popped first. If the compensating write fails the error is shown
    // and the step is gone - retrying an undo whose state has already
    // moved on is how you get a second, different mistake.
    setUndoStack((prev) => prev.slice(0, -1));
    setUndoNote(null);

    switch (step.kind) {
      case "add-node": {
        const ok = await run(() => deleteGraphNode({ resortId, nodeId: step.nodeId }));
        if (!ok) return;
        setEdges((prev) =>
          prev.filter((e) => e.fromNodeId !== step.nodeId && e.toNodeId !== step.nodeId)
        );
        setNodes((prev) => prev.filter((n) => n.id !== step.nodeId));
        setChainNodeId(step.chainNodeIdBefore);
        if (entranceId === step.nodeId) setEntranceId(null);
        setSelectedNodeId(null);
        setUndoNote("Took back the junction.");
        return;
      }

      case "add-edge": {
        const ok = await run(() => deleteGraphEdge({ resortId, edgeId: step.edgeId }));
        if (!ok) return;
        setEdges((prev) => prev.filter((e) => e.id !== step.edgeId));
        setChainNodeId(step.chainNodeIdBefore);
        setSelectedEdgeId(null);
        setUndoNote("Took back the road.");
        return;
      }

      case "move-node": {
        const ok = await run(() =>
          moveGraphNode({
            resortId,
            nodeId: step.nodeId,
            lat: step.from.lat,
            lng: step.from.lng,
          })
        );
        if (!ok) return;
        setNodes((prev) =>
          prev.map((n) => (n.id === step.nodeId ? { ...n, ...step.from } : n))
        );
        setEdges((prev) =>
          prev.map((edge) => {
            if (edge.fromNodeId !== step.nodeId && edge.toNodeId !== step.nodeId) return edge;
            const shape = [...edge.shape];
            if (edge.fromNodeId === step.nodeId) shape[0] = [step.from.lat, step.from.lng];
            if (edge.toNodeId === step.nodeId) {
              shape[shape.length - 1] = [step.from.lat, step.from.lng];
            }
            return { ...edge, shape };
          })
        );
        setUndoNote("Put the junction back where it was.");
        return;
      }

      case "delete-node": {
        const created = await run(() =>
          addGraphNode({ resortId, lat: step.node.lat, lng: step.node.lng })
        );
        if (!created?.nodeId) return;
        const newNodeId = created.nodeId;
        const restoredNode: GraphNode = { ...step.node, id: newNodeId };
        setNodes((prev) => [...prev, restoredNode]);
        // Everything that comes back does so under a new id; the older
        // steps still naming the old ones get rebound at the end.
        const idMap = new Map<string, string>([[step.node.id, newNodeId]]);

        // The junction comes back with a new id, so every road that ran
        // into it is rebuilt pointing at the replacement. A road whose
        // far end has since been deleted has nothing to attach to and is
        // counted as lost rather than silently dropped.
        let restored = 0;
        let lost = 0;
        for (const edge of step.attachedEdges) {
          const otherId =
            edge.fromNodeId === step.node.id ? edge.toNodeId : edge.fromNodeId;
          const otherStillThere =
            otherId === newNodeId || nodes.some((n) => n.id === otherId);
          if (!otherStillThere) {
            lost += 1;
            continue;
          }

          const fromNodeId = edge.fromNodeId === step.node.id ? newNodeId : edge.fromNodeId;
          const toNodeId = edge.toNodeId === step.node.id ? newNodeId : edge.toNodeId;
          // Endpoints are re-derived from the nodes by the server; only
          // the bends in between need sending back.
          const bends = edge.shape
            .slice(1, -1)
            .map(([lat, lng]) => ({ lat, lng }));

          const createdEdge = await run(() =>
            addGraphEdge({ resortId, fromNodeId, toNodeId, shape: bends })
          );
          if (!createdEdge?.edgeId) {
            lost += 1;
            continue;
          }
          restored += 1;
          idMap.set(edge.id, createdEdge.edgeId);
          setEdges((prev) => [
            ...prev,
            { ...edge, id: createdEdge.edgeId!, fromNodeId, toNodeId },
          ]);
        }

        setUndoStack((prev) => remapUndoStack(prev, idMap));
        if (chainNodeId === step.node.id) setChainNodeId(newNodeId);

        if (step.wasEntrance) {
          const ok = await run(() => setEntranceNode({ resortId, nodeId: newNodeId }));
          if (ok) setEntranceId(newNodeId);
        }

        setUndoNote(
          lost > 0
            ? `Put the junction back with ${restored} of its ${step.attachedEdges.length} roads — ${lost} couldn't be restored because the other end is gone.`
            : `Put the junction and its ${restored} road${restored === 1 ? "" : "s"} back.`
        );
        return;
      }

      case "delete-edge": {
        const bothEndsThere =
          nodes.some((n) => n.id === step.edge.fromNodeId) &&
          nodes.some((n) => n.id === step.edge.toNodeId);
        if (!bothEndsThere) {
          setError(
            "That road can't come back — one of the junctions it ran between has since been deleted."
          );
          return;
        }
        const bends = step.edge.shape.slice(1, -1).map(([lat, lng]) => ({ lat, lng }));
        const created = await run(() =>
          addGraphEdge({
            resortId,
            fromNodeId: step.edge.fromNodeId,
            toNodeId: step.edge.toNodeId,
            shape: bends,
          })
        );
        if (!created?.edgeId) return;
        setEdges((prev) => [...prev, { ...step.edge, id: created.edgeId! }]);
        setUndoStack((prev) =>
          remapUndoStack(prev, new Map([[step.edge.id, created.edgeId!]]))
        );
        setUndoNote("Put the road back.");
        return;
      }

      case "set-entrance": {
        if (step.previousEntranceId) {
          const stillThere = nodes.some((n) => n.id === step.previousEntranceId);
          if (!stillThere) {
            setError(
              "The junction that used to be the entrance has since been deleted, so it can't be put back."
            );
            return;
          }
          const ok = await run(() =>
            setEntranceNode({ resortId, nodeId: step.previousEntranceId! })
          );
          if (!ok) return;
          setEntranceId(step.previousEntranceId);
          setUndoNote("Put the entrance back where it was.");
        } else {
          const ok = await run(() => clearEntranceNode({ resortId }));
          if (!ok) return;
          setEntranceId(null);
          setUndoNote("Cleared the entrance again.");
        }
        return;
      }
    }
  }

  // Ctrl+Z / Cmd+Z, because that is what hands do without being told.
  //
  // Held in a ref, not a dependency: undoLast closes over state that
  // changes with every tap, so depending on it would tear down and
  // re-attach the listener constantly. The ref keeps one listener
  // pointed at the current version.
  const undoRef = useRef(undoLast);
  useEffect(() => {
    undoRef.current = undoLast;
  });

  // Kept off any input the page might grow later, so typing a name
  // somewhere can't quietly delete a road.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "z" && event.key !== "Z") return;
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      void undoRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const nextUndo = undoStack[undoStack.length - 1] ?? null;

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

        <button
          type="button"
          onClick={() => void undoLast()}
          disabled={!nextUndo || busy}
          title={
            nextUndo
              ? `Undo ${describeStep(nextUndo)} (Ctrl+Z)`
              : "Nothing to undo yet"
          }
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800 disabled:opacity-40"
        >
          Undo{undoStack.length > 1 ? ` (${undoStack.length})` : ""}
        </button>

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

      {nextUndo && !undoNote && (
        <p className="text-xs text-neutral-500">
          Undo will take back {describeStep(nextUndo)}.
        </p>
      )}
      {undoNote && <p className="text-xs text-green-700">{undoNote}</p>}

      {planLoading && (
        <p className="text-xs text-neutral-500">Loading the master plan image…</p>
      )}
      {!georeference && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {planUnavailable === "not-migrated" ? (
            <>
              The master plan backdrop needs a database table that isn&apos;t
              there yet — run{" "}
              <code>supabase/migrations/0002_masterplan_drafts.sql</code> in the
              Supabase SQL editor.
            </>
          ) : planUnavailable === "not-calibrated" ? (
            <>
              A master plan is saved for this resort but was never matched to
              the map, so there&apos;s nowhere to put it. Add at least two
              reference points in{" "}
              <a href={`/admin/resorts/${resortId}/import-masterplan`} className="underline">
                Import from master plan
              </a>
              .
            </>
          ) : (
            <>
              No master plan is saved to your account for this resort. Upload it
              once in{" "}
              <a href={`/admin/resorts/${resortId}/import-masterplan`} className="underline">
                Import from master plan
              </a>
              ; if you imported one before drafts moved to the account, it only
              ever existed in that browser.
            </>
          )}{" "}
          Satellite imagery still works for streets that have been built.
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

          {connectors.map((shape, i) => (
            <Polyline
              key={`connector-${i}`}
              positions={shape}
              interactive={false}
              pathOptions={{ color: "#6b7280", weight: 2, opacity: 0.6, dashArray: "4 4" }}
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
                const previousEntranceId = entranceId;
                const ok = await run(() =>
                  setEntranceNode({ resortId, nodeId: selectedNode.id })
                );
                if (!ok) return;
                setEntranceId(selectedNode.id);
                pushUndo({ kind: "set-entrance", previousEntranceId });
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
              pushUndo({ kind: "delete-edge", edge: selectedEdge });
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
