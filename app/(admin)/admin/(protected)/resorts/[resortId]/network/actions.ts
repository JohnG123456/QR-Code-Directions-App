"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// The road network behind real walking directions.
//
// Nodes are junctions and dead ends; edges are the stretches of road
// between them, each carrying the actual shape it follows so a curved
// street looks curved. This is the graph pgRouting runs over, so it's
// built as a clean topology up front rather than snapped together at
// request time.

export interface NetworkActionState {
  error?: string;
  nodeId?: string;
  edgeId?: string;
}

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const addNodeSchema = z.object({
  resortId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  nodeType: z.enum(["intersection", "entrance", "site", "poi"]).default("intersection"),
});

export async function addGraphNode(
  input: z.input<typeof addNodeSchema>
): Promise<NetworkActionState> {
  const parsed = addNodeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid point" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("graph_nodes")
    .insert({
      resort_id: parsed.data.resortId,
      geom: `SRID=4326;POINT(${parsed.data.lng} ${parsed.data.lat})`,
      node_type: parsed.data.nodeType,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/network`);
  return { nodeId: data.id };
}

const moveNodeSchema = z.object({
  resortId: z.string().uuid(),
  nodeId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// Dragging a junction has to drag the roads attached to it too, or the
// graph comes apart visually while staying connected in the database -
// which is worse than either being wrong on its own.
export async function moveGraphNode(
  input: z.infer<typeof moveNodeSchema>
): Promise<NetworkActionState> {
  const parsed = moveNodeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid point" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("move_graph_node", {
    p_node_id: parsed.data.nodeId,
    p_lat: parsed.data.lat,
    p_lng: parsed.data.lng,
  });

  if (error) return { error: error.message };
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/network`);
  return {};
}

const deleteNodeSchema = z.object({
  resortId: z.string().uuid(),
  nodeId: z.string().uuid(),
});

export async function deleteGraphNode(
  input: z.infer<typeof deleteNodeSchema>
): Promise<NetworkActionState> {
  const parsed = deleteNodeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid node" };

  const supabase = await createClient();
  // Edges reference nodes with ON DELETE CASCADE, so any road running
  // into this junction goes with it. The UI says how many first.
  const { error } = await supabase
    .from("graph_nodes")
    .delete()
    .eq("id", parsed.data.nodeId)
    .eq("resort_id", parsed.data.resortId);

  if (error) return { error: error.message };
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/network`);
  return {};
}

const addEdgeSchema = z.object({
  resortId: z.string().uuid(),
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  // Bend points between the two ends, so a curved street is stored curved
  // and the visitor's route follows the road rather than cutting corners.
  shape: z.array(latLngSchema).default([]),
  pathType: z.enum(["road", "path", "stairs"]).default("road"),
});

export async function addGraphEdge(
  input: z.input<typeof addEdgeSchema>
): Promise<NetworkActionState> {
  const parsed = addEdgeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid road" };
  if (parsed.data.fromNodeId === parsed.data.toNodeId) {
    return { error: "A road has to run between two different points." };
  }

  const supabase = await createClient();

  const { data: ends, error: endsError } = await supabase
    .from("graph_nodes")
    .select("id, lat, lng")
    .in("id", [parsed.data.fromNodeId, parsed.data.toNodeId]);

  if (endsError) return { error: endsError.message };
  const from = ends?.find((n) => n.id === parsed.data.fromNodeId);
  const to = ends?.find((n) => n.id === parsed.data.toNodeId);
  if (!from || !to) return { error: "Couldn't find both ends of that road." };

  const points = [
    `${from.lng} ${from.lat}`,
    ...parsed.data.shape.map((p) => `${p.lng} ${p.lat}`),
    `${to.lng} ${to.lat}`,
  ];

  const { data, error } = await supabase
    .from("graph_edges")
    .insert({
      resort_id: parsed.data.resortId,
      from_node_id: parsed.data.fromNodeId,
      to_node_id: parsed.data.toNodeId,
      geom: `SRID=4326;LINESTRING(${points.join(", ")})`,
      path_type: parsed.data.pathType,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/network`);
  return { edgeId: data.id };
}

const deleteEdgeSchema = z.object({
  resortId: z.string().uuid(),
  edgeId: z.string().uuid(),
});

export async function deleteGraphEdge(
  input: z.infer<typeof deleteEdgeSchema>
): Promise<NetworkActionState> {
  const parsed = deleteEdgeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid road" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("graph_edges")
    .delete()
    .eq("id", parsed.data.edgeId)
    .eq("resort_id", parsed.data.resortId);

  if (error) return { error: error.message };
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/network`);
  return {};
}

const setEntranceSchema = z.object({
  resortId: z.string().uuid(),
  nodeId: z.string().uuid(),
});

// Every visitor route starts here, so it wants to be the point someone
// is actually standing at when they scan the sign.
export async function setEntranceNode(
  input: z.infer<typeof setEntranceSchema>
): Promise<NetworkActionState> {
  const parsed = setEntranceSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid node" };

  const supabase = await createClient();
  const { error: typeError } = await supabase
    .from("graph_nodes")
    .update({ node_type: "entrance" })
    .eq("id", parsed.data.nodeId)
    .eq("resort_id", parsed.data.resortId);
  if (typeError) return { error: typeError.message };

  const { error } = await supabase
    .from("resorts")
    .update({ entrance_node_id: parsed.data.nodeId })
    .eq("id", parsed.data.resortId);

  if (error) return { error: error.message };
  revalidatePath(`/admin/resorts/${parsed.data.resortId}/network`);
  revalidatePath(`/r`);
  return {};
}

export interface ConnectResult {
  connected: number;
  error?: string;
}

// Attaches every site to its nearest road, splitting that road so the
// junction actually exists in the graph. Run after tracing, and again
// after adding or moving sites.
export async function connectSitesToNetwork(
  resortId: string,
  reconnectAll: boolean
): Promise<ConnectResult> {
  if (!z.string().uuid().safeParse(resortId).success) {
    return { connected: 0, error: "Invalid resort" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("connect_sites_to_network", {
    p_resort_id: resortId,
    p_reconnect: reconnectAll,
  });

  if (error) return { connected: 0, error: error.message };

  revalidatePath(`/admin/resorts/${resortId}/network`);
  revalidatePath(`/admin/resorts/${resortId}/sites`);
  return { connected: typeof data === "number" ? data : 0 };
}
