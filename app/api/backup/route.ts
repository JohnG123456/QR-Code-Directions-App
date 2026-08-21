import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  backupFileName,
  resortsToCsv,
  sitesToCsv,
  type Backup,
  type BackupResort,
  type BackupSite,
} from "@/lib/backup/export";

// Downloads the whole database as a file. Staff-only: this is every
// site's exact position for every resort.
//
// ?format=sites-csv    one row per site, opens in Excel/Sheets (default)
// ?format=resorts-csv  one row per resort
// ?format=json         everything, in the shape the restore tool reads

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // RLS would already block the reads below for a non-staff account, but
  // an explicit check gives an honest error instead of an empty backup -
  // an empty file that looks like a successful backup is the worst
  // possible outcome here.
  const { data: staff } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!staff) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  const [{ data: resorts, error: resortsError }, { data: sites, error: sitesError }] =
    await Promise.all([
      supabase
        .from("resorts")
        .select(
          "id, name, slug, is_published, default_zoom, total_homes, center_lat, center_lng, created_at"
        )
        .order("name"),
      supabase
        .from("sites")
        .select(
          "id, resort_id, site_number, label, status, lat, lng, gps_accuracy_m, created_at, updated_at"
        )
        .order("resort_id")
        .order("site_number"),
    ]);

  // Never hand back a partial backup as if it were complete.
  if (resortsError || sitesError) {
    return NextResponse.json(
      { error: (resortsError ?? sitesError)?.message ?? "Couldn't read the data." },
      { status: 500 }
    );
  }

  const backup: Backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    resorts: (resorts ?? []) as BackupResort[],
    sites: (sites ?? []) as BackupSite[],
  };

  const format = new URL(request.url).searchParams.get("format") ?? "sites-csv";

  if (format === "json") {
    return fileResponse(
      JSON.stringify(backup, null, 2),
      "application/json",
      backupFileName("json")
    );
  }
  if (format === "resorts-csv") {
    return fileResponse(
      resortsToCsv(backup),
      "text/csv; charset=utf-8",
      backupFileName("resorts.csv")
    );
  }
  return fileResponse(
    sitesToCsv(backup),
    "text/csv; charset=utf-8",
    backupFileName("sites.csv")
  );
}

function fileResponse(body: string, contentType: string, fileName: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      // A backup must always be freshly read, never a cached copy from an
      // earlier download.
      "Cache-Control": "no-store",
    },
  });
}
