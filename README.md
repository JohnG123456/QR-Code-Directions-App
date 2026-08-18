# QR Code Directions App

A QR code per resort that lets a visitor look up their site number and get
directions from the entrance. Built for multiple resorts on a single
deployment (Next.js on Vercel, Postgres/PostGIS on Supabase).

## What's implemented (Phase 1)

- Staff admin area (magic-link sign-in, allow-listed by email) to create
  resorts, capture site GPS coordinates (walk-and-drop tool or CSV import),
  and download each resort's QR code (PNG/SVG).
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
4. Add your first staff user: sign up the account normally via Supabase
   Auth (or invite via the Supabase dashboard), then insert a matching row
   so the app treats them as staff:
   ```sql
   insert into staff_profiles (id, email, is_admin)
   values ('<auth-user-uuid>', 'you@example.com', true);
   ```
   There's no public self-signup — only emails with a `staff_profiles` row
   can use `/admin`.
5. `npm install`
6. `npm run dev` and open `http://localhost:3000/admin`.

## Project structure

- `app/(admin)/admin/login` — magic-link sign-in (unauthenticated).
- `app/(admin)/admin/(protected)/...` — resort CRUD, QR panel, site
  capture/import, all gated by the staff allow-list check in that
  segment's `layout.tsx`.
- `app/(public)/r/[slug]` — visitor landing page.
- `app/api/resorts/[resortId]/qr` — QR PNG/SVG download endpoint.
- `lib/supabase/` — browser/server/admin Supabase clients and the
  session-refresh helper used by `proxy.ts`.
- `lib/geo/distance.ts` — Haversine distance/bearing/walk-time helpers used
  by the Phase 1 straight-line visitor view.
- `supabase/migrations/0001_init.sql` — schema, RLS, and public views.
  `graph_nodes`/`graph_edges` are created here but unused until Phase 2.

## What's next

- **Phase 2:** an admin tool to digitize each resort's road network
  (click to place intersections, connect them into paths, snap each site
  to the network), and a `pgr_dijkstra`-backed routing endpoint that
  replaces the straight line with a real routed path + walk-time estimate.
- **Phase 3:** live-GPS origin (route from the visitor's current position,
  not just the entrance), PWA installability, offline queueing for the
  GPS capture tool, multi-entrance support.
