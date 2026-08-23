-- ---------------------------------------------------------------------
-- The resort's real boundary, drawn rather than guessed
--
-- 0007 worked the outline out from where the homes are: the shape that
-- contains them all, pushed out a little. That is a reasonable guess and
-- it needs no setting up, but it is a guess about the wrong thing. A
-- resort's edge is a property boundary, not a hull around its houses, so
-- the guess bulges out over the neighbours' back gardens on one side and
-- cuts the corner off the clubhouse on another - because a clubhouse
-- isn't a home and nothing in the guess knows it exists.
--
-- Staff can now trace the actual boundary over the master plan, once,
-- and it is used in preference. The computed hull stays as the fallback
-- for a resort nobody has drawn yet, so nothing has to be done for an
-- outline to appear at all.
-- ---------------------------------------------------------------------

alter table public.resorts
  add column if not exists boundary geography(Polygon, 4326);

comment on column public.resorts.boundary is
  'The resort perimeter as traced by staff. Null falls back to a hull computed from the homes.';

create or replace view public.public_resort_boundaries as
  select
    r.id as resort_id,
    ST_AsGeoJSON(
      coalesce(
        -- What staff drew, when they have.
        r.boundary::geometry,
        -- Otherwise the shape containing the homes and the entrance,
        -- pushed out far enough to take in the perimeter road.
        (
          select ST_Buffer(ST_ConvexHull(ST_Collect(p.g))::geography, 45)::geometry
          from (
            select s.location::geometry as g
              from public.sites s
             where s.resort_id = r.id
               and s.status = 'active'
            union all
            select n.geom::geometry
              from public.graph_nodes n
             where n.id = r.entrance_node_id
          ) p
        )
      ),
      6
    )::jsonb as boundary
  from public.resorts r
  where r.is_published;

grant select on public.public_resort_boundaries to anon, authenticated;

-- Saving a traced boundary, with the checking done where the geometry
-- lives rather than in the browser.
--
-- A traced ring can cross itself - it is very easy to do by dropping one
-- corner on the wrong side of the shape - and a self-intersecting
-- polygon is not a valid area. PostGIS can both spot that and repair it,
-- which is kinder than refusing the save and losing the tracing.
-- The area comes back so staff can sanity-check the shape against what
-- they know the resort to be.
create or replace function public.set_resort_boundary(
  p_resort_id uuid,
  p_wkt text
)
returns double precision
language plpgsql
security invoker
as $$
declare
  v_geom geometry;
begin
  v_geom := ST_GeomFromEWKT(p_wkt);

  if v_geom is null or GeometryType(v_geom) <> 'POLYGON' then
    raise exception 'That is not a boundary shape.';
  end if;

  if not ST_IsValid(v_geom) then
    -- Straightens out a ring that crosses itself. Buffering by zero is
    -- the standard repair and keeps the traced corners.
    v_geom := ST_Buffer(v_geom, 0);
    if v_geom is null or ST_IsEmpty(v_geom) then
      raise exception 'That boundary crosses itself in a way that cannot be repaired. Try re-tracing the corner that doubles back.';
    end if;
    -- A repair can split a bow-tie into several pieces; keep the largest.
    if GeometryType(v_geom) = 'MULTIPOLYGON' then
      select geom into v_geom
        from (
          select (ST_Dump(v_geom)).geom as geom
        ) parts
       order by ST_Area(geom) desc
       limit 1;
    end if;
  end if;

  update public.resorts
     set boundary = v_geom::geography
   where id = p_resort_id;

  if not found then
    raise exception 'That resort no longer exists.';
  end if;

  return ST_Area(v_geom::geography) / 10000;
end;
$$;

grant execute on function public.set_resort_boundary(uuid, text) to authenticated;

-- The boundary as the editor needs it: the drawn one where there is
-- one, the computed shape otherwise, and which of the two it is.
--
-- Separate from public_resort_boundaries because that view deliberately
-- shows nothing for an unpublished resort - and tracing a boundary is
-- exactly the sort of thing done before a resort goes live.
--
-- The fallback here counts every home rather than only the active ones,
-- so a resort still being set up gets a sensible shape to adjust rather
-- than nothing to start from.
create or replace function public.resort_boundary_geojson(p_resort_id uuid)
returns table (boundary jsonb, is_drawn boolean)
language sql
stable
security invoker
as $$
  select
    ST_AsGeoJSON(coalesce(r.boundary::geometry, hull.g), 6)::jsonb as boundary,
    r.boundary is not null as is_drawn
  from public.resorts r
  left join lateral (
    select ST_Buffer(ST_ConvexHull(ST_Collect(p.g))::geography, 45)::geometry as g
    from (
      select s.location::geometry as g
        from public.sites s
       where s.resort_id = r.id
         and s.location is not null
      union all
      select n.geom::geometry
        from public.graph_nodes n
       where n.id = r.entrance_node_id
    ) p
  ) hull on true
  where r.id = p_resort_id;
$$;

grant execute on function public.resort_boundary_geojson(uuid) to authenticated;
