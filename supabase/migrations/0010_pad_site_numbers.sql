-- ---------------------------------------------------------------------
-- Bring existing site numbers into line with how they're written
--
-- Site numbers are now stored the way they appear on the plan and the
-- signage - 001, not 1 - and everything written from here on is stored
-- that way. Resorts captured before that rule existed still hold theirs
-- unpadded, which leaves one system showing site 13 and another site
-- 013 for the same home, and lets the same home be created twice under
-- the two spellings.
--
-- This is a one-off tidy-up of what is already there.
--
-- Two things it deliberately does not do.
--
-- It doesn't touch anything that isn't a plain site number - four
-- digits, or something with punctuation in it. Those may mean something
-- nobody here knows about, and mangling them would be worse than
-- leaving them.
--
-- And it never merges two homes. If a resort somehow holds both 13 and
-- 013 they are separate rows with separate positions, and padding the
-- first onto the second would collide with the unique constraint and
-- destroy the distinction. Those are left exactly as they are and
-- reported, for someone to look at.
-- ---------------------------------------------------------------------

do $$
declare
  v_padded integer;
  v_skipped integer;
begin
  -- Worked out first and held, so the update and the count are looking
  -- at the same set. Counting the rows of a data-modifying CTE from
  -- another subquery in the same statement does not do what it looks
  -- like it does.
  create temporary table site_number_tidy on commit drop as
    select
      s.id,
      s.resort_id,
      s.site_number,
      lpad((parsed.m)[1], 3, '0') || upper(coalesce((parsed.m)[2], '')) as tidied
    from public.sites s
    cross join lateral (
      select regexp_match(s.site_number, '^(\d{1,3})([A-Za-z])?$') as m
    ) parsed
    where parsed.m is not null
      and s.site_number is distinct from
          lpad((parsed.m)[1], 3, '0') || upper(coalesce((parsed.m)[2], ''));

  -- A resort holding both 13 and 013 has two homes in two places.
  -- Padding the first onto the second would collide with the unique
  -- constraint and lose the distinction, so leave both alone.
  create temporary table site_number_collision on commit drop as
    select t.id
      from site_number_tidy t
     where exists (
       select 1
         from public.sites other
        where other.resort_id = t.resort_id
          and other.id <> t.id
          and other.site_number = t.tidied
     );

  select count(*) into v_skipped from site_number_collision;

  update public.sites s
     set site_number = t.tidied
    from site_number_tidy t
   where s.id = t.id
     and not exists (select 1 from site_number_collision c where c.id = t.id);

  get diagnostics v_padded = row_count;

  raise notice 'Padded % site number(s).', v_padded;
  if v_skipped > 0 then
    raise notice 'Left % alone: the resort already has a site under the padded number, so these are two different homes. Check them by hand.', v_skipped;
  end if;
end $$;
