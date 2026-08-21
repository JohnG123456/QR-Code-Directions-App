-- ---------------------------------------------------------------------
-- Routing: connect sites to the road network, and find a way there
--
-- Two halves. connect_sites_to_network() is a build-time operation run
-- from the admin after tracing roads: every site gets a permanent node on
-- the network and a short connector to it, so the graph pgRouting queries
-- against is a clean, precomputed topology rather than something snapped
-- together per request. route_to_site() is the read side, and is the only
-- thing a visitor's browser can reach - it hands back one route, never
-- the network it was computed from.
-- ---------------------------------------------------------------------

-- Attaches each site to the nearest road: finds the closest point along
-- it, splits the road there so the junction really exists, and runs a
-- short connector up to the site itself. Returns how many were connected.
--
-- Splitting rather than snapping at request time matters: pgr_dijkstra
-- walks node-to-node, so a site that isn't a node in the graph simply
-- can't be routed to.
create or replace function public.connect_sites_to_network(
  p_resort_id uuid,
  p_reconnect boolean default false
)
returns integer
language plpgsql
as $$
declare
  v_site record;
  v_edge record;
  v_fraction double precision;
  v_snap geometry;
  v_road_node uuid;
  v_site_node uuid;
  v_connected integer := 0;
begin
  -- Positions move (a pin gets dragged, a plan gets re-imported), and a
  -- connector left pointing at where a house used to be is worse than no
  -- connector at all. Reconnecting throws the site nodes away - and with
  -- them, by cascade, their connectors - and starts over. The splits
  -- those connectors created stay behind as ordinary junctions, which is
  -- harmless.
  if p_reconnect then
    update public.sites set graph_node_id = null where resort_id = p_resort_id;
    delete from public.graph_nodes
      where resort_id = p_resort_id and node_type = 'site';
  end if;

  for v_site in
    select id, location::geometry as geom, location as geog
    from public.sites
    where resort_id = p_resort_id
      and graph_node_id is null
      and location is not null
    order by site_number
  loop
    -- Nearest road, ignoring other sites' driveways: without that, sites
    -- chain off each other and the route wanders through a neighbour's
    -- back garden to get next door.
    select e.id, e.geom::geometry as g, e.from_node_id, e.to_node_id,
           e.path_type, e.is_bidirectional
      into v_edge
      from public.graph_edges e
      where e.resort_id = p_resort_id
        and not exists (
          select 1 from public.graph_nodes n
          where n.id in (e.from_node_id, e.to_node_id)
            and n.node_type = 'site'
        )
      order by e.geom <-> v_site.geog
      limit 1;

    -- No roads traced yet: nothing to attach anything to.
    exit when not found;

    v_fraction := ST_LineLocatePoint(v_edge.g, v_site.geom);
    v_snap := ST_LineInterpolatePoint(v_edge.g, v_fraction);

    if ST_Distance(v_snap::geography, ST_StartPoint(v_edge.g)::geography) < 1 then
      -- Already at one end of the road; use that junction as it stands.
      v_road_node := v_edge.from_node_id;
    elsif ST_Distance(v_snap::geography, ST_EndPoint(v_edge.g)::geography) < 1 then
      v_road_node := v_edge.to_node_id;
    else
      insert into public.graph_nodes (resort_id, geom, node_type)
        values (p_resort_id, v_snap::geography, 'intersection')
        returning id into v_road_node;

      insert into public.graph_edges
        (resort_id, from_node_id, to_node_id, geom, path_type, is_bidirectional)
      values (
        p_resort_id, v_edge.from_node_id, v_road_node,
        ST_LineSubstring(v_edge.g, 0, v_fraction)::geography,
        v_edge.path_type, v_edge.is_bidirectional
      );

      insert into public.graph_edges
        (resort_id, from_node_id, to_node_id, geom, path_type, is_bidirectional)
      values (
        p_resort_id, v_road_node, v_edge.to_node_id,
        ST_LineSubstring(v_edge.g, v_fraction, 1)::geography,
        v_edge.path_type, v_edge.is_bidirectional
      );

      delete from public.graph_edges where id = v_edge.id;
    end if;

    insert into public.graph_nodes (resort_id, geom, node_type)
      values (p_resort_id, v_site.geog, 'site')
      returning id into v_site_node;

    -- The last few metres, off the road and up to the house.
    insert into public.graph_edges
      (resort_id, from_node_id, to_node_id, geom, path_type)
    values (
      p_resort_id, v_road_node, v_site_node,
      ST_MakeLine(v_snap, v_site.geom)::geography,
      'path'
    );

    update public.sites set graph_node_id = v_site_node where id = v_site.id;
    v_connected := v_connected + 1;
  end loop;

  return v_connected;
end;
$$;

grant execute on function public.connect_sites_to_network(uuid, boolean) to authenticated;

-- The visitor-facing half: the shortest walk from the resort entrance to
-- one site, as a single line.
--
-- SECURITY DEFINER because anon has no access to graph_nodes or
-- graph_edges and must not get any - publishing a resort's internal
-- layout isn't the deal. The checks below are what that definer right is
-- traded for: a published resort, an active site, nothing else.
create or replace function public.route_to_site(p_site_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resort_id uuid;
  v_from bigint;
  v_to bigint;
  v_line geometry;
  v_distance double precision;
begin
  select s.resort_id, n.node_seq
    into v_resort_id, v_to
    from public.sites s
    join public.graph_nodes n on n.id = s.graph_node_id
    join public.resorts r on r.id = s.resort_id
    where s.id = p_site_id
      and s.status = 'active'
      and r.is_published;

  -- Not connected to the network yet, not active, or not published: no
  -- route. The visitor page falls back to distance and bearing.
  if v_to is null then
    return null;
  end if;

  select n.node_seq
    into v_from
    from public.resorts r
    join public.graph_nodes n on n.id = r.entrance_node_id
    where r.id = v_resort_id;

  if v_from is null then
    return null;
  end if;

  -- pgr_dijkstra reports, for each step, the node you're standing on and
  -- the edge you take next. That's what lets each edge be flipped to run
  -- in the direction of travel, so the pieces join into one line instead
  -- of zig-zagging back on themselves.
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
      v_from,
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
      end as geom,
      r.cost
    from route r
    join public.graph_edges e on e.edge_seq = r.edge
    where r.edge <> -1
  )
  -- ST_MakeLine in path order rather than ST_LineMerge: merging ignores
  -- the order it was given and hands back a MultiLineString the moment
  -- two pieces don't quite touch. Stitching in order always yields one
  -- LineString running entrance-to-site, so the page only ever has one
  -- shape to draw. Consecutive edges share a vertex, hence the tidy-up.
  select ST_RemoveRepeatedPoints(ST_MakeLine(geom order by path_seq)), sum(cost)
    into v_line, v_distance
    from steps;

  if v_line is null or ST_IsEmpty(v_line) then
    return null;
  end if;

  return json_build_object(
    'distance_m', round(v_distance::numeric, 1),
    'geometry', ST_AsGeoJSON(v_line)::json
  );
end;
$$;

-- Anon deliberately included: this is what the QR code's landing page
-- calls, and it's the only door into the network data.
grant execute on function public.route_to_site(uuid) to anon, authenticated;
