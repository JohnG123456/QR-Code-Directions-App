-- QR Code Directions App - initial schema (Phase 1 + Phase 2 tables)
--
-- Phase 1 (site CRUD, GPS capture, straight-line visitor directions) uses
-- staff_profiles, resorts, sites, public_resorts, public_sites.
--
-- graph_nodes / graph_edges are created now so the schema doesn't need a
-- breaking migration later, but stay empty/unused until the Phase 2 road
-- digitizer and pgRouting-based routing are built.

create extension if not exists postgis;
create extension if not exists pgrouting;

-- ---------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------

create table public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Resorts
-- ---------------------------------------------------------------------

create table public.resorts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  is_published boolean not null default false,
  -- Reference point used for Phase 1 straight-line distance/bearing, and
  -- as the default map center. Superseded (but not replaced) by
  -- entrance_node_id once the Phase 2 road graph exists.
  center geography(Point, 4326),
  center_lat double precision generated always as (ST_Y(center::geometry)) stored,
  center_lng double precision generated always as (ST_X(center::geometry)) stored,
  default_zoom smallint not null default 19,
  -- Optional target used purely for progress display in the satellite
  -- capture tool ("142 of 352 homes captured"). Left null for resorts
  -- where staff don't know/want to track a total.
  total_homes smallint,
  entrance_node_id uuid,
  created_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Road network graph (Phase 2 - created now, unused until the digitizer
-- and pgRouting-based routing endpoint are built)
-- ---------------------------------------------------------------------

create table public.graph_nodes (
  id uuid primary key default gen_random_uuid(),
  node_seq bigserial unique,
  resort_id uuid not null references public.resorts(id) on delete cascade,
  geom geography(Point, 4326) not null,
  lat double precision generated always as (ST_Y(geom::geometry)) stored,
  lng double precision generated always as (ST_X(geom::geometry)) stored,
  node_type text not null default 'intersection'
    check (node_type in ('intersection', 'entrance', 'site', 'poi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.resorts
  add constraint resorts_entrance_fk
  foreign key (entrance_node_id) references public.graph_nodes(id) on delete set null;

create table public.graph_edges (
  id uuid primary key default gen_random_uuid(),
  edge_seq bigserial unique,
  resort_id uuid not null references public.resorts(id) on delete cascade,
  from_node_id uuid not null references public.graph_nodes(id) on delete cascade,
  to_node_id uuid not null references public.graph_nodes(id) on delete cascade,
  source_seq bigint,
  target_seq bigint,
  geom geography(LineString, 4326) not null,
  length_m double precision generated always as (ST_Length(geom)) stored,
  is_bidirectional boolean not null default true,
  path_type text not null default 'road' check (path_type in ('road', 'path', 'stairs')),
  created_at timestamptz not null default now(),
  check (from_node_id <> to_node_id)
);

create or replace function public.sync_edge_node_seq()
returns trigger
language plpgsql
as $$
begin
  select node_seq into new.source_seq from public.graph_nodes where id = new.from_node_id;
  select node_seq into new.target_seq from public.graph_nodes where id = new.to_node_id;
  return new;
end;
$$;

create trigger trg_sync_edge_node_seq
  before insert or update of from_node_id, to_node_id on public.graph_edges
  for each row execute function public.sync_edge_node_seq();

create index graph_nodes_resort_idx on public.graph_nodes(resort_id);
create index graph_edges_resort_idx on public.graph_edges(resort_id);
create index graph_nodes_geom_gix on public.graph_nodes using gist (geom);
create index graph_edges_geom_gix on public.graph_edges using gist (geom);

-- ---------------------------------------------------------------------
-- Sites
-- ---------------------------------------------------------------------

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  resort_id uuid not null references public.resorts(id) on delete cascade,
  site_number text not null,
  label text,
  location geography(Point, 4326),
  lat double precision generated always as (ST_Y(location::geometry)) stored,
  lng double precision generated always as (ST_X(location::geometry)) stored,
  graph_node_id uuid references public.graph_nodes(id) on delete set null,
  gps_accuracy_m numeric,
  status text not null default 'draft' check (status in ('active', 'inactive', 'draft')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resort_id, site_number)
);

create index sites_resort_idx on public.sites(resort_id);

-- Stub for future per-resort staff permissions. Unused by RLS in v1
-- (see policies below) - every staff row currently has access to every
-- resort. Kept so scoping can be switched on later without a migration.
create table public.staff_resort_access (
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  resort_id uuid not null references public.resorts(id) on delete cascade,
  role text not null default 'editor',
  primary key (staff_id, resort_id)
);

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_resorts_updated_at before update on public.resorts
  for each row execute function public.set_updated_at();
create trigger trg_sites_updated_at before update on public.sites
  for each row execute function public.set_updated_at();
create trigger trg_graph_nodes_updated_at before update on public.graph_nodes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
--
-- This is an internal tool for one operator's own resorts, not a
-- multi-customer product: any authenticated staff member can manage any
-- resort. Public (anon) visitors get read-only access only through the
-- narrow views below, never the base tables.
-- ---------------------------------------------------------------------

alter table public.staff_profiles enable row level security;
alter table public.resorts enable row level security;
alter table public.sites enable row level security;
alter table public.graph_nodes enable row level security;
alter table public.graph_edges enable row level security;
alter table public.staff_resort_access enable row level security;

create policy "staff can read own profile" on public.staff_profiles
  for select using (auth.uid() = id);

create policy "staff full access to resorts" on public.resorts
  for all
  using (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()))
  with check (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()));

create policy "staff full access to sites" on public.sites
  for all
  using (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()))
  with check (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()));

create policy "staff full access to graph_nodes" on public.graph_nodes
  for all
  using (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()))
  with check (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()));

create policy "staff full access to graph_edges" on public.graph_edges
  for all
  using (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()))
  with check (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()));

create policy "staff full access to staff_resort_access" on public.staff_resort_access
  for all
  using (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()))
  with check (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()));

-- No RLS policy grants anon/authenticated-non-staff access to the base
-- tables above, and anon/authenticated are never GRANTed select on them
-- either. Visitor-facing reads only go through these views instead.
--
-- Deliberately NOT using `security_invoker = true` here: these views run
-- with their owner's (a privileged role's) privileges against the base
-- tables, so anon can be granted select on the view alone - exposing only
-- the listed columns and only the rows matching the view's WHERE clause -
-- without ever needing a grant (or an RLS policy) on the base tables
-- themselves.

create view public.public_resorts as
  select
    id,
    name,
    slug,
    default_zoom,
    center_lat as entrance_lat,
    center_lng as entrance_lng,
    (entrance_node_id is not null) as is_routable
  from public.resorts
  where is_published;

create view public.public_sites as
  select
    id,
    resort_id,
    site_number,
    label,
    lat,
    lng
  from public.sites
  where status = 'active';

grant select on public.public_resorts, public.public_sites to anon, authenticated;
