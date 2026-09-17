-- ---------------------------------------------------------------------
-- Directions from where the visitor actually is
--
-- `route_to_site` always starts the walk at the resort entrance, because
-- that is where a guest scanning a sign at the gate is standing. Once
-- they are moving - and at these resorts they are usually driving - the
-- entrance stops being where they are, and a line drawn from it is a
-- line they have already half travelled.
--
-- `route_from_point` is the same route computed from an arbitrary
-- position instead. The position is not a node on the graph and never
-- will be, so it is attached to the network the way a live position
-- always is: find the nearest road, work out where along it the visitor
-- is, and route from each end of that road, keeping whichever total is
-- shorter once the drive along the road itself is counted.
--
-- Both ends rather than the nearer one, deliberately. Halfway down a
-- cul-de-sac the nearer junction is often the wrong way, and choosing by
-- distance-to-junction instead of by total distance sends people back
-- out to the road they have just turned off.
--
-- What this hands back that `route_to_site` doesn't: where the position
-- snapped to, and how far that was. The page uses the second one to
-- decide whether to believe the fix at all.
-- ---------------------------------------------------------------------

-- How far from a road a position can be and still be treated as being on
-- it. Consumer GPS in a car is good to 5-15m under open sky and worse
-- under a carport or mature trees, so this has to be generous; past it
-- the honest answer is that we do not know which road they are on.
--
-- This also doubles as the visitor page's capability probe: it takes no
-- arguments and does no work, so asking whether it answers is a cheap
-- way to ask whether this migration has been applied at all. Keep it in
-- this migration, alongside route_from_point - see
-- lib/navigation/server-support.ts, which would quietly start lying if
-- the two were ever separated.
create or replace function public.live_snap_limit_m()
returns double precision
language sql
immutable
as $$ select 75.0 $$;

create or replace function public.route_from_point(
  p_site_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resort_id uuid;
  v_to bigint;
  v_point geometry;
  v_edge record;
  v_fraction double precision;
  v_snap geometry;
  v_snap_m double precision;
  -- The two candidate starting junctions: the near end of the road the
  -- visitor is on, and the far end. Each carries the stretch of that
  -- road between the visitor and the junction, already pointing in the
  -- direction of travel.
  v_back_seq bigint;
  v_back_m double precision;
  v_back_geom geometry;
  v_fwd_seq bigint;
  v_fwd_m double precision;
  v_fwd_geom geometry;
  v_best_start bigint;
  v_best_total double precision;
  v_lead_in geometry;
  v_lead_in_m double precision;
  v_line geometry;
  v_in_bounds boolean;
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return null;
  end if;

  -- The same checks route_to_site makes, for the same reason: this is
  -- SECURITY DEFINER, and anon has no rights of its own to the graph.
  select s.resort_id, n.node_seq
    into v_resort_id, v_to
    from public.sites s
    join public.graph_nodes n on n.id = s.graph_node_id
    join public.resorts r on r.id = s.resort_id
    where s.id = p_site_id
      and s.status = 'active'
      and r.is_published;

  if v_to is null then
    return null;
  end if;

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  -- The position has to actually be at the resort.
  --
  -- Without this, the function answers for any coordinate on earth, and
  -- the private road network can be read back out of it a point at a
  -- time by walking a grid and watching where the snap succeeds - which
  -- is the exact thing keeping the graph server-side is for. Inside the
  -- perimeter plus a couple of hundred metres takes in a visitor still
  -- out on the approach road, and nothing else.
  --
  -- Same outline the visitor map greys out against: what staff traced,
  -- or a hull round the homes where nobody has traced one yet.
  select ST_DWithin(
           coalesce(
             r.boundary,
             (
               select ST_Buffer(ST_ConvexHull(ST_Collect(p.g))::geography, 45)
                 from (
                   select s.location::geometry as g
                     from public.sites s
                    where s.resort_id = r.id and s.status = 'active'
                   union all
                   select n.geom::geometry
                     from public.graph_nodes n
                    where n.id = r.entrance_node_id
                 ) p
             )
           ),
           v_point::geography,
           250
         )
    into v_in_bounds
    from public.resorts r
    where r.id = v_resort_id;

  if v_in_bounds is not true then
    return null;
  end if;

  -- Nearest road, ignoring the short connectors that run off the road up
  -- to each house: a car on the street a few metres from someone's
  -- driveway must not be told it is on the driveway.
  select e.geom::geometry as g, e.from_node_id, e.to_node_id, e.is_bidirectional
    into v_edge
    from public.graph_edges e
    where e.resort_id = v_resort_id
      and not exists (
        select 1 from public.graph_nodes n
        where n.id in (e.from_node_id, e.to_node_id)
          and n.node_type = 'site'
      )
    order by e.geom <-> v_point::geography
    limit 1;

  if not found then
    return null;
  end if;

  -- Where along that road they are. Located in degree space, as
  -- connect_sites_to_network already does - on segments this short the
  -- fraction it gives is off by centimetres, and every distance that
  -- follows is measured as geography regardless, so nothing downstream
  -- inherits the approximation.
  v_fraction := ST_LineLocatePoint(v_edge.g, v_point);
  v_snap := ST_LineInterpolatePoint(v_edge.g, v_fraction);
  v_snap_m := ST_Distance(v_snap::geography, v_point::geography);

  -- Too far from any road to say which one they are on. The page falls
  -- back to the route from the entrance, which is at least true.
  if v_snap_m > public.live_snap_limit_m() then
    return null;
  end if;

  -- Back towards the start of the road - only open if it can be driven
  -- both ways.
  if v_edge.is_bidirectional then
    select n.node_seq,
           ST_Length(ST_LineSubstring(v_edge.g, 0, v_fraction)::geography),
           -- Reversed: travel runs from the visitor back to the
           -- junction, not from the junction towards them.
           ST_Reverse(ST_LineSubstring(v_edge.g, 0, v_fraction))
      into v_back_seq, v_back_m, v_back_geom
      from public.graph_nodes n
     where n.id = v_edge.from_node_id;
  end if;

  -- On towards the end of the road, which is always open.
  select n.node_seq,
         ST_Length(ST_LineSubstring(v_edge.g, v_fraction, 1)::geography),
         ST_LineSubstring(v_edge.g, v_fraction, 1)
    into v_fwd_seq, v_fwd_m, v_fwd_geom
    from public.graph_nodes n
   where n.id = v_edge.to_node_id;

  -- Whichever is shorter door to door, counting the drive to the
  -- junction as well as the route from it.
  with candidates (node_seq, lead_in_m) as (
    select v_back_seq, v_back_m where v_back_seq is not null
    union all
    select v_fwd_seq, v_fwd_m where v_fwd_seq is not null
  ),
  reached as (
    -- agg_cost climbs along the path, so its largest value for a given
    -- start is that start's total.
    select r.start_vid, max(r.agg_cost) as agg_cost
      from pgr_dijkstra(
             format(
               'select edge_seq as id, source_seq as source, target_seq as target,
                       length_m as cost,
                       case when is_bidirectional then length_m else -1 end as reverse_cost
                from public.graph_edges where resort_id = %L',
               v_resort_id
             ),
             (select array_agg(node_seq) from candidates),
             v_to,
             true
           ) r
     group by r.start_vid
  )
  select c.node_seq, c.lead_in_m + reached.agg_cost
    into v_best_start, v_best_total
    from candidates c
    join reached on reached.start_vid = c.node_seq
   order by c.lead_in_m + reached.agg_cost
   limit 1;

  -- Neither end of the road reaches the site. Shouldn't happen on a
  -- connected network, but a half-traced one is a real state.
  if v_best_start is null then
    return null;
  end if;

  if v_best_start = v_back_seq then
    v_lead_in := v_back_geom;
    v_lead_in_m := v_back_m;
  else
    v_lead_in := v_fwd_geom;
    v_lead_in_m := v_fwd_m;
  end if;

  -- The route proper, stitched exactly as route_to_site stitches it.
  with route as (
    select *
      from pgr_dijkstra(
             format(
               'select edge_seq as id, source_seq as source, target_seq as target,
                       length_m as cost,
                       case when is_bidirectional then length_m else -1 end as reverse_cost
                from public.graph_edges where resort_id = %L',
               v_resort_id
             ),
             v_best_start,
             v_to,
             true
           )
  ),
  steps as (
    select
      r.path_seq,
      case
        when e.source_seq = r.node then e.geom::geometry
        else ST_Reverse(e.geom::geometry)
      end as geom
      from route r
      join public.graph_edges e on e.edge_seq = r.edge
     where r.edge <> -1
  ),
  -- The drive to the junction goes in front, so one ST_MakeLine covers
  -- both it and the route from there. Dropped when it is a metre or
  -- less: ST_LineSubstring collapses to a point when its two ends
  -- coincide, and a point has no place in a line's vertex list.
  pieces as (
    select 0 as path_seq, v_lead_in as geom
     where v_lead_in_m > 1 and GeometryType(v_lead_in) = 'LINESTRING'
    union all
    select path_seq, geom from steps
  )
  select ST_RemoveRepeatedPoints(ST_MakeLine(geom order by path_seq))
    into v_line
    from pieces;

  if v_line is null or ST_IsEmpty(v_line) or ST_NPoints(v_line) < 2 then
    return null;
  end if;

  return json_build_object(
    'distance_m', round(v_best_total::numeric, 1),
    'geometry', ST_AsGeoJSON(v_line)::json,
    'snapped_lat', ST_Y(v_snap),
    'snapped_lng', ST_X(v_snap),
    'snap_distance_m', round(v_snap_m::numeric, 1)
  );
end;
$$;

comment on function public.route_from_point(uuid, double precision, double precision) is
  'The route to a site from a live position rather than from the entrance. Null when the position is not at this resort, or is too far from any road to place - see 0015.';

-- Anon deliberately included, as with route_to_site: this is what the
-- visitor page calls once a guest turns live directions on.
grant execute on function public.route_from_point(uuid, double precision, double precision) to anon, authenticated;
grant execute on function public.live_snap_limit_m() to anon, authenticated;
