// Turning everything in the database into files you can keep somewhere
// else.
//
// This exists because the whole system's real value is work that took
// hours and can't be re-derived, sitting in a Supabase project on the
// free tier that gets touched a few times a year. Free projects pause
// after a week of inactivity and can eventually be removed. So: a
// one-click download that opens in Excel or Google Sheets, plus a JSON
// copy complete enough to rebuild the database from scratch.
//
// "Everything" grew. Version 1 held resorts and sites, which was all
// there was when it was written. Since then the expensive things have
// been the road network - traced junction by junction, and what makes
// routing work at all - the drawn boundary, and the master plan's
// calibration. A backup that silently stopped covering most of what it
// would hurt to lose is worse than no backup, because it is trusted.
// Version 2 carries all of it.
//
// Pure and dependency-free so it can be unit tested.

export interface BackupResort {
  id: string;
  name: string;
  slug: string;
  is_published: boolean;
  default_zoom: number;
  total_homes: number | null;
  center_lat: number | null;
  center_lng: number | null;
  /** Which junction on the road network the walk starts from. */
  entrance_node_id: string | null;
  map_bearing_deg: number | null;
  created_at: string;
}

export interface BackupSite {
  id: string;
  resort_id: string;
  site_number: string;
  label: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  gps_accuracy_m: number | null;
  /** Where this home joins the network. Without it a restored resort has
   *  its homes and its roads but no way from one to the other. */
  graph_node_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A junction, a bend, or the point where a driveway meets the road. */
export interface BackupGraphNode {
  id: string;
  resort_id: string;
  lat: number;
  lng: number;
  node_type: string;
}

/** A stretch of road between two nodes, with the shape it actually
 *  follows - a straight line between the ends would cut corners the
 *  routing then tells people to drive through. */
export interface BackupGraphEdge {
  id: string;
  resort_id: string;
  from_node_id: string;
  to_node_id: string;
  path_type: string;
  is_bidirectional: boolean;
  /** GeoJSON LineString, as graph_edges_view hands it over. */
  geojson: unknown;
}

/** The perimeter staff traced. Only the drawn one is kept: the computed
 *  fallback re-derives itself from the homes. */
export interface BackupBoundary {
  resort_id: string;
  geojson: unknown;
}

/** The published master plan - the drawing and, more to the point, the
 *  corners that place it in the world. The calibration is the part that
 *  took the work. */
export interface BackupPlanOverlay {
  resort_id: string;
  image_data_url: string;
  content_type: string;
  image_width: number;
  image_height: number;
  top_left_lat: number;
  top_left_lng: number;
  top_right_lat: number;
  top_right_lng: number;
  bottom_left_lat: number;
  bottom_left_lng: number;
  source_file_name: string | null;
  published_at: string;
}

export interface Backup {
  /** Bumped if the shape ever changes, so a restore can tell. Version 1
   *  files still restore - they simply carry less. */
  version: 2;
  exportedAt: string;
  resorts: BackupResort[];
  sites: BackupSite[];
  graphNodes: BackupGraphNode[];
  graphEdges: BackupGraphEdge[];
  boundaries: BackupBoundary[];
  planOverlays: BackupPlanOverlay[];
}

/** What a backup contains, for telling someone plainly what they have
 *  just downloaded rather than leaving them to trust it. */
export function describeBackup(backup: Backup): string {
  const parts = [
    `${backup.resorts.length} ${backup.resorts.length === 1 ? "resort" : "resorts"}`,
    `${backup.sites.length} sites`,
  ];
  if (backup.graphEdges.length > 0) {
    parts.push(`${backup.graphEdges.length} road segments`);
  }
  if (backup.boundaries.length > 0) {
    parts.push(`${backup.boundaries.length} traced ${backup.boundaries.length === 1 ? "boundary" : "boundaries"}`);
  }
  if (backup.planOverlays.length > 0) {
    parts.push(`${backup.planOverlays.length} published ${backup.planOverlays.length === 1 ? "plan" : "plans"}`);
  }
  return parts.join(", ");
}

// Quote anything that could confuse a spreadsheet, and double any quotes
// inside. Site labels are free text typed by staff, so commas and quotes
// in them are a matter of when, not if.
function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: (string | number | boolean | null)[][]): string {
  // \r\n line endings: what Excel expects, and harmless everywhere else.
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// One flat sheet of every site, with its resort's name and slug on each
// row. Denormalised on purpose - this is the file a person opens, sorts
// and filters, not a normalised export.
export function sitesToCsv(backup: Backup): string {
  const resortById = new Map(backup.resorts.map((r) => [r.id, r]));

  return toCsv(
    [
      "resort_slug",
      "resort_name",
      "site_number",
      "label",
      "status",
      "latitude",
      "longitude",
      "gps_accuracy_m",
      "updated_at",
    ],
    backup.sites.map((site) => {
      const resort = resortById.get(site.resort_id);
      return [
        resort?.slug ?? "",
        resort?.name ?? "",
        site.site_number,
        site.label,
        site.status,
        site.lat,
        site.lng,
        site.gps_accuracy_m,
        site.updated_at,
      ];
    })
  );
}

export function resortsToCsv(backup: Backup): string {
  const siteCounts = new Map<string, number>();
  for (const site of backup.sites) {
    siteCounts.set(site.resort_id, (siteCounts.get(site.resort_id) ?? 0) + 1);
  }

  return toCsv(
    [
      "slug",
      "name",
      "is_published",
      "total_homes",
      "sites_captured",
      "reference_lat",
      "reference_lng",
      "default_zoom",
      "created_at",
    ],
    backup.resorts.map((resort) => [
      resort.slug,
      resort.name,
      resort.is_published,
      resort.total_homes,
      siteCounts.get(resort.id) ?? 0,
      resort.center_lat,
      resort.center_lng,
      resort.default_zoom,
      resort.created_at,
    ])
  );
}

// Date-stamped so a folder of these sorts chronologically and nothing
// silently overwrites last month's copy.
export function backupFileName(extension: string, exportedAt = new Date()): string {
  return `resort-directions-backup-${exportedAt.toISOString().slice(0, 10)}.${extension}`;
}
