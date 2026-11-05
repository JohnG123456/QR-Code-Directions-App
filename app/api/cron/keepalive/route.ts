import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Touches the database once a day so the Supabase project never goes
// idle long enough to be paused.
//
// This system is used in bursts - a resort's sites get captured over a
// few sittings and then nothing happens for months - which is exactly the
// pattern that trips the free tier's inactivity pause. One trivial query
// a day is enough to avoid it. It's a convenience, not the safety net:
// that's the backup file (/admin/backup).
//
// It also deletes live-directions recordings older than 30 days
// (migration 0018), so test drives nobody remembered to clear out don't
// pile up. That is its only write, and it only ever removes rows.
//
// Runs unauthenticated as far as the app is concerned, so it must not
// return anything. Vercel sends
// `Authorization: Bearer $CRON_SECRET` when that env var is set; if it's
// set we require it, so the endpoint can't be hammered by anyone else.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long live-directions recordings are kept before being deleted. */
const DIAGNOSTICS_RETENTION_DAYS = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("resorts")
    .select("id", { count: "exact", head: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Never fails the keep-alive: a database without the recordings table
  // (before 0016) simply has nothing to clear.
  const cutoff = new Date(Date.now() - DIAGNOSTICS_RETENTION_DAYS * 86_400_000).toISOString();
  const { error: purgeError } = await supabase
    .from("route_diagnostics")
    .delete()
    .lt("created_at", cutoff);
  if (purgeError && purgeError.code !== "42P01" && purgeError.code !== "PGRST205") {
    console.error("[cron] couldn't clear old recordings:", purgeError.message);
  }
  return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
}
