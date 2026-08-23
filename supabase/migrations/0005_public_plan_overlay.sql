-- ---------------------------------------------------------------------
-- The master plan, as visitors see it
--
-- Satellite imagery alone is a poor way to find a site. Roofs all look
-- alike from above, half-built stages are bare sand, and nothing on the
-- picture carries a site number - so a guest at the gate gets a line
-- drawn across a photograph and has to guess which roof is theirs. The
-- master plan sheet is the drawing that actually names the sites, and
-- the import tool has already worked out exactly where it sits in the
-- world. This table is what lets that drawing be shown to visitors.
--
-- It is a snapshot, deliberately - not a read of masterplan_drafts.
-- That table is a live working copy: staff re-upload a revised sheet and
-- spend hours re-calibrating it, and none of those half-finished states
-- belong on a page a guest is standing at a gate reading. Publishing is
-- an explicit act, and until it happens again the visitor keeps seeing
-- the last plan that was deliberately published.
--
-- The corners are stored rather than the calibration points, so nothing
-- public has to re-derive a transform: three corners are exactly what an
-- affine image placement needs, and the fourth is implied.
-- ---------------------------------------------------------------------

create table if not exists public.resort_plan_overlays (
  -- One published overlay per resort; publishing again replaces it.
  resort_id uuid primary key references public.resorts(id) on delete cascade,
  -- Downscaled and re-encoded for a phone on mobile data at the gate,
  -- not the full-resolution sheet the digitizer traces over.
  image_data_url text not null,
  content_type text not null default 'image/webp',
  image_width integer not null,
  image_height integer not null,
  -- Where the sheet's own corners fall in the world. A plan is almost
  -- never north-up, so these three points carry the rotation too.
  top_left_lat double precision not null,
  top_left_lng double precision not null,
  top_right_lat double precision not null,
  top_right_lng double precision not null,
  bottom_left_lat double precision not null,
  bottom_left_lng double precision not null,
  source_file_name text,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users(id) on delete set null
);

alter table public.resort_plan_overlays enable row level security;

-- Same model as the rest of the admin tables: any staff member can
-- publish for any resort. Visitors never touch the base table.
create policy "staff full access to resort_plan_overlays" on public.resort_plan_overlays
  for all
  using (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()))
  with check (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()));

-- Same doctrine as public_resorts/public_sites in 0001: no
-- `security_invoker`, so the view runs with its owner's privileges and
-- anon needs no grant on the base table.
--
-- The join to resorts is what makes unpublishing a resort also pull its
-- plan: an overlay is only ever visible while the resort it belongs to
-- is published.
create view public.public_plan_overlays as
  select
    o.resort_id,
    o.image_data_url,
    o.content_type,
    o.image_width,
    o.image_height,
    o.top_left_lat,
    o.top_left_lng,
    o.top_right_lat,
    o.top_right_lng,
    o.bottom_left_lat,
    o.bottom_left_lng,
    o.published_at
  from public.resort_plan_overlays o
  join public.resorts r on r.id = o.resort_id
  where r.is_published;

grant select on public.public_plan_overlays to anon, authenticated;
