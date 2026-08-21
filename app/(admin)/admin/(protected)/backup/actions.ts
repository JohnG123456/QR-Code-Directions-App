"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseBackup } from "@/lib/backup/restore";

export interface RestoreResult {
  resorts: number;
  sites: number;
  skippedSites: number;
  errors: string[];
}

// Rebuilds resorts and sites from a JSON backup. Additive: matches
// resorts by slug and sites by (resort, site number), so it merges into
// whatever is already there and re-running it is harmless.
export async function restoreBackup(fileText: string): Promise<RestoreResult> {
  const empty: RestoreResult = { resorts: 0, sites: 0, skippedSites: 0, errors: [] };

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

  revalidatePath("/admin/resorts");
  revalidatePath("/admin/backup");

  return {
    resorts: backup.resorts.length,
    sites: restoredSites,
    skippedSites,
    errors,
  };
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
