"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseBackup, lineToEwkt, ringToEwkt } from "@/lib/backup/restore";

export interface RestoreResult {
  resorts: number;
  sites: number;
  skippedSites: number;
  /** Road segments restored, across every resort that had none. */
  roadSegments: number;
  boundaries: number;
  plans: number;
  /** Resorts whose roads were left alone because they already had some. */
  networksSkipped: string[];
  errors: string[];
}

// Rebuilds resorts and sites from a JSON backup. Additive: matches
// resorts by slug and sites by (resort, site number), so it merges into
// whatever is already there and re-running it is harmless.
export async function restoreBackup(fileText: string): Promise<RestoreResult> {
  const empty: RestoreResult = {
    resorts: 0,
    sites: 0,
    skippedSites: 0,
    roadSegments: 0,
    boundaries: 0,
    plans: 0,
    networksSkipped: [],
    errors: [],
  };

  const { backup, error, skippedSites } = parseBackup(fileText);
  if (!backup) return { ...empty, errors: [error ?? "Couldn't read that file."] };

  const supabase = await createClient();
  const errors: string[] = [];

  // Resorts first: sites can't be restored without one to attach to.
  // The ids in the file are ignored - a resort that already exists keeps
  // its own id - so sites are re-linked by slug below.
  if (backup.resorts.length > 0) {
    const { error: resortError } = await supabase.from("resorts").upsert(
      backup.resorts.map((resort) => ({
        name: resort.name,
        slug: resort.slug,
        is_published: resort.is_published,
        default_zoom: resort.default_zoom,
        total_homes: resort.total_homes,
        center:
          resort.center_lat !== null && resort.center_lng !== null
            ? `SRID=4326;POINT(${resort.center_lng} ${resort.center_lat})`
            : null,
      })),
      { onConflict: "slug" }
    );
    if (resortError) {
      return { ...empty, skippedSites, errors: [resortError.message] };
    }
  }

  const { data: liveResorts, error: lookupError } = await supabase
    .from("resorts")
    .select("id, slug");
  if (lookupError) {
    return { ...empty, skippedSites, errors: [lookupError.message] };
  }

  const idBySlug = new Map((liveResorts ?? []).map((r) => [r.slug, r.id]));
  const slugByBackupId = new Map(backup.resorts.map((r) => [r.id, r.slug]));

  const rows = backup.sites.flatMap((site) => {
    const slug = slugByBackupId.get(site.resort_id);
    const resortId = slug ? idBySlug.get(slug) : undefined;
    if (!resortId) return [];
    return [
      {
        resort_id: resortId,
        site_number: site.site_number,
        label: site.label,
        status: site.status,
        gps_accuracy_m: site.gps_accuracy_m,
        location: `SRID=4326;POINT(${site.lng} ${site.lat})`,
      },
    ];
  });

  const orphaned = backup.sites.length - rows.length;
  if (orphaned > 0) {
    errors.push(`${orphaned} sites referenced a resort that isn't in the file and were skipped.`);
  }

  let restoredSites = 0;
  if (rows.length > 0) {
    // Same Postgres constraint as the import tool: one statement can't
    // update the same row twice. A backup shouldn't contain duplicates,
    // but a hand-edited one might.
    const { rows: uniqueRows, duplicates } = dedupeByResortAndNumber(rows);

    if (duplicates.length > 0) {
      errors.push(`Duplicate site numbers in the file were collapsed: ${duplicates.join(", ")}.`);
    }

    // Chunked: a full multi-resort restore can run to a few thousand
    // rows, which is more than one request should carry.
    const CHUNK = 500;
    for (let i = 0; i < uniqueRows.length; i += CHUNK) {
      const chunk = uniqueRows.slice(i, i + CHUNK);
      const { error: siteError, count } = await supabase
        .from("sites")
        .upsert(chunk, { onConflict: "resort_id,site_number", count: "exact" });
      if (siteError) {
        errors.push(siteError.message);
        break;
      }
      restoredSites += count ?? chunk.length;
    }
  }

  // Everything above is resorts and sites, which merge. What follows is
  // the work that can't be re-derived: the traced roads, the drawn
  // perimeter and the plan's calibration.
  const extra = await restoreResortExtras(supabase, backup, idBySlug, slugByBackupId, errors);

  revalidatePath("/admin/resorts");
  revalidatePath("/admin/backup");

  return {
    resorts: backup.resorts.length,
    sites: restoredSites,
    skippedSites,
    ...extra,
    errors,
  };
}

async function restoreResortExtras(
  supabase: Awaited<ReturnType<typeof createClient>>,
  backup: NonNullable<ReturnType<typeof parseBackup>["backup"]>,
  idBySlug: Map<string, string>,
  slugByBackupId: Map<string, string>,
  errors: string[]
): Promise<Pick<RestoreResult, "roadSegments" | "boundaries" | "plans" | "networksSkipped">> {
  let roadSegments = 0;
  let boundaries = 0;
  let plans = 0;
  const networksSkipped: string[] = [];

  /** Where each backup id ended up. The file's ids are not reused - a
   *  resort that already exists keeps its own - so everything that points
   *  at a node has to be pointed at the new one instead. */
  const nodeIdMap = new Map<string, string>();

  for (const resort of backup.resorts) {
    const slug = slugByBackupId.get(resort.id) ?? resort.slug;
    const liveId = idBySlug.get(slug);
    if (!liveId) continue;

    const nodes = backup.graphNodes.filter((n) => n.resort_id === resort.id);
    const edges = backup.graphEdges.filter((e) => e.resort_id === resort.id);

    if (nodes.length > 0) {
      // Merging two road networks produces a duplicated one, not a
      // merged one, so a resort that already has roads keeps them.
      const { count: existing } = await supabase
        .from("graph_nodes")
        .select("id", { count: "exact", head: true })
        .eq("resort_id", liveId);

      if ((existing ?? 0) > 0) {
        networksSkipped.push(slug);
      } else {
        const { data: inserted, error: nodeError } = await supabase
          .from("graph_nodes")
          .insert(
            nodes.map((node) => ({
              resort_id: liveId,
              geom: `SRID=4326;POINT(${node.lng} ${node.lat})`,
              node_type: node.node_type,
            }))
          )
          .select("id");

        if (nodeError) {
          errors.push(`${slug}: couldn't restore the road network (${nodeError.message}).`);
        } else {
          // Insert order is preserved, which is what lets the file's ids
          // be matched to the new ones without storing either.
          (inserted ?? []).forEach((row, i) => {
            if (nodes[i]) nodeIdMap.set(nodes[i].id, (row as { id: string }).id);
          });

          const edgeRows = edges.flatMap((edge) => {
            const from = nodeIdMap.get(edge.from_node_id);
            const to = nodeIdMap.get(edge.to_node_id);
            if (!from || !to) return [];
            return [
              {
                resort_id: liveId,
                from_node_id: from,
                to_node_id: to,
                geom: lineToEwkt(edge.geojson.coordinates),
                path_type: edge.path_type,
                is_bidirectional: edge.is_bidirectional,
              },
            ];
          });

          if (edgeRows.length > 0) {
            const { error: edgeError, count } = await supabase
              .from("graph_edges")
              .insert(edgeRows, { count: "exact" });
            if (edgeError) {
              errors.push(`${slug}: roads partly restored (${edgeError.message}).`);
            } else {
              roadSegments += count ?? edgeRows.length;
            }
          }

          // The entrance is a node, so it has to be re-pointed too - and
          // without it route_to_site has nowhere to start.
          const entrance = resort.entrance_node_id
            ? nodeIdMap.get(resort.entrance_node_id)
            : null;
          if (entrance) {
            await supabase
              .from("resorts")
              .update({ entrance_node_id: entrance })
              .eq("id", liveId);
          }

          // And each home's connection to it. Without these a restored
          // resort has its homes and its roads and no way between them.
          const connections = backup.sites.flatMap((site) => {
            if (site.resort_id !== resort.id || !site.graph_node_id) return [];
            const nodeId = nodeIdMap.get(site.graph_node_id);
            return nodeId ? [{ site_number: site.site_number, nodeId }] : [];
          });
          for (const connection of connections) {
            await supabase
              .from("sites")
              .update({ graph_node_id: connection.nodeId })
              .eq("resort_id", liveId)
              .eq("site_number", connection.site_number);
          }
        }
      }
    }

    const boundary = backup.boundaries.find((b) => b.resort_id === resort.id);
    if (boundary) {
      const { error: boundaryError } = await supabase
        .from("resorts")
        .update({ boundary: ringToEwkt(boundary.geojson.coordinates) })
        .eq("id", liveId);
      if (boundaryError) {
        errors.push(`${slug}: couldn't restore the boundary (${boundaryError.message}).`);
      } else {
        boundaries += 1;
      }
    }

    if (resort.map_bearing_deg !== null) {
      await supabase
        .from("resorts")
        .update({ map_bearing_deg: resort.map_bearing_deg })
        .eq("id", liveId);
    }

    const overlay = backup.planOverlays.find((o) => o.resort_id === resort.id);
    if (overlay) {
      const { error: overlayError } = await supabase
        .from("resort_plan_overlays")
        .upsert(
          { ...overlay, resort_id: liveId },
          { onConflict: "resort_id" }
        );
      if (overlayError) {
        errors.push(`${slug}: couldn't restore the master plan (${overlayError.message}).`);
      } else {
        plans += 1;
      }
    }
  }

  return { roadSegments, boundaries, plans, networksSkipped };
}

interface SiteRow {
  resort_id: string;
  site_number: string;
  label: string | null;
  status: string;
  gps_accuracy_m: number | null;
  location: string;
}

// Site numbers are only unique within a resort, so dedupe on the pair.
function dedupeByResortAndNumber(rows: SiteRow[]): { rows: SiteRow[]; duplicates: string[] } {
  const byKey = new Map<string, SiteRow>();
  const seenTwice = new Set<string>();
  for (const row of rows) {
    const key = `${row.resort_id}:${row.site_number}`;
    if (byKey.has(key)) seenTwice.add(row.site_number);
    byKey.set(key, row);
  }
  return { rows: [...byKey.values()], duplicates: [...seenTwice].sort() };
}
