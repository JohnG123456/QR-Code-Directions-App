-- ---------------------------------------------------------------------
-- Recording sessions that end by themselves, instead of a programme
-- that ends on a fixed date
--
-- 0016 stopped all recording after 31 December 2026, so that a switch
-- someone forgot about couldn't follow guests around a resort for ever.
-- That assumed tuning was a one-off. It is now a routine step for every
-- new resort and every new stage, so a fixed date meant a database
-- change before each one - and it still let a forgotten switch run for
-- weeks, right up to the date.
--
-- The safeguard is the same idea, made per session: every time staff
-- start recording, the resort gets an end time. The database refuses
-- rows after it, whatever the switch says, so forgetting costs an
-- afternoon rather than a month. The end time can never be set more
-- than 12 hours ahead - that is enforced here, not in the app, so it
-- holds whoever writes to the table.
--
-- Old recordings are cleared by the daily cron (/api/cron/keepalive)
-- after 30 days, so rows nobody remembered to delete don't pile up.
--
-- Safe to apply before or after deploying the matching app code: the
-- app works with or without the new column.
-- ---------------------------------------------------------------------

alter table public.resorts
  add column if not exists record_diagnostics_until timestamptz;

comment on column public.resorts.record_diagnostics_until is
  'When the current recording session ends. Rows are refused after it, whatever record_diagnostics says. Never more than 12 hours ahead - see 0018.';

-- The rules for the end time, applied to every write to resorts.
--
--   * Switching on without an end time gets the default of 4 hours.
--   * An end time more than 12 hours ahead is pulled back to 12 hours.
--   * Switching off clears the end time.
create or replace function public.resorts_diagnostics_session_guard()
returns trigger
language plpgsql
as $$
begin
  if not new.record_diagnostics then
    new.record_diagnostics_until := null;
    return new;
  end if;

  if new.record_diagnostics_until is null then
    new.record_diagnostics_until := now() + interval '4 hours';
  end if;

  if new.record_diagnostics_until > now() + interval '12 hours' then
    new.record_diagnostics_until := now() + interval '12 hours';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resorts_diagnostics_session on public.resorts;
create trigger trg_resorts_diagnostics_session
  before insert or update of record_diagnostics, record_diagnostics_until
  on public.resorts
  for each row execute function public.resorts_diagnostics_session_guard();

-- Anything switched on under the old rules gets an end time now, rather
-- than carrying on until the old fixed date.
update public.resorts
   set record_diagnostics_until = now() + interval '4 hours'
 where record_diagnostics and record_diagnostics_until is null;

-- The one gate every write passes through (record_route_diagnostics in
-- 0017 calls this). Now: switched on, inside the session's end time,
-- and the resort published. No fixed date any more.
create or replace function public.route_diagnostics_enabled(p_resort_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (
      select r.record_diagnostics
             and r.record_diagnostics_until is not null
             and now() <= r.record_diagnostics_until
        from public.resorts r
       where r.id = p_resort_id
         and r.is_published
    ),
    false
  )
$$;

grant execute on function public.route_diagnostics_enabled(uuid) to anon, authenticated;

-- The fixed date is gone. Nothing in the database uses this function
-- any more, and the app treats it being missing as "no fixed date".
drop function if exists public.route_diagnostics_open_until();

comment on table public.route_diagnostics is
  'Recording of what the receiver saw during live directions, for tuning the off-route thresholds. Each recording session ends by itself (resorts.record_diagnostics_until, max 12 hours); rows older than 30 days are deleted by the daily cron. See 0016-0018.';
