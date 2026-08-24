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
});

const siteSchema = z.object({
  resort_id: z.string(),
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

const backupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  resorts: z.array(resortSchema),
  sites: z.array(siteSchema),
});

export type ParsedBackup = z.infer<typeof backupSchema>;

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
