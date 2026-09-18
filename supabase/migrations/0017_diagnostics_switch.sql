-- ---------------------------------------------------------------------
-- The diagnostics switch, where the people using it can reach it
--
-- 0016 put recording behind a build-time environment variable, which
-- means turning it on or off is a trip into Vercel and a redeploy. That
-- is the wrong shape for something meant to be switched on for one
-- afternoon's driving and straight back off again: the harder it is to
-- turn off, the longer it stays on.
--
-- So it moves to a column staff can toggle from the resort's own admin
-- page, per resort, taking effect on the next page a visitor loads.
--
-- The date in route_diagnostics_open_until() still applies underneath
-- and is unchanged. A switch that a person operates and a stop that
-- happens whether or not anyone remembers are answers to two different
-- problems, and this only replaces the first.
-- ---------------------------------------------------------------------

alter table public.resorts
  add column if not exists record_diagnostics boolean not null default false;

comment on column public.resorts.record_diagnostics is
  'Whether live directions record what the receiver saw, for threshold tuning. Staff-operated; route_diagnostics_open_until() overrides it - see 0017.';

-- What the visitor page asks, on the server, while it is being built.
--
-- One question, one boolean, and no way to read anything else: anon has
-- no rights to the resorts table and this hands back nothing but yes or
-- no for a resort that is published.
create or replace function public.route_diagnostics_enabled(p_resort_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select r.record_diagnostics
             and now() <= public.route_diagnostics_open_until()
        from public.resorts r
       where r.id = p_resort_id
         and r.is_published
    ),
    false
  )
$$;

grant execute on function public.route_diagnostics_enabled(uuid) to anon, authenticated;

-- And the same question again on the way in, so a page built while the
-- switch was on cannot keep writing after it has been turned off. The
-- client's copy of the answer is at most one page load old; this one is
-- current.
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
  -- Covers the date, the switch and the resort being published, all
  -- three, and is the only gate that matters: everything in front of it
  -- is a courtesy to save the request being made at all.
  if not public.route_diagnostics_enabled(p_resort_id) then
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
