-- ---------------------------------------------------------------------
-- Master plan import drafts
--
-- Reviewing a few hundred site numbers off a master plan is hours of
-- work that realistically happens across several sittings, on whatever
-- device is to hand. The tool already keeps a draft in the browser's
-- IndexedDB, but that is per-browser and quietly disappears: private
-- browsing, "clear site data", a different phone, or a wiped laptop all
-- lose it. This table is the durable copy - one in-progress draft per
-- resort, readable from any signed-in staff device.
--
-- The rendered plan image is stored as a data URL (a couple of MB of
-- base64). That is chunky for a row, but it is written exactly once per
-- uploaded PDF - by the extract API route, which already has the render
-- in hand - while the labels and reference points that actually change
-- while working are small JSON. Postgres TOASTs the image out of line,
-- so it costs nothing to read the row without selecting that column.
-- ---------------------------------------------------------------------

create table if not exists public.masterplan_drafts (
  -- One draft per resort: a new upload replaces the previous one.
  resort_id uuid primary key references public.resorts(id) on delete cascade,
  file_name text,
  step text not null default 'review',
  image_data_url text,
  image_width integer,
  image_height integer,
  -- [{ id, text, x, y }] in plan-image pixel coordinates.
  labels jsonb not null default '[]'::jsonb,
  -- [{ plan: {x,y}, world: {x,y} }] calibration reference points.
  pairs jsonb not null default '[]'::jsonb,
  -- Set when these numbers were last pushed into `sites`. A draft
  -- deliberately outlives its import: the first pass is usually partial.
  last_imported_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger trg_masterplan_drafts_updated_at before update on public.masterplan_drafts
  for each row execute function public.set_updated_at();

alter table public.masterplan_drafts enable row level security;

-- Same model as the rest of the admin tables: any staff member can work
-- on any resort. Nothing here is ever exposed to anon.
create policy "staff full access to masterplan_drafts" on public.masterplan_drafts
  for all
  using (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()))
  with check (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()));
