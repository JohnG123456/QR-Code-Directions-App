// Checks that every junction can actually be walked to from the entrance.
//
// The way a hand-traced network breaks is almost never dramatic: a road
// stops two metres short of the one it was meant to join, so it looks
// connected and isn't. Routing to anything beyond that point then fails
// for visitors, long after whoever traced it has moved on. A plain flood
// fill from the entrance catches it while the map is still open.
//
// Pure and dependency-free so it can be unit tested.

export interface EdgeLink {
  fromNodeId: string;
  toNodeId: string;
}

export interface Connectivity {
  reachable: number;
  unreachable: number;
  /** Which junctions are cut off, in the order they were given. A count
   *  on its own tells you something is wrong without telling you where,
   *  and on a 300-junction network "somewhere" is not a place you can
   *  look - so the ids come back too, for the map to point at. */
  unreachableIds: string[];
}

export function countConnectedToEntrance(
  nodeIds: string[],
  edges: EdgeLink[],
  entranceNodeId: string | null
): Connectivity {
  if (!entranceNodeId || nodeIds.length === 0) {
    return { reachable: 0, unreachable: 0, unreachableIds: [] };
  }

  const neighbours = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const existing = neighbours.get(a);
    if (existing) existing.push(b);
    else neighbours.set(a, [b]);
  };
  for (const edge of edges) {
    // Undirected: a one-way internal road is rare enough that treating
    // every road as walkable both ways is the right default here.
    link(edge.fromNodeId, edge.toNodeId);
    link(edge.toNodeId, edge.fromNodeId);
  }

  const seen = new Set<string>([entranceNodeId]);
  const queue = [entranceNodeId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of neighbours.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  // Only count nodes that actually exist - the entrance itself might have
  // been deleted out from under the resort's reference to it.
  const known = new Set(nodeIds);
  let reachable = 0;
  for (const id of seen) if (known.has(id)) reachable += 1;

  const unreachableIds: string[] = [];
  const listed = new Set<string>();
  for (const id of nodeIds) {
    if (seen.has(id) || listed.has(id)) continue;
    listed.add(id);
    unreachableIds.push(id);
  }

  return { reachable, unreachable: known.size - reachable, unreachableIds };
}
