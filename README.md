# QR Code Directions App

A QR code per resort that lets a visitor look up their site number and get
directions from the entrance. Built for multiple resorts on a single
deployment (Next.js on Vercel, Postgres/PostGIS on Supabase).

## What's implemented (Phase 1)

- Staff admin area (email + password sign-in, allow-listed by email) to
  create resorts and download each resort's QR code (PNG/SVG).
- Four ways to capture site coordinates, so staff aren't stuck walking
  every resort in person: **master plan import** (upload a scaled site
  plan PDF, it extracts candidate site numbers, you calibrate it against
  the satellite map with a few reference points, and it bulk-computes
  every site's coordinates at once — the fastest way to seed a large,
  already-built resort), a **satellite click-to-place tool** (zoom into
  free aerial imagery and click each house one at a time), a **GPS
  walk-and-drop tool** (for on-site spot-checks), and **CSV import**. The
  satellite tool always shows the live set of already-captured sites as
  pins, so a partially-built resort can be revisited and continued over
  months without losing track of progress — optionally against a "total
  homes" target set per resort.
- Public visitor page (`/r/{resort-slug}`) with a site-number search and a
  map showing a straight-line distance/bearing from the resort's entrance
  point to the selected site. This is intentionally approximate — see
  "What's next" below.
- **Live directions** ("Follow me as I go"): once a site is picked, the
  visitor can have the route recomputed from where they actually are
  rather than from the entrance, with their position drawn on the map and
  the distance counting down as they drive. Opt-in, because it costs a
  location permission and holds a wake lock. See "Live directions" below
  for what it does and doesn't do.

Real turn-by-turn routing along each resort's internal roads (a self-owned
road-network graph + pgRouting, so private layouts never need to be
published to OpenStreetMap) is Phase 2, not built yet.

## Live directions

Off by default. A visitor who has picked their site gets a "Follow me as
I go" button; pressing it asks for location permission, draws where they
are on the map, and re-asks the server for the route from their current
position as they move.

Apply `supabase/migrations/0015_route_from_live_position.sql` before this
works. Without it the button hides itself — the API reports the missing
function as "no live route" rather than as an error, so a deployment that
hasn't been migrated still gives directions from the entrance.

**What it does not do, by design:**

- **It stops when the phone does.** `watchPosition` is suspended when the
  browser is backgrounded or the screen locks, on both iOS and Android,
  and the web has no background geolocation. The page takes a wake lock
  (Chrome on Android, Safari from iOS 16.4) to stop the screen sleeping
  on its own, but a visitor who switches apps stops being followed.
  Navigation with the screen off would need a native app.
- **It doesn't claim more than GPS knows.** A fix worse than 100 m —
  which on Android is what Chrome returns when Location is set to
  battery-saving or GPS is off — is shown as a dot with its accuracy
  circle but is never routed from, because the roads here are about six
  metres wide and twenty-five metres apart and a fix that vague would
  place someone confidently on the wrong street. Between 25 m and 100 m
  the page says accuracy is poor and carries on.
- **It doesn't give turn-by-turn instructions.** No street names, no
  "turn left", no voice. See "What's next".
- **It doesn't snap the dot to the road.** The route is computed from the
  nearest road, but the dot is drawn at the raw fix. Snapping it would
  look tidier and would sometimes be a lie.

### Testing it without going to a resort

Set `NEXT_PUBLIC_POSITION_SIM=1` on Vercel's **Preview** environment
(Project → Settings → Environment Variables, ticking Preview only) and
redeploy. The visitor page then carries a "Simulated position" panel: it
walks a pretend visitor along the route from the entrance and feeds the
result in as if it came from the receiver, so every threshold, the
recompute decisions and the server call all run exactly as they do for a
real fix.

Never set it on Production. It is fixed at build time — it cannot be
turned on from a URL or a request header — so a production build simply
has no panel to show, but a build that carries the variable shows it to
anyone who opens that deployment.

What the controls are for:

- **Drive / Back to start, and the slider** — move along the route.
  Fixes arrive once a second whether or not the car is moving, as a real
  receiver's do.
- **Accuracy m** — over 100 is the coarse gate (the dot shows, nothing
  routes, and the "rough position" notice appears — this is the Android
  battery-saving case); 25–100 gives the "accuracy is poor" note; under
  25 is a clean fix.
- **Sideways m** — shifts the visitor off the line. Past 30 m for three
  consecutive ticks triggers a reroute.
- Stop the car and the heading arrow disappears, because course over
  ground is only trusted above 1.5 m/s.

What it cannot tell you: whether the real thresholds suit your roads.
That still needs a phone at Helena Valley — the simulator produces
clean, well-behaved fixes, and the whole reason those thresholds exist is
that real ones under carports and mature trees are neither.

**Worth knowing before it goes in front of guests:** this is a screen
used in a moving car, on resort roads that residents walk on. The page
asks visitors to start it before setting off and not to read it at the
wheel, but that is a label, not a control. Worth a conversation with the
resort operators before it is switched on.

An in-app browser — a QR code scanned from inside Facebook, Instagram or
similar — may never pass the location prompt through. The page reports
that as a refused permission and suggests opening it in Chrome or Safari.

## Setup

1. Create a Supabase project.
2. In the SQL editor, run the migration in `supabase/migrations/0001_init.sql`.
   It enables `postgis`/`pgrouting` and creates the schema, RLS policies,
   and the `public_resorts`/`public_sites` views the visitor pages read
   from.
3. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project
     Settings → API.
   - `SUPABASE_SERVICE_ROLE_KEY` — same page. Server-only, never expose to
     the client.
   - `NEXT_PUBLIC_SITE_URL` — the address QR codes point at. Production
     deliberately doesn't set it: the deployment serves
     `directions.providencelifestyle.com.au`, and with the variable unset
     the app reads Vercel's production domain at runtime, so a printed
     code can't be left pointing at an address the site no longer
     answers on. Set it locally only to aim a code somewhere other than
     `http://localhost:3000`.
4. Add your first staff user directly in the Supabase dashboard —
   **Authentication → Users → Add user**, set an email and password, and
   tick "Auto Confirm User" (no email needs to be sent). Then insert a
   matching row so the app treats them as staff:
   ```sql
   insert into staff_profiles (id, email, is_admin)
   values ('<auth-user-uuid>', 'you@example.com', true);
   ```
   There's no public self-signup and no password-reset email flow yet —
   only emails with a `staff_profiles` row can use `/admin`, and if
   someone forgets their password, reset it for them from the same Users
   page in the dashboard.
5. `npm install`
6. `npm run dev` and open `http://localhost:3000/admin`.

## Project structure

- `app/(admin)/admin/login` — email + password sign-in (unauthenticated).
- `app/(admin)/admin/(protected)/...` — resort CRUD, QR panel, site
  capture/import, all gated by the staff allow-list check in that
  segment's `layout.tsx`. `resorts/[resortId]/import-masterplan` is the
  PDF master plan importer; `capture-map` is the satellite click-to-place
  tool; `capture-sites` is the GPS tool; `import-sites` is CSV import.
- `app/(public)/r/[slug]` — visitor landing page.
- `app/api/resorts/[resortId]/qr` — QR PNG/SVG download endpoint.
- `lib/supabase/` — browser/server/admin Supabase clients and the
  session-refresh helper used by `proxy.ts`.
- `lib/geo/distance.ts` — Haversine distance/bearing/walk-time helpers used
  by the Phase 1 straight-line visitor view.
- `lib/navigation/` — live directions. `live-route.ts` holds the pure
  judgement calls (when a fix is too vague to trust, how far off the line
  counts as off it, when to ask the server for a new route) with the
  reasoning for each threshold; `use-live-position.ts` wraps
  `watchPosition`; `use-live-directions.ts` drives the loop;
  `use-wake-lock.ts` keeps the screen on.
- `lib/geo/local-projection.ts` / `lib/geo/similarity-transform.ts` — the
  math behind master plan calibration: project lat/lng to local metres
  around a reference point, then fit a least-squares scale/rotation/
  translation from a handful of staff-picked reference point pairs.
- `lib/masterplan/extract-labels-server.ts` — server-side PDF parsing
  (`pdfjs-dist` + `@napi-rs/canvas`, called from
  `app/api/resorts/[resortId]/masterplan/extract`): renders page 1 to an
  image and pulls out candidate site number text labels with their pixel
  position, for the master plan import tool to calibrate and place. Runs
  server-side rather than in the browser because PDF rendering had real
  compatibility gaps across mobile browsers; `@napi-rs/canvas` is listed
  in `next.config.ts`'s `serverExternalPackages` since bundling a native
  addon breaks its own runtime binary resolution.
- `supabase/migrations/0001_init.sql` — schema, RLS, and public views.
  `graph_nodes`/`graph_edges` are created here but unused until Phase 2.
- `supabase/migrations/0015_route_from_live_position.sql` — `route_from_point`,
  the routing function behind live directions. Attaches an arbitrary
  position to the nearest road and routes from whichever end of it is
  shorter door-to-door, and refuses any position that isn't at this
  resort.

## What's next

- **Phase 2:** an admin tool to digitize each resort's road network
  (click to place intersections, connect them into paths, snap each site
  to the network), and a `pgr_dijkstra`-backed routing endpoint that
  replaces the straight line with a real routed path + walk-time estimate.
- **Phase 3:** PWA installability, offline queueing for the GPS capture
  tool, multi-entrance support.
- **Turn-by-turn:** spoken and written manoeuvres ("turn left into Karri
  Loop in 80 m"). Needs street names on `graph_edges`, which nothing
  captures yet — the master plans carry them, so it is per-resort data
  entry — plus a manoeuvre generator over the existing edge geometry and
  the Web Speech API. Deliberately not built until live directions have
  been watched in use: these drives are 200–600 m, and the moving dot may
  well be enough on its own.
