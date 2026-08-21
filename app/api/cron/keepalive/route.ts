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
// Runs unauthenticated as far as the app is concerned, so it must not
// return anything and must not write anything. Vercel sends
// `Authorization: Bearer $CRON_SECRET` when that env var is set; if it's
// set we require it, so the endpoint can't be hammered by anyone else.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
}
