-- ---------------------------------------------------------------------
-- Quieting a false alarm about spatial_ref_sys
--
-- Supabase's security advisor emails about any table in the public
-- schema with row-level security switched off, and PostGIS installs its
-- own spatial_ref_sys table there. That table holds ~8,500 rows naming
-- the world's coordinate systems - the same rows in every PostGIS
-- database anywhere. It holds nothing about the resorts, and PostGIS
-- grants the public select on it and nothing else, so the warning's
-- "read, edit, and delete" is boilerplate rather than a description of
-- this table.
--
-- It is still worth turning RLS on: an advisor that cries wolf every
-- month is an advisor nobody reads, and a real finding would then arrive
-- looking exactly like this one.
--
-- The read policy is not optional. ST_Transform and friends look
-- coordinate systems up in this table, so RLS without a policy would
-- break every map on the site. Verified locally as a plain unprivileged
-- role: 8,500 rows still readable, ST_Distance and ST_Transform both
-- still correct.
--
-- Wrapped in an exception handler because on some Supabase projects the
-- extension belongs to supabase_admin rather than to the project, and
-- ALTER TABLE then fails on ownership. That is a false alarm we cannot
-- silence, not a reason to fail the migration and stop the ones after
-- it - so it's reported and stepped over.
-- ---------------------------------------------------------------------

do $$
begin
  alter table public.spatial_ref_sys enable row level security;

  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.spatial_ref_sys'::regclass
      and polname = 'coordinate systems are public reference data'
  ) then
    create policy "coordinate systems are public reference data"
      on public.spatial_ref_sys for select using (true);
  end if;
exception
  when insufficient_privilege then
    raise notice
      'spatial_ref_sys is not owned by this role, so RLS cannot be enabled '
      'on it here. Nothing is exposed - dismiss the advisor warning instead.';
end
$$;
