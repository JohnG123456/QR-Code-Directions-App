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

Real turn-by-turn routing along each resort's internal roads (a self-owned
road-network graph + pgRouting, so private layouts never need to be
published to OpenStreetMap) is Phase 2, not built yet.

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
   - `NEXT_PUBLIC_SITE_URL` — the domain QR codes will point to. Fine to
     leave as `http://localhost:3000` for local development; update it
     before printing any signage.
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

## The monthly Supabase "table publicly accessible" email

Supabase's security advisor emails roughly monthly with a critical
`rls_disabled_in_public` finding on this project. **Expect it, and ignore
it.** The only table it can be reporting is `spatial_ref_sys`, the
coordinate-system lookup table PostGIS installs into the `public` schema.
It is the same ~8,500 published rows in every PostGIS database in the
world, it holds nothing about any resort, and PostGIS grants the public
`select` on it and nothing else.

Every table this app owns has row-level security switched on and no policy
granting anon access — see `0001_init.sql` and the migrations after it.
Visitors read through the `public_*` views alone.

`0012_spatial_ref_sys_rls.sql` tries to turn RLS on for `spatial_ref_sys`
anyway, so that a real finding never arrives looking like this one. On this
project it can't: the extension belongs to `supabase_admin`, so the
`ALTER TABLE` fails with `42501 must be owner of table`. There is no way
around that short of dropping every location column in the database, which
is not a trade worth making. Read the comment at the top of that migration
before spending time on this again.

To confirm the finding is still only that table, open Supabase → Advisors →
Security and check which table each row names. Anything other than
`spatial_ref_sys` is real and needs fixing.

## What's next

- **Phase 2:** an admin tool to digitize each resort's road network
  (click to place intersections, connect them into paths, snap each site
  to the network), and a `pgr_dijkstra`-backed routing endpoint that
  replaces the straight line with a real routed path + walk-time estimate.
- **Phase 3:** live-GPS origin (route from the visitor's current position,
  not just the entrance), PWA installability, offline queueing for the
  GPS capture tool, multi-entrance support.
