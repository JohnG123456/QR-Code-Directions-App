-- ---------------------------------------------------------------------
-- Remembering which numbers on the plan are not sites
--
-- A master plan sheet carries numbers that aren't homes, and a scan
-- can't always tell. Staff delete those from the map, which is right -
-- but the deletion was the only record that the decision was ever made,
-- and deleting a row leaves nothing behind. So the next import of the
-- same plan puts every one of them straight back, and the review has to
-- happen again from scratch.
--
-- That is a nasty shape of trap: the damage is invisible at the moment
-- it's done, it undoes hours of work rather than minutes, and the
-- action that causes it - re-importing after a plan revision - is a
-- perfectly reasonable thing to want to do.
--
-- So a deletion now leaves a note. An import consults it and leaves
-- those numbers out, and says how many it skipped. Adding the number
-- back by hand clears the note, because that is someone saying they
-- were wrong the first time.
--
-- Deliberately not a "soft delete" on sites itself: a deleted site is
-- gone, and its position and label with it. What's kept is only the
-- decision - this number is not a site here - which is the part worth
-- carrying forward to the next revision of the plan.
-- ---------------------------------------------------------------------

create table if not exists public.removed_site_numbers (
  resort_id uuid not null references public.resorts(id) on delete cascade,
  site_number text not null,
  removed_at timestamptz not null default now(),
  removed_by uuid references auth.users(id) on delete set null,
  primary key (resort_id, site_number)
);

alter table public.removed_site_numbers enable row level security;

-- Same model as the rest of the admin tables. Never exposed to anon:
-- this is a note about the resort's setup, not about the resort.
create policy "staff full access to removed_site_numbers" on public.removed_site_numbers
  for all
  using (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()))
  with check (exists (select 1 from public.staff_profiles sp where sp.id = auth.uid()));
