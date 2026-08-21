// Turning everything in the database into files you can keep somewhere
// else.
//
// This exists because the whole system's real value is the site
// coordinates, and they live in a Supabase project on the free tier that
// gets touched a few times a year. Free projects pause after a week of
// inactivity and can eventually be removed; the coordinates took hours to
// capture and can't be re-derived from anything but the master plans. So:
// a one-click download that opens in Excel or Google Sheets, plus a JSON
// copy complete enough to rebuild the database from scratch.
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
  created_at: string;
  updated_at: string;
}

export interface Backup {
  /** Bumped if the shape ever changes, so a restore can tell. */
  version: 1;
  exportedAt: string;
  resorts: BackupResort[];
  sites: BackupSite[];
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
