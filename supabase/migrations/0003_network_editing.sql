-- ---------------------------------------------------------------------
-- Road network editing support
--
-- The graph_nodes/graph_edges tables were created in 0001 and left
-- empty. This adds the two things the digitizer needs on top of them:
-- a way to read edge shapes back out, and a way to move a junction
-- without tearing the roads off it.
-- ---------------------------------------------------------------------

-- PostgREST hands back a geography column as raw WKB hex, which the
-- browser can't draw. This view exposes each road's shape as GeoJSON
-- instead. security_invoker so the staff-only RLS policy on graph_edges
-- still applies through the view - unlike the public_* views in 0001,
-- this is admin data and must stay behind the same check.
create view public.graph_edges_view
  with (security_invoker = true)
  as
  select
    id,
    resort_id,
    from_node_id,
    to_node_id,
    path_type,
    is_bidirectional,
    length_m,
    ST_AsGeoJSON(geom::geometry)::json as geojson
  from public.graph_edges;

grant select on public.graph_edges_view to authenticated;

-- Moving a junction has to move the ends of every road that meets there.
-- Done in one function so the graph can never be left with a road
-- hanging in space: still connected in the database, visibly detached on
-- the map, which is harder to spot and fix than either problem alone.
--
-- SECURITY INVOKER (the default) on purpose: the caller's RLS decides
-- whether they may touch these rows.
create or replace function public.move_graph_node(
  p_node_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns void
language plpgsql
as $$
declare
  new_point geometry;
begin
  new_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);

  update public.graph_nodes
    set geom = new_point::geography,
        updated_at = now()
    where id = p_node_id;

  -- Roads that start here: move their first vertex.
  update public.graph_edges
    set geom = ST_SetPoint(geom::geometry, 0, new_point)::geography
    where from_node_id = p_node_id;

  -- Roads that end here: move their last vertex.
  update public.graph_edges
    set geom = ST_SetPoint(
      geom::geometry,
      ST_NPoints(geom::geometry) - 1,
      new_point
    )::geography
    where to_node_id = p_node_id;
end;
$$;

grant execute on function public.move_graph_node(uuid, double precision, double precision) to authenticated;
