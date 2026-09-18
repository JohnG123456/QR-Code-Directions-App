import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// What this runs on, and - more to the point - what it doesn't.
//
// Its two jobs are refreshing a staff session cookie and turning an
// unauthenticated visitor away from /admin. Neither has anything to do
// with the pages a guest at a gate actually loads, and running it there
// is not free: every matched request is an invocation that calls
// supabase.auth.getUser() before the page itself does any work.
//
// The three paths excluded below are the whole public surface, and
// between them they are almost all the traffic this app will ever
// carry - one page load, one plan image and a route request per site
// looked up, times every guest. The plan image matters most: it is the
// only large response here, and a response that goes through session
// handling can end up carrying Set-Cookie, which stops Vercel's edge
// caching it at all. A half-megabyte drawing re-fetched per visitor
// instead of served from the edge is the difference between a trivial
// bill and a surprising one.
//
// Anything that needs a session still has one: /admin is matched, and
// the admin API routes are Route Handlers, which can refresh cookies
// themselves through lib/supabase/server.ts.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|r/|api/r/|api/route|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
