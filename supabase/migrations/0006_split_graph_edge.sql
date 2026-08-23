-- ---------------------------------------------------------------------
-- Joining a new road onto an existing one, part-way along it
--
-- Tracing a resort means constantly running a side street into the
-- middle of a through road. Until now the editor could only join onto a
-- junction that already existed, so the only thing a click near a road
-- could do was drop a *separate* junction next to it - one that looks
-- joined on screen, routes as a dead end, and is only discovered later
-- as "12 junctions aren't connected to the entrance".
--
-- Splitting has to be one transaction: a node appears part-way along a
-- road, the road becomes two roads that meet at it, and the original
-- goes. Any partial version of that is a broken graph, which is why
-- this is a function rather than three calls from the client.
--
-- connect_sites_to_network already does exactly this internally for
-- house driveways; this exposes the same operation for hand-tracing.
-- ---------------------------------------------------------------------

-- Dropped first so the migration can be re-run after the return type
-- changed; Postgres refuses to redefine a function's return type in place.
drop function if exists public.split_graph_edge(uuid, double precision, double precision);

create or replace function public.split_graph_edge(
  p_edge_id uuid,
  p_lat double precision,
  p_lng double precision
)
-- Returns what it made, not just the junction: the editor has already
-- drawn the two halves optimistically and needs to know what the
-- database called them, or they stay stuck under placeholder ids and
-- every later edit to them silently does nothing.
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_edge record;
  v_point geometry;
  v_fraction double precision;
  v_snap geometry;
  v_node_id uuid;
  v_first_id uuid;
  v_second_id uuid;
begin
  select e.id, e.resort_id, e.geom::geometry as g, e.from_node_id, e.to_node_id,
         e.path_type, e.is_bidirectional
    into v_edge
    from public.graph_edges e
   where e.id = p_edge_id;

  if not found then
    raise exception 'That road no longer exists.';
  end if;

  v_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  v_fraction := ST_LineLocatePoint(v_edge.g, v_point);
  -- The point actually on the road, not where the finger landed. Without
  -- this the new junction sits a few metres off the line and the two
  -- halves stop meeting.
  v_snap := ST_LineInterpolatePoint(v_edge.g, v_fraction);

  -- Close enough to an end that splitting would leave a stub of a road:
  -- hand back the junction that is already there instead. The caller
  -- treats both outcomes the same - "here is the node to join to".
  if ST_Distance(v_snap::geography, ST_StartPoint(v_edge.g)::geography) < 1 then
    return jsonb_build_object('node_id', v_edge.from_node_id, 'split', false);
  end if;
  if ST_Distance(v_snap::geography, ST_EndPoint(v_edge.g)::geography) < 1 then
    return jsonb_build_object('node_id', v_edge.to_node_id, 'split', false);
  end if;

  insert into public.graph_nodes (resort_id, geom, node_type)
    values (v_edge.resort_id, v_snap::geography, 'intersection')
    returning id into v_node_id;

  insert into public.graph_edges
    (resort_id, from_node_id, to_node_id, geom, path_type, is_bidirectional)
  values (
    v_edge.resort_id, v_edge.from_node_id, v_node_id,
    ST_LineSubstring(v_edge.g, 0, v_fraction)::geography,
    v_edge.path_type, v_edge.is_bidirectional
  )
  returning id into v_first_id;

  insert into public.graph_edges
    (resort_id, from_node_id, to_node_id, geom, path_type, is_bidirectional)
  values (
    v_edge.resort_id, v_node_id, v_edge.to_node_id,
    ST_LineSubstring(v_edge.g, v_fraction, 1)::geography,
    v_edge.path_type, v_edge.is_bidirectional
  )
  returning id into v_second_id;

  delete from public.graph_edges where id = v_edge.id;

  return jsonb_build_object(
    'node_id', v_node_id,
    'split', true,
    -- In the same order the caller drew them: the half containing the
    -- road's original start, then the half containing its original end.
    'first_edge_id', v_first_id,
    'second_edge_id', v_second_id
  );
end;
$$;

-- security invoker, unlike the visitor-facing routing function: this is
-- staff-only editing, so it should run under the caller's own RLS rather
-- than around it.
grant execute on function public.split_graph_edge(uuid, double precision, double precision) to authenticated;
