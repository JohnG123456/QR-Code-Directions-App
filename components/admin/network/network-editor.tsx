"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { BasemapTileLayer } from "@/components/map/basemap-tile-layer";
import { PlanImageOverlay } from "@/components/map/plan-image-overlay";
import { siteDivIcon } from "@/lib/map/site-icon";
import { georeferencePlan } from "@/lib/geo/plan-georeference";
import { distanceMeters, formatDistance } from "@/lib/geo/distance";
import { loadMasterplanDraft } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/import-masterplan/actions";
import type { PointPair } from "@/lib/geo/similarity-transform";
import type { SiteStatus } from "@/lib/types";
import type {
  NetworkActionState,
  SplitEdgeResult,
} from "@/app/(admin)/admin/(protected)/resorts/[resortId]/network/actions";
import { countConnectedToEntrance } from "@/lib/network/connectivity";
import { nearestGap } from "@/lib/network/gap";
import { closestPointOnPolyline, splitShapeAt, type Pt } from "@/lib/network/snap";
import "leaflet/dist/leaflet.css";

// Snapping radius in screen pixels. Generous on purpose: joining a new
// road to an existing junction is the single most common action, and a
// junction that looks joined but isn't is the failure mode that quietly
// breaks routing later.
//
// Judged on screen rather than in metres so it behaves the same at every
// zoom, and sized for a fingertip rather than a mouse pointer - these
// resorts get traced on a laptop trackpad as often as a mouse.
const SNAP_PIXELS = 24;

// A junction's dot is small so a traced network stays readable at low
// zoom, but a 11px target is close to unhittable. The icon is padded out
// with transparent space to give it a real target without making the
// drawing heavier.
const NODE_HIT_PADDING = 10;

// How close the nearest road has to be before the gap is drawn as a
// line rather than only described. A junction stranded a few metres
// short of the road it meant to join is the case worth pointing at; one
// stranded across the resort is a different mistake, and a hairline
// stretched over the whole map would say less than the number does.
const GAP_HINT_METRES = 40;

// Zoom to fly to when showing a disconnected junction. Close enough
// that a two-metre gap is a visible gap on screen - at the zoom the
// whole resort is traced at, the two ends sit inside the same dot.
const GAP_ZOOM = 20;

// Marks the exact point on a road that the next click would join onto.
// Hollow rather than solid so it reads as "this is about to happen"
// rather than "there is a junction here already".
let roadSnapIconCache: L.DivIcon | null = null;
function roadSnapIcon() {
  if (roadSnapIconCache) return roadSnapIconCache;
  roadSnapIconCache = L.divIcon({
    className: "",
    html: `<span style="
      display:block;width:18px;height:18px;border-radius:9999px;
      border:2px solid #2563eb;background:rgba(37,99,235,0.25);
      box-shadow:0 0 0 2px rgba(255,255,255,0.9);
    "></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  return roadSnapIconCache;
}

// Ids for things that exist on the map but not yet in the database.
//
// A tap has to appear instantly - waiting for a round trip before
// drawing anything is what made the editor feel broken - so the junction
// is given a placeholder id and drawn straight away, and the real id
// replaces it everywhere when the insert answers.
const TEMP_PREFIX = "temp-";
const isTempId = (id: string) => id.startsWith(TEMP_PREFIX);

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

// What a click will join onto. A junction is the simple case; a road
// means the road gets divided at that point so the join is real, rather
// than a new junction dropped beside it that looks connected and isn't.
type SnapTarget =
  | { kind: "node"; nodeId: string; lat: number; lng: number }
  | { kind: "edge"; edgeId: string; lat: number; lng: number; index: number };

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

// Gaps are measured in the range where whole metres round away the
// answer: "0 m" for a road that stopped 40 cm short is true and useless.
// Anything wider than a driveway is back to the network-wide format.
function formatGap(meters: number): string {
  return meters < 10 ? `${meters.toFixed(1)} m` : formatDistance(meters);
}

// Cached for the same reason as the site icons: a new icon object on
// every render makes Leaflet rebuild the marker, which closes any popup
// open on it. See lib/map/site-icon.ts.
const nodeIconCache = new Map<string, L.DivIcon>();

function nodeIcon(
  isEntrance: boolean,
  isSelected: boolean,
  isChainHead: boolean,
  isSnapTarget: boolean,
  isUnreachable: boolean
) {
  const key = `${isEntrance}|${isSelected}|${isChainHead}|${isSnapTarget}|${isUnreachable}`;
  const cached = nodeIconCache.get(key);
  if (cached) return cached;
  const icon = buildNodeIcon(isEntrance, isSelected, isChainHead, isSnapTarget, isUnreachable);
  nodeIconCache.set(key, icon);
  return icon;
}

function buildNodeIcon(
  isEntrance: boolean,
  isSelected: boolean,
  isChainHead: boolean,
  isSnapTarget: boolean,
  isUnreachable: boolean
) {
  const dot = isEntrance || isSelected || isChainHead || isUnreachable ? 16 : 11;
  const color = isUnreachable
    ? "#dc2626"
    : isEntrance
      ? "#7c3aed"
      : isChainHead
        ? "#2563eb"
        : "#111827";
  // The box is bigger than the dot: the transparent margin is what your
  // finger actually hits, and it's what makes a junction selectable
  // without drawing a target the size of a house on the map.
  const box = dot + NODE_HIT_PADDING * 2 + (isUnreachable ? 12 : 0);
  // A ring, drawn only while this is what the next click will join onto,
  // so snapping is something you can see coming rather than discover
  // afterwards.
  const ring = isSnapTarget
    ? `<span style="
        position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        width:${dot + 16}px;height:${dot + 16}px;border-radius:9999px;
        border:2px solid #2563eb;background:rgba(37,99,235,0.18);
      "></span>`
    : "";

  // A halo on anything the entrance can't reach. One black dot among
  // three hundred black dots is not findable by eye at any zoom; the
  // halo is drawn wide enough to still be a red smudge when the whole
  // resort is on screen, which is where you're looking from when the
  // warning appears.
  const halo = isUnreachable
    ? `<span style="
        position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        width:${dot + 22}px;height:${dot + 22}px;border-radius:9999px;
        border:3px solid #dc2626;background:rgba(220,38,38,0.25);
      "></span>`
    : "";

  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;position:relative;width:${box}px;height:${box}px;
    ">${halo}${ring}<span style="
      position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
      width:${dot}px;height:${dot}px;border-radius:9999px;
      background:${color};border:2px solid white;
      box-shadow:0 1px 3px rgba(0,0,0,0.5);
    "></span></span>`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
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
  splitGraphEdge,
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
  splitGraphEdge: (input: {
    resortId: string;
    edgeId: string;
    lat: number;
    lng: number;
  }) => Promise<SplitEdgeResult>;
}) {
  const [nodes, setNodes] = useState<GraphNode[]>(initialNodes);
  const [edges, setEdges] = useState<GraphEdge[]>(initialEdges);
  const [entranceId, setEntranceId] = useState<string | null>(entranceNodeId);
  const [mode, setMode] = useState<Mode>("draw");
  const [chainNodeId, setChainNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoStep[]>([]);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  /** How many writes are still in flight. Shown, never used to block
   *  input - blocking input on the network is what made this editor feel
   *  broken in the first place. */
  const [inFlight, setInFlight] = useState(0);
  /** What the next click would join onto, so it can be drawn. */
  const [snapPreview, setSnapPreview] = useState<SnapTarget | null>(null);

  // Leaflet layers handle their own clicks (see the note on the markers
  // below), and that handling needs the map to convert positions.
  const mapRef = useRef<L.Map | null>(null);

  // Placeholder ids handed out to things drawn before the database has
  // answered, and the map from those to the real ids once it has.
  const tempSeqRef = useRef(0);
  const idMapRef = useRef(new Map<string, string>());
  // Writes run one after another: a road can only be inserted once both
  // of its junctions actually exist, so ordering is the whole point.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const newTempId = () => `${TEMP_PREFIX}${++tempSeqRef.current}`;

  /** Follows placeholder ids through to whatever the database called the
   *  row in the end. Chained because a row restored by undo is remapped
   *  a second time. */
  function resolveId(id: string): string {
    let current = id;
    for (let hops = 0; hops < 8; hops++) {
      const next = idMapRef.current.get(current);
      if (!next || next === current) break;
      current = next;
    }
    return current;
  }

  /** Swaps one set of ids for another everywhere they can be held.
   *  Missing one of these is how a junction ends up unreachable by every
   *  later action while still sitting on the map. */
  function applyIdMapping(mapping: Map<string, string>) {
    if (mapping.size === 0) return;
    for (const [from, to] of mapping) idMapRef.current.set(from, to);
    const to = (id: string) => mapping.get(id) ?? id;
    const toMaybe = (id: string | null) => (id === null ? null : to(id));

    setNodes((prev) => prev.map((n) => (mapping.has(n.id) ? { ...n, id: to(n.id) } : n)));
    setEdges((prev) =>
      prev.map((e) => ({
        ...e,
        id: to(e.id),
        fromNodeId: to(e.fromNodeId),
        toNodeId: to(e.toNodeId),
      }))
    );
    setChainNodeId(toMaybe);
    setEntranceId(toMaybe);
    setSelectedNodeId(toMaybe);
    setSelectedEdgeId(toMaybe);
    setUndoStack((prev) => remapUndoStack(prev, mapping));
  }

  /** Runs a write after everything queued before it, without holding up
   *  the map. */
  function enqueue(task: () => Promise<void>) {
    setInFlight((n) => n + 1);
    queueRef.current = queueRef.current
      .then(task)
      .catch(() => setError("That didn't save — check your connection and try again."))
      .finally(() => setInFlight((n) => n - 1));
  }

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

  const unreachableIds = useMemo(
    () => new Set(connectivity.unreachableIds),
    [connectivity]
  );

  // Which cut-off junction "Show me" goes to next. Kept as a plain
  // counter and taken modulo the count so it survives junctions being
  // fixed or created underneath it: on a network with several breaks,
  // pressing the button repeatedly walks around all of them rather than
  // returning to the same one.
  const [gapCursor, setGapCursor] = useState(0);
  const nextUnreachableId =
    connectivity.unreachableIds.length > 0
      ? connectivity.unreachableIds[gapCursor % connectivity.unreachableIds.length]
      : null;

  // Whichever cut-off junction is being talked about: the one you've
  // selected if you've selected one, otherwise the one the button will
  // take you to next.
  const focusedUnreachableId =
    selectedNodeId && unreachableIds.has(selectedNodeId)
      ? selectedNodeId
      : nextUnreachableId;

  // The nearest connected road to the junction currently being pointed
  // at, measured only against roads that are themselves reachable - the
  // orphan's own roads are the ones it is already joined to, and the
  // gap that matters is the one to the rest of the network.
  const focusedUnreachableNode =
    nodes.find((n) => n.id === focusedUnreachableId) ?? null;

  const focusedGap = useMemo(() => {
    const node = focusedUnreachableNode;
    if (!node) return null;
    const reachableRoads = edges
      .filter(
        (e) => !unreachableIds.has(e.fromNodeId) && !unreachableIds.has(e.toNodeId)
      )
      .map((e) => ({ id: e.id, shape: e.shape }));
    return nearestGap({ lat: node.lat, lng: node.lng }, reachableRoads);
  }, [edges, focusedUnreachableNode, unreachableIds]);

  /** Puts the next disconnected junction on screen, selected and close
   *  enough to see what it missed. */
  function showNextGap() {
    const node = nodes.find((n) => n.id === nextUnreachableId);
    if (!node) return;
    setMode("edit");
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setChainNodeId(null);
    const map = mapRef.current;
    if (map) map.flyTo([node.lat, node.lng], Math.max(map.getZoom(), GAP_ZOOM));
    // Advance only once there's somewhere else to advance to, so on a
    // single break the button keeps pointing at the break.
    if (connectivity.unreachableIds.length > 1) setGapCursor((n) => n + 1);
  }

  function pushUndo(step: UndoStep) {
    setUndoNote(null);
    setUndoStack((prev) => [...prev, step].slice(-UNDO_LIMIT));
  }

  // Extends the road being drawn.
  //
  // Everything here happens on the map first and in the database second.
  // The old version awaited each insert before drawing anything and
  // ignored clicks while it waited, so tapping along a street at a
  // normal pace lost most of the taps to a window nothing told you
  // about. Now a tap always lands: the junction appears under your
  // finger with a placeholder id, the writes queue up behind it, and the
  // real ids replace the placeholders as they come back.
  function extendChain(lat: number, lng: number, snap: SnapTarget | null) {
    const chainBefore = chainNodeId;

    // Where the road is being joined on, in one of three ways: onto an
    // existing junction, part-way along an existing road (which splits
    // it), or onto empty ground.
    let targetNodeId: string;
    let createdNodeId: string | null = null;
    let splitEdgeId: string | null = null;
    // Kept so the optimistic split can be reconciled - or put back, if
    // the database decides no split was needed after all.
    let splitHalfIds: [string, string] | null = null;
    let originalSplitEdge: GraphEdge | null = null;

    if (snap?.kind === "node") {
      targetNodeId = snap.nodeId;
    } else if (snap?.kind === "edge") {
      // Draw the split immediately: the road becomes two roads meeting
      // at a new junction. The database redoes this properly and the
      // ids are swapped in when it answers.
      const tempNodeId = newTempId();
      targetNodeId = tempNodeId;
      createdNodeId = tempNodeId;
      splitEdgeId = snap.edgeId;

      const original = edges.find((e) => e.id === snap.edgeId);
      originalSplitEdge = original ?? null;
      setNodes((prev) => [
        ...prev,
        { id: tempNodeId, lat: snap.lat, lng: snap.lng, node_type: "intersection" },
      ]);
      if (original) {
        const [firstHalf, secondHalf] = splitShapeAt(original.shape, snap.index, [
          snap.lat,
          snap.lng,
        ]);
        const firstId = newTempId();
        const secondId = newTempId();
        splitHalfIds = [firstId, secondId];
        setEdges((prev) => [
          ...prev.filter((e) => e.id !== original.id),
          {
            id: firstId,
            fromNodeId: original.fromNodeId,
            toNodeId: tempNodeId,
            pathType: original.pathType,
            lengthM: null,
            shape: firstHalf,
          },
          {
            id: secondId,
            fromNodeId: tempNodeId,
            toNodeId: original.toNodeId,
            pathType: original.pathType,
            lengthM: null,
            shape: secondHalf,
          },
        ]);
      }
    } else {
      const tempNodeId = newTempId();
      targetNodeId = tempNodeId;
      createdNodeId = tempNodeId;
      setNodes((prev) => [
        ...prev,
        { id: tempNodeId, lat, lng, node_type: "intersection" },
      ]);
    }

    // The stretch of road from the last point to this one.
    let createdEdgeId: string | null = null;
    if (chainBefore && chainBefore !== targetNodeId) {
      const fromNode = nodes.find((n) => n.id === chainBefore);
      if (fromNode) {
        createdEdgeId = newTempId();
        const to = snap?.kind === "edge" ? { lat: snap.lat, lng: snap.lng } : { lat, lng };
        setEdges((prev) => [
          ...prev,
          {
            id: createdEdgeId!,
            fromNodeId: chainBefore,
            toNodeId: targetNodeId,
            pathType: "road",
            lengthM: distanceMeters(fromNode, to),
            shape: [
              [fromNode.lat, fromNode.lng],
              [to.lat, to.lng],
            ],
          },
        ]);
      }
    }

    // One tap, one undo step - the junction covers the road drawn with
    // it, because deleting a junction takes its roads too.
    if (createdNodeId) {
      pushUndo({ kind: "add-node", nodeId: createdNodeId, chainNodeIdBefore: chainBefore });
    } else if (createdEdgeId) {
      pushUndo({ kind: "add-edge", edgeId: createdEdgeId, chainNodeIdBefore: chainBefore });
    }

    setChainNodeId(targetNodeId);
    setSnapPreview(null);

    const nodeIdToCreate = createdNodeId;
    const edgeIdToCreate = createdEdgeId;
    const splitFrom = splitEdgeId;

    enqueue(async () => {
      let realTargetId = resolveId(targetNodeId);

      if (splitFrom && nodeIdToCreate) {
        // Splitting replaces one road with two and hands back the
        // junction between them - or, if the click was effectively at an
        // end already, the junction that was there all along.
        const result = await splitGraphEdge({
          resortId,
          edgeId: resolveId(splitFrom),
          lat,
          lng,
        });
        if (!result.nodeId) {
          setError(result.error ?? "Couldn't join onto that road.");
          return;
        }
        realTargetId = result.nodeId;
        const mapping = new Map([[nodeIdToCreate, result.nodeId]]);
        // The two halves were drawn under placeholder ids; the database
        // returns what it called them, in the same order.
        if (result.split && result.firstEdgeId && result.secondEdgeId && splitHalfIds) {
          mapping.set(splitHalfIds[0], result.firstEdgeId);
          mapping.set(splitHalfIds[1], result.secondEdgeId);
        } else if (!result.split && splitHalfIds) {
          // The click was at an end after all: no road was divided, so
          // the halves drawn a moment ago aren't real. Put the original
          // back rather than leave two invented roads on the map.
          setEdges((prev) => {
            const without = prev.filter(
              (e) => e.id !== splitHalfIds[0] && e.id !== splitHalfIds[1]
            );
            return originalSplitEdge ? [...without, originalSplitEdge] : without;
          });
          setNodes((prev) => prev.filter((n) => n.id !== nodeIdToCreate));
        }
        applyIdMapping(mapping);
      } else if (nodeIdToCreate) {
        const created = await addGraphNode({ resortId, lat, lng });
        if (!created.nodeId) {
          setError(created.error ?? "That junction didn't save.");
          return;
        }
        realTargetId = created.nodeId;
        applyIdMapping(new Map([[nodeIdToCreate, created.nodeId]]));
      }

      if (edgeIdToCreate && chainBefore) {
        const realFrom = resolveId(chainBefore);
        if (isTempId(realFrom) || isTempId(realTargetId)) {
          setError("A road couldn't be saved because one of its ends didn't save.");
          return;
        }
        const created = await addGraphEdge({
          resortId,
          fromNodeId: realFrom,
          toNodeId: realTargetId,
          shape: [],
        });
        if (!created.edgeId) {
          setError(created.error ?? "That road didn't save.");
          return;
        }
        applyIdMapping(new Map([[edgeIdToCreate, created.edgeId]]));
      }
    });
  }

  function handleDeleteNode(nodeId: string) {
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

    // Off the map first, out of the database second - the same way a
    // tap works. Waiting on the round trip before removing anything is
    // what made every action feel like it might not have registered.
    setEdges((prev) => prev.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId));
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    if (chainNodeId === nodeId) setChainNodeId(null);
    if (wasEntrance) setEntranceId(null);
    setSelectedNodeId(null);
    if (node) {
      pushUndo({ kind: "delete-node", node, attachedEdges: attached, wasEntrance });
    }

    enqueue(async () => {
      const realId = resolveId(nodeId);
      // Still a placeholder means the insert never landed, so there is
      // nothing in the database to delete.
      if (isTempId(realId)) return;
      const result = await deleteGraphNode({ resortId, nodeId: realId });
      if (result.error) setError(result.error);
    });
  }

  function handleNodeMoved(nodeId: string, lat: number, lng: number) {
    const before = nodes.find((n) => n.id === nodeId);
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

    enqueue(async () => {
      const realId = resolveId(nodeId);
      if (isTempId(realId)) {
        setError("That junction hasn't finished saving, so the move didn't stick.");
        return;
      }
      const result = await moveGraphNode({ resortId, nodeId: realId, lat, lng });
      if (result.error) setError(result.error);
    });
  }


  // Takes back the last thing you did, by doing its opposite against the
  // database.
  //
  // Like every other action here, the map changes first and the write
  // follows in the queue. That matters more than it looks: undo is
  // usually pressed straight after the mistake, often before the
  // mistake's own insert has come back, so the ids the step was recorded
  // with may still be placeholders. Resolving them inside the queued
  // task - rather than when the step was pushed - is what makes
  // "tap, oh no, undo" work at all.
  function undoLast() {
    const step = undoStack[undoStack.length - 1];
    if (!step) return;

    // Popped first. If the compensating write fails the error is shown
    // and the step is gone - retrying an undo whose state has already
    // moved on is how you get a second, different mistake.
    setUndoStack((prev) => prev.slice(0, -1));
    setUndoNote(null);

    switch (step.kind) {
      case "add-node": {
        setEdges((prev) =>
          prev.filter((e) => e.fromNodeId !== step.nodeId && e.toNodeId !== step.nodeId)
        );
        setNodes((prev) => prev.filter((n) => n.id !== step.nodeId));
        setChainNodeId(step.chainNodeIdBefore);
        if (entranceId === step.nodeId) setEntranceId(null);
        setSelectedNodeId(null);
        setUndoNote("Took back the junction.");
        enqueue(async () => {
          const realId = resolveId(step.nodeId);
          if (isTempId(realId)) return;
          const result = await deleteGraphNode({ resortId, nodeId: realId });
          if (result.error) setError(result.error);
        });
        return;
      }

      case "add-edge": {
        setEdges((prev) => prev.filter((e) => e.id !== step.edgeId));
        setChainNodeId(step.chainNodeIdBefore);
        setSelectedEdgeId(null);
        setUndoNote("Took back the road.");
        enqueue(async () => {
          const realId = resolveId(step.edgeId);
          if (isTempId(realId)) return;
          const result = await deleteGraphEdge({ resortId, edgeId: realId });
          if (result.error) setError(result.error);
        });
        return;
      }

      case "move-node": {
        enqueue(async () => {
          const realId = resolveId(step.nodeId);
          if (isTempId(realId)) return;
          const result = await moveGraphNode({
            resortId,
            nodeId: realId,
            lat: step.from.lat,
            lng: step.from.lng,
          });
          if (result.error) setError(result.error);
        });
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
        // Put the junction and its roads back on the map now, under
        // placeholder ids, and let the queue turn them into real rows.
        const tempNodeId = newTempId();
        const restoredNode: GraphNode = { ...step.node, id: tempNodeId };
        setNodes((prev) => [...prev, restoredNode]);

        // A road whose far end has since been deleted has nothing to
        // attach to; it's counted as lost rather than silently dropped.
        const rebuildable: { edge: GraphEdge; tempId: string; from: string; to: string }[] = [];
        let lost = 0;
        for (const edge of step.attachedEdges) {
          const otherId = edge.fromNodeId === step.node.id ? edge.toNodeId : edge.fromNodeId;
          if (otherId !== step.node.id && !nodes.some((nd) => nd.id === otherId)) {
            lost += 1;
            continue;
          }
          const from = edge.fromNodeId === step.node.id ? tempNodeId : edge.fromNodeId;
          const to = edge.toNodeId === step.node.id ? tempNodeId : edge.toNodeId;
          rebuildable.push({ edge, tempId: newTempId(), from, to });
        }
        setEdges((prev) => [
          ...prev,
          ...rebuildable.map(({ edge, tempId, from, to }) => ({
            ...edge,
            id: tempId,
            fromNodeId: from,
            toNodeId: to,
          })),
        ]);

        // The stack still names the deleted junction; point it at the
        // stand-in, which the queue will then point at the real row.
        setUndoStack((prev) =>
          remapUndoStack(
            prev,
            new Map([
              [step.node.id, tempNodeId],
              ...rebuildable.map(({ edge, tempId }) => [edge.id, tempId] as [string, string]),
            ])
          )
        );
        if (chainNodeId === step.node.id) setChainNodeId(tempNodeId);
        if (step.wasEntrance) setEntranceId(tempNodeId);

        setUndoNote(
          lost > 0
            ? `Put the junction back with ${rebuildable.length} of its ${step.attachedEdges.length} roads — ${lost} couldn't be restored because the other end is gone.`
            : `Put the junction and its ${rebuildable.length} road${
                rebuildable.length === 1 ? "" : "s"
              } back.`
        );

        enqueue(async () => {
          const created = await addGraphNode({
            resortId,
            lat: step.node.lat,
            lng: step.node.lng,
          });
          if (!created.nodeId) {
            setError(created.error ?? "That junction couldn't be put back.");
            return;
          }
          applyIdMapping(new Map([[tempNodeId, created.nodeId]]));

          for (const { tempId, from, to, edge } of rebuildable) {
            const realFrom = resolveId(from);
            const realTo = resolveId(to);
            if (isTempId(realFrom) || isTempId(realTo)) continue;
            const bends = edge.shape.slice(1, -1).map(([lat, lng]) => ({ lat, lng }));
            const createdEdge = await addGraphEdge({
              resortId,
              fromNodeId: realFrom,
              toNodeId: realTo,
              shape: bends,
            });
            if (createdEdge.edgeId) {
              applyIdMapping(new Map([[tempId, createdEdge.edgeId]]));
            } else {
              setError(createdEdge.error ?? "A road couldn't be put back.");
            }
          }

          if (step.wasEntrance) {
            const real = resolveId(tempNodeId);
            if (!isTempId(real)) {
              const result = await setEntranceNode({ resortId, nodeId: real });
              if (result.error) setError(result.error);
            }
          }
        });
        return;
      }

      case "delete-edge": {
        const bothEndsThere =
          nodes.some((nd) => nd.id === step.edge.fromNodeId) &&
          nodes.some((nd) => nd.id === step.edge.toNodeId);
        if (!bothEndsThere) {
          setError(
            "That road can't come back — one of the junctions it ran between has since been deleted."
          );
          return;
        }
        const tempEdgeId = newTempId();
        setEdges((prev) => [...prev, { ...step.edge, id: tempEdgeId }]);
        setUndoStack((prev) => remapUndoStack(prev, new Map([[step.edge.id, tempEdgeId]])));
        setUndoNote("Put the road back.");

        enqueue(async () => {
          const realFrom = resolveId(step.edge.fromNodeId);
          const realTo = resolveId(step.edge.toNodeId);
          if (isTempId(realFrom) || isTempId(realTo)) {
            setError("That road couldn't be put back — one of its ends hasn't saved.");
            return;
          }
          const bends = step.edge.shape.slice(1, -1).map(([lat, lng]) => ({ lat, lng }));
          const created = await addGraphEdge({
            resortId,
            fromNodeId: realFrom,
            toNodeId: realTo,
            shape: bends,
          });
          if (!created.edgeId) {
            setError(created.error ?? "That road couldn't be put back.");
            return;
          }
          applyIdMapping(new Map([[tempEdgeId, created.edgeId]]));
        });
        return;
      }

      case "set-entrance": {
        if (step.previousEntranceId) {
          const previousId = step.previousEntranceId;
          if (!nodes.some((nd) => nd.id === previousId)) {
            setError(
              "The junction that used to be the entrance has since been deleted, so it can't be put back."
            );
            return;
          }
          setEntranceId(previousId);
          setUndoNote("Put the entrance back where it was.");
          enqueue(async () => {
            const realId = resolveId(previousId);
            if (isTempId(realId)) return;
            const result = await setEntranceNode({ resortId, nodeId: realId });
            if (result.error) setError(result.error);
          });
        } else {
          setEntranceId(null);
          setUndoNote("Cleared the entrance again.");
          enqueue(async () => {
            const result = await clearEntranceNode({ resortId });
            if (result.error) setError(result.error);
          });
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
          disabled={!nextUndo}
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

        {inFlight > 0 && (
          <span className="text-xs text-neutral-500">
            Saving{inFlight > 1 ? ` ${inFlight} changes` : ""}…
          </span>
        )}
      </div>

      {/* Fixed height, deliberately.
          These lines come and go as you work — the undo hint after the
          first action, an error, the plan loading — and every time one
          did, everything below it moved. On a touch screen that means the
          map slides out from under your finger between taps, so the next
          tap lands somewhere you didn't aim. Reserving the space keeps
          the map still. */}
      <div className="flex min-h-[5rem] flex-col gap-1 sm:min-h-[4rem]">
        <p className="text-sm text-neutral-600">
          {mode === "draw"
            ? chainNodeId
              ? "Keep tapping along the street — each tap continues the road. Tap an existing junction, or anywhere along an existing road, to join onto it, then Finish."
              : "Tap where a street starts, then tap along it. Tap an existing junction — or anywhere along an existing road — to join onto it; the road is split at that point so the join is real."
            : "Tap a junction or a road to move or delete it. Drag a junction to reposition it — the roads follow."}
        </p>

        <p className="text-xs" aria-live="polite">
          {planLoading ? (
            <span className="text-neutral-500">Loading the master plan image…</span>
          ) : error ? (
            <span className="text-red-600">{error}</span>
          ) : undoNote ? (
            <span className="text-green-700">{undoNote}</span>
          ) : nextUndo ? (
            <span className="text-neutral-500">
              Undo will take back {describeStep(nextUndo)}.
            </span>
          ) : (
            <span>&nbsp;</span>
          )}
        </p>
      </div>

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
      <div className="h-[70vh] w-full overflow-hidden rounded-md border border-neutral-200">
        <MapContainer
          center={[centerLat, centerLng]}
          zoom={defaultZoom}
          className="h-full w-full"
        >
          <BasemapTileLayer />
          <CaptureMap mapRef={mapRef} />

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

          {/* Deliberately not gated on whether a save is in flight. The
              old version ignored clicks for the length of every round
              trip, which is what made tapping along a street lose most
              of the taps. */}
          <MapClickHandler
            enabled={mode === "draw"}
            nodes={nodes}
            edges={edges}
            onPlace={extendChain}
            onHover={setSnapPreview}
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
                // Same reason as the junctions: a tap that lands on the
                // line is the road's to handle, not the map's.
                click: (event) => {
                  if (mode === "edit") {
                    setSelectedEdgeId(edge.id);
                    setSelectedNodeId(null);
                    return;
                  }
                  const map = mapRef.current;
                  if (!map) return;
                  const snap = snapToEdge(map, event.latlng, edge);
                  if (snap) extendChain(snap.lat, snap.lng, snap);
                },
              }}
            />
          ))}

          {snapPreview?.kind === "edge" && (
            <Marker
              position={[snapPreview.lat, snapPreview.lng]}
              icon={roadSnapIcon()}
              interactive={false}
            />
          )}

          {/* The gap itself: a dashed line from the junction the entrance
              can't reach to the nearest road it was meant to join. At the
              zoom the network gets traced at, the two ends are the same
              pixel - this is what makes the miss visible once you're in
              close. */}
          {focusedUnreachableNode && focusedGap && focusedGap.distanceM <= GAP_HINT_METRES && (
            <Polyline
              positions={[
                [focusedUnreachableNode.lat, focusedUnreachableNode.lng],
                [focusedGap.lat, focusedGap.lng],
              ]}
              interactive={false}
              pathOptions={{
                color: "#dc2626",
                weight: 3,
                opacity: 0.9,
                dashArray: "5 5",
              }}
            />
          )}

          {nodes.map((node) => (
            <Marker
              key={node.id}
              position={[node.lat, node.lng]}
              icon={nodeIcon(
                node.id === entranceId,
                node.id === selectedNodeId,
                node.id === chainNodeId,
                snapPreview?.kind === "node" && snapPreview.nodeId === node.id,
                unreachableIds.has(node.id)
              )}
              draggable={mode === "edit"}
              eventHandlers={{
                // Leaflet gives a click to the layer under it and stops
                // there - the map's own click handler never runs. So the
                // junction has to do the joining itself: relying on the
                // map to notice a tap that landed on a marker meant
                // tapping a junction did nothing at all, which is
                // exactly the thing you'd try first when joining two
                // roads together.
                click: () => {
                  if (mode === "edit") {
                    setSelectedNodeId(node.id);
                    setSelectedEdgeId(null);
                    return;
                  }
                  extendChain(node.lat, node.lng, {
                    kind: "node",
                    nodeId: node.id,
                    lat: node.lat,
                    lng: node.lng,
                  });
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
          {unreachableIds.has(selectedNode.id) && (
            <span className="text-sm text-red-700">
              Not connected to the entrance
              {focusedGap ? `, ${formatGap(focusedGap.distanceM)} from the nearest connected road` : ""}
              . To join it, switch to &ldquo;Draw roads&rdquo;, tap this
              junction, then tap that road.
            </span>
          )}
          {selectedNode.id !== entranceId && (
            <button
              type="button"
              onClick={() => {
                const previousEntranceId = entranceId;
                const nodeId = selectedNode.id;
                setEntranceId(nodeId);
                pushUndo({ kind: "set-entrance", previousEntranceId });
                enqueue(async () => {
                  const realId = resolveId(nodeId);
                  if (isTempId(realId)) {
                    setError("That junction hasn't finished saving yet.");
                    return;
                  }
                  const result = await setEntranceNode({ resortId, nodeId: realId });
                  if (result.error) setError(result.error);
                });
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              Set as entrance
            </button>
          )}
          <button
            type="button"
            onClick={() => handleDeleteNode(selectedNode.id)}
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
            onClick={() => {
              const edgeId = selectedEdge.id;
              setEdges((prev) => prev.filter((e) => e.id !== edgeId));
              setSelectedEdgeId(null);
              pushUndo({ kind: "delete-edge", edge: selectedEdge });
              enqueue(async () => {
                const realId = resolveId(edgeId);
                if (isTempId(realId)) return;
                const result = await deleteGraphEdge({ resortId, edgeId: realId });
                if (result.error) setError(result.error);
              });
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
          <div className="flex flex-wrap items-center gap-2 text-amber-700">
            <p>
              {connectivity.unreachable} junction
              {connectivity.unreachable === 1 ? " isn't" : "s aren't"} connected
              to the entrance — routes to anything out there will fail. Usually a
              road that stops just short of joining another.
              {focusedGap
                ? ` ${connectivity.unreachable === 1 ? "It's" : "The one shown is"} ${formatGap(
                    focusedGap.distanceM
                  )} from the nearest connected road.`
                : ""}
            </p>
            <button
              type="button"
              onClick={showNextGap}
              className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-800"
            >
              {connectivity.unreachable === 1 ? "Show me" : "Show me the next one"}
            </button>
          </div>
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

// Hands the map instance back out of the container, so the layers'
// own click handlers can do the same snapping maths the map does.
function CaptureMap({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => {
      mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

/** Where along one particular road a click fell. */
function snapToEdge(map: L.Map, latlng: L.LatLng, edge: GraphEdge): SnapTarget | null {
  if (edge.shape.length < 2) return null;
  const clicked = map.latLngToContainerPoint(latlng);
  const hit = closestPointOnPolyline(
    { x: clicked.x, y: clicked.y },
    edge.shape.map(([lat, lng]) => {
      const p = map.latLngToContainerPoint([lat, lng]);
      return { x: p.x, y: p.y };
    })
  );
  if (!hit) return null;
  const snapped = map.containerPointToLatLng([hit.point.x, hit.point.y]);
  return {
    kind: "edge",
    edgeId: edge.id,
    lat: snapped.lat,
    lng: snapped.lng,
    index: hit.index,
  };
}

function MapClickHandler({
  enabled,
  nodes,
  edges,
  onPlace,
  onHover,
}: {
  enabled: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onPlace: (lat: number, lng: number, snap: SnapTarget | null) => void;
  onHover: (snap: SnapTarget | null) => void;
}) {
  const map = useMapEvents({
    click: (event) => {
      if (!enabled) return;
      const snap = findSnap(map, event.latlng, nodes, edges);
      if (snap) onPlace(snap.lat, snap.lng, snap);
      else onPlace(event.latlng.lat, event.latlng.lng, null);
    },
    // Shows what the next click will join onto, before it happens.
    mousemove: (event) => {
      if (!enabled) {
        onHover(null);
        return;
      }
      onHover(findSnap(map, event.latlng, nodes, edges));
    },
    mouseout: () => onHover(null),
  });
  return null;
}

// What a click at this position would join onto, if anything.
//
// Junctions win over roads at equal distance: joining two streets at a
// junction that already exists is always better than splitting a road
// right beside it and leaving two junctions a metre apart.
function findSnap(
  map: L.Map,
  latlng: L.LatLng,
  nodes: GraphNode[],
  edges: GraphEdge[]
): SnapTarget | null {
  const clickPoint = map.latLngToContainerPoint(latlng);
  const at = (lat: number, lng: number): Pt => {
    const p = map.latLngToContainerPoint([lat, lng]);
    return { x: p.x, y: p.y };
  };
  const from: Pt = { x: clickPoint.x, y: clickPoint.y };

  let bestNode: { node: GraphNode; distance: number } | null = null;
  for (const node of nodes) {
    const p = at(node.lat, node.lng);
    const distance = Math.hypot(from.x - p.x, from.y - p.y);
    if (distance <= SNAP_PIXELS && (!bestNode || distance < bestNode.distance)) {
      bestNode = { node, distance };
    }
  }
  if (bestNode) {
    return {
      kind: "node",
      nodeId: bestNode.node.id,
      lat: bestNode.node.lat,
      lng: bestNode.node.lng,
    };
  }

  let bestEdge: { edge: GraphEdge; hit: NonNullable<ReturnType<typeof closestPointOnPolyline>> } | null =
    null;
  for (const edge of edges) {
    if (edge.shape.length < 2) continue;
    const hit = closestPointOnPolyline(
      from,
      edge.shape.map(([lat, lng]) => at(lat, lng))
    );
    if (!hit || hit.distance > SNAP_PIXELS) continue;
    if (!bestEdge || hit.distance < bestEdge.hit.distance) bestEdge = { edge, hit };
  }
  if (bestEdge) {
    const snapped = map.containerPointToLatLng([bestEdge.hit.point.x, bestEdge.hit.point.y]);
    return {
      kind: "edge",
      edgeId: bestEdge.edge.id,
      lat: snapped.lat,
      lng: snapped.lng,
      index: bestEdge.hit.index,
    };
  }

  return null;
}
