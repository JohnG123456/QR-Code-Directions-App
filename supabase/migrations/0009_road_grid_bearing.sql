-- ---------------------------------------------------------------------
-- Which way the streets run
--
-- The visitor map is turned so the resort sits square on screen, and
-- "square" is decided by the streets: they are drawn at right angles to
-- each other, so lining them up squares up everything built along them.
-- Working it out from where the homes are gets close but not exact,
-- because their spread is pulled about by whatever isn't a home - a
-- clubhouse in one corner, a wetland in the middle, a stage still to be
-- built. At Piara Waters that was about four degrees out, which is
-- plainly visible on a rectangular estate.
--
-- This has to be a function rather than a view because the road network
-- is deliberately not readable by visitors - publishing a resort's
-- internal layout isn't the deal. SECURITY DEFINER lets it read the
-- roads and hand back a single number, which gives away nothing about
-- where they run.
--
-- The angle only means anything modulo 90: a grid runs two ways at right
-- angles, and each street runs both ways. Angles that wrap can't be
-- averaged by adding them up - 1 degree and 89 degrees average to 45,
-- which is exactly wrong - so each is taken four times round a circle,
-- averaged there as a vector, and turned back. The caller decides which
-- of the four resulting directions is "up".
-- ---------------------------------------------------------------------

create or replace function public.resort_road_grid_deg(p_resort_id uuid)
returns double precision
language sql
stable
security definer
set search_path = public
as $$
  with segment as (
    select (ST_DumpSegments(e.geom::geometry)).geom as g
      from public.graph_edges e
      join public.resorts r on r.id = e.resort_id
     where e.resort_id = p_resort_id
       and r.is_published
       -- Driveways up to houses radiate in every direction and would
       -- blur the grid they hang off.
       and not exists (
         select 1 from public.graph_nodes n
          where n.id in (e.from_node_id, e.to_node_id)
            and n.node_type = 'site'
       )
  ),
  run as (
    select ST_Length(g::geography) as metres,
           ST_Azimuth(ST_StartPoint(g), ST_EndPoint(g)) as azimuth
      from segment
     -- Below a few metres it's a bend in a curve, not a street.
     where ST_Length(g::geography) >= 5
  ),
  summed as (
    select sum(metres) as total,
           sum(metres * cos(4 * azimuth)) as x,
           sum(metres * sin(4 * azimuth)) as y
      from run
  )
  select degrees(atan2(y, x)) / 4
    from summed
   where total > 0
     -- Streets pointing every which way have no grid to speak of; a real
     -- estate never looks like that, but a half-traced one can.
     and sqrt(x * x + y * y) / total >= 0.05;
$$;

-- Visitors need this to draw their own map straight, and it reveals
-- nothing but an angle.
grant execute on function public.resort_road_grid_deg(uuid) to anon, authenticated;
