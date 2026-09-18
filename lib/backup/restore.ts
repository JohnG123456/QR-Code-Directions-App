// Reading a backup file back in.
//
// A backup nobody has ever restored is a guess, not a safety net, so the
// JSON export is deliberately restore-ready and this is the code that
// reads it. It's also the recovery path if the Supabase project is ever
// lost: create a new project, run the migrations, restore this file.
//
// Restoring never deletes anything. Resorts are matched by slug and sites
// by (resort, site number), so restoring into a database that still has
// data merges rather than clobbers - and restoring the same file twice
// changes nothing the second time.
//
// The road network is the exception to "merge", and has to be. Two
// networks laid over each other are not a merged network, they are a
// duplicated one, and pgRouting would happily route through the result.
// So a resort that already has roads keeps them and the file's are
// skipped; a resort with none gets the file's.
//
// Pure parsing/validation here; the database writes live in the backup
// page's server action.

import { z } from "zod";
import { normaliseSiteNumber } from "@/lib/sites/site-number";

const resortSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  is_published: z.boolean().default(false),
  default_zoom: z.number().int().default(19),
  total_homes: z.number().int().nullable().default(null),
  center_lat: z.number().nullable().default(null),
  center_lng: z.number().nullable().default(null),
  entrance_node_id: z.string().nullable().default(null),
  map_bearing_deg: z.number().nullable().default(null),
});

const siteSchema = z.object({
  resort_id: z.string(),
  graph_node_id: z.string().nullable().default(null),
  // A backup taken before site numbers were padded holds them
  // unpadded. Restoring one as-is would quietly undo the tidy-up and
  // leave the same home spelled two ways again, so they're brought into
  // line on the way in. Anything that isn't a plain site number is left
  // exactly as it was found.
  site_number: z
    .string()
    .min(1)
    .transform((raw) => normaliseSiteNumber(raw) ?? raw),
  label: z.string().nullable().default(null),
  status: z.enum(["active", "inactive", "draft"]).default("draft"),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  gps_accuracy_m: z.number().nullable().default(null),
});

// Everything below arrived with version 2 and is optional, so a version
// 1 file - which had none of it - still restores rather than being
// rejected as malformed. An old backup is exactly the situation this
// tool exists for; refusing to read one would be perverse.

const graphNodeSchema = z.object({
  id: z.string(),
  resort_id: z.string(),
  lat: z.number(),
  lng: z.number(),
  node_type: z.string().default("intersection"),
});

const lineStringSchema = z.object({
  type: z.string(),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

const graphEdgeSchema = z.object({
  resort_id: z.string(),
  from_node_id: z.string(),
  to_node_id: z.string(),
  path_type: z.string().default("road"),
  is_bidirectional: z.boolean().default(true),
  geojson: lineStringSchema,
});

const boundarySchema = z.object({
  resort_id: z.string(),
  geojson: z.object({
    type: z.string(),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
});

const planOverlaySchema = z.object({
  resort_id: z.string(),
  image_data_url: z.string().min(1),
  content_type: z.string().default("image/webp"),
  image_width: z.number().int(),
  image_height: z.number().int(),
  top_left_lat: z.number(),
  top_left_lng: z.number(),
  top_right_lat: z.number(),
  top_right_lng: z.number(),
  bottom_left_lat: z.number(),
  bottom_left_lng: z.number(),
  source_file_name: z.string().nullable().default(null),
});

const backupSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string().optional(),
  resorts: z.array(resortSchema),
  sites: z.array(siteSchema),
  graphNodes: z.array(graphNodeSchema).default([]),
  graphEdges: z.array(graphEdgeSchema).default([]),
  boundaries: z.array(boundarySchema).default([]),
  planOverlays: z.array(planOverlaySchema).default([]),
});

export type ParsedBackup = z.infer<typeof backupSchema>;

/** GeoJSON coordinates are [lng, lat], and EWKT wants them in that order
 *  too, space-separated - the one place those two conventions agree, and
 *  worth saying out loud because everything else in this codebase is
 *  [lat, lng]. Getting it backwards would restore a resort's roads into
 *  the Indian Ocean, and do it silently. */
export function lineToEwkt(coordinates: [number, number][]): string {
  return `SRID=4326;LINESTRING(${coordinates.map(([lng, lat]) => `${lng} ${lat}`).join(", ")})`;
}

export function ringToEwkt(rings: [number, number][][]): string {
  return `SRID=4326;POLYGON(${rings
    .map((ring) => `(${ring.map(([lng, lat]) => `${lng} ${lat}`).join(", ")})`)
    .join(", ")})`;
}

export interface ParseOutcome {
  backup: ParsedBackup | null;
  error: string | null;
  /** Sites dropped because they have no position - nothing to restore. */
  skippedSites: number;
}

export function parseBackup(text: string): ParseOutcome {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      backup: null,
      error: "That file isn't valid JSON. Use the .json backup, not a CSV.",
      skippedSites: 0,
    };
  }

  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      backup: null,
      error: `That doesn't look like a backup file (${issue?.path.join(".") || "file"}: ${issue?.message}).`,
      skippedSites: 0,
    };
  }

  const positioned = parsed.data.sites.filter((s) => s.lat !== null && s.lng !== null);

  return {
    backup: { ...parsed.data, sites: positioned },
    error: null,
    skippedSites: parsed.data.sites.length - positioned.length,
  };
}
