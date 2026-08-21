import type { SiteStatus } from "@/lib/types";

// Decides what a bulk import should write for each row, given what's
// already stored for that resort.
//
// The point is that re-importing must not undo curation. A master plan
// gets revised (a new revision of the sheet, more stages built out) and
// re-imported months later, by which time staff have already reviewed
// sites and switched them to "active", and may have added labels via CSV.
// A naive upsert would stamp every touched row back to status "draft" -
// silently dropping live sites out of visitor search - and null out
// labels the incoming file doesn't carry.
//
// So: coordinates always come from the import (that's the point of
// re-importing), but status is preserved for sites that already exist,
// and a label is only overwritten when the import actually supplies one.
//
// Pure and dependency-free so it can be unit tested without a database.

export interface ImportRow {
  site_number: string;
  label: string | null;
  location: string;
}

export interface ExistingSite {
  site_number: string;
  status: SiteStatus;
  label: string | null;
}

export interface MergedRow extends ImportRow {
  resort_id: string;
  status: SiteStatus;
}

export interface DedupeResult {
  rows: ImportRow[];
  /** Site numbers that appeared more than once, for reporting back. */
  duplicates: string[];
}

// Postgres refuses to update the same row twice within one statement
// ("ON CONFLICT DO UPDATE command cannot affect row a second time"), so a
// single duplicated site number fails the entire import - 0 sites written.
//
// Duplicates are easy to end up with here: the same number can be printed
// twice on a master plan sheet, or picked up once by the extractor and
// again when staff add a number by hand. Rather than failing the batch,
// keep the last occurrence (the most recently placed position wins) and
// report which numbers were duplicated so they can be checked.
export function dedupeImportRows(rows: ImportRow[]): DedupeResult {
  const byNumber = new Map<string, ImportRow>();
  const seenTwice = new Set<string>();

  for (const row of rows) {
    if (byNumber.has(row.site_number)) seenTwice.add(row.site_number);
    byNumber.set(row.site_number, row);
  }

  return {
    rows: [...byNumber.values()],
    duplicates: [...seenTwice].sort(),
  };
}

export function mergeImportRows(
  resortId: string,
  rows: ImportRow[],
  existing: ExistingSite[]
): MergedRow[] {
  const existingBySiteNumber = new Map(existing.map((site) => [site.site_number, site]));

  return rows.map((row) => {
    const match = existingBySiteNumber.get(row.site_number);
    return {
      ...row,
      resort_id: resortId,
      // New sites land as drafts for review; existing sites keep whatever
      // status staff already chose.
      status: match?.status ?? ("draft" as SiteStatus),
      label: row.label ?? match?.label ?? null,
    };
  });
}
