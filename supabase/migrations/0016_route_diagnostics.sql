-- ---------------------------------------------------------------------
-- What the phone actually saw, so the thresholds can be argued from
-- evidence rather than from guesses
--
-- The numbers live directions turn on - twenty metres off the line,
-- three fixes in a row, seventy-five metres to the nearest road - were
-- picked from what consumer GPS does in general, not from what it does
-- at Piara Waters under a carport on a February afternoon. This records
-- the second thing, so the next adjustment is made against real figures.
--
-- It is written to be short-lived on purpose. Location traces are
-- sensitive even when they are only staff, and a diagnostic left running
-- quietly follows real guests around a resort for as long as nobody
-- remembers to turn it off. Three things stop that:
--
--   1. The page only records when NEXT_PUBLIC_ROUTE_DIAGNOSTICS is set.
--   2. This function refuses to write anything after the date below,
--      whatever the page does.
--   3. Nothing identifying a person is stored - see the columns.
--
-- The second one is the important one, because it is the only one that
-- still works when everybody has forgotten this exists.
-- ---------------------------------------------------------------------

create table if not exists public.route_diagnostics (
  id bigserial primary key,
  -- Random, generated per trip in the browser, and never joined to
  -- anything. It exists so one drive's fixes can be read in order, and
  -- for no other reason: it identifies a journey, not a person. No user
  -- id, no device id, no IP, no user agent.
  session_id uuid not null,
  resort_id uuid references public.resorts(id) on delete cascade,
  site_id uuid,
  recorded_at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  speed_ms double precision,
  heading_deg double precision,
  /** How far the fix fell from the route on screen. The number the
   *  whole off-route decision turns on. */
  offset_m double precision,
  remaining_m double precision,
  off_route_fixes integer,
  /** fix | reroute | unplaced | arrived */
  event text not null,
  -- The threshold in force when the row was written. Without it, data
  -- gathered before a tuning change becomes uninterpretable the moment
  -- the constant moves - which is precisely when it is most wanted.
  off_route_m double precision,
  created_at timestamptz not null default now()
);

create index if not exists route_diagnostics_session_idx
  on public.route_diagnostics (session_id, recorded_at);
create index if not exists route_diagnostics_created_idx
  on public.route_diagnostics (created_at);

alter table public.route_diagnostics enable row level security;

-- Staff read it. Nobody else reads it at all: anon can add to this table
-- through the function below and can never see what anyone else added.
create policy "staff full access to route_diagnostics" on public.route_diagnostics
  for all
  using (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()))
  with check (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()));

-- The date after which this stops collecting, no matter what any
-- deployment is configured to do.
--
-- Change it deliberately, by migration, if a later round of tuning needs
-- more. It must never be made open-ended: the point of it is to be the
-- safeguard that works when the env var has been forgotten.
create or replace function public.route_diagnostics_open_until()
returns timestamptz
language sql
immutable
as $$ select timestamptz '2026-12-31 23:59:59+08' $$;

-- Writes a batch of fixes. A batch, not a fix at a time: the page
-- buffers and flushes every so often, so one drive is a handful of
-- requests rather than one a second.
create or replace function public.record_route_diagnostics(
  p_session_id uuid,
  p_resort_id uuid,
  p_site_id uuid,
  p_off_route_m double precision,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_written integer;
begin
  if now() > public.route_diagnostics_open_until() then
    return 0;
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return 0;
  end if;

  -- A cap, because this is reachable by anyone who can open the visitor
  -- page. A drive produces tens of rows; a request offering hundreds is
  -- not a drive.
  if jsonb_array_length(p_rows) > 200 then
    return 0;
  end if;

  -- Only for a resort that exists and is published, which is the same
  -- bar the routing functions hold to.
  if not exists (
    select 1 from public.resorts r
    where r.id = p_resort_id and r.is_published
  ) then
    return 0;
  end if;

  insert into public.route_diagnostics (
    session_id, resort_id, site_id, recorded_at, lat, lng, accuracy_m,
    speed_ms, heading_deg, offset_m, remaining_m, off_route_fixes,
    event, off_route_m
  )
  select
    p_session_id,
    p_resort_id,
    p_site_id,
    coalesce((e->>'t')::timestamptz, now()),
    (e->>'lat')::double precision,
    (e->>'lng')::double precision,
    (e->>'acc')::double precision,
    (e->>'spd')::double precision,
    (e->>'hdg')::double precision,
    (e->>'off')::double precision,
    (e->>'rem')::double precision,
    (e->>'fixes')::integer,
    coalesce(e->>'ev', 'fix'),
    p_off_route_m
  from jsonb_array_elements(p_rows) as e
  where (e->>'lat') is not null and (e->>'lng') is not null;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

grant execute on function public.record_route_diagnostics(uuid, uuid, uuid, double precision, jsonb)
  to anon, authenticated;
grant execute on function public.route_diagnostics_open_until() to anon, authenticated;

comment on table public.route_diagnostics is
  'Short-lived recording of what the receiver saw during live directions, for tuning the off-route thresholds. Stops by itself - see route_diagnostics_open_until() and 0016.';
