import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Magic link lands here with a `code` query param that gets exchanged for
// a session cookie, then redirects into the admin area.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/admin/login?error=auth`);
}
