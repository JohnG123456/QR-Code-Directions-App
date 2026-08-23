-- ---------------------------------------------------------------------
-- Framing the resort for visitors
--
-- Two things a guest at the entrance needs that a north-up satellite
-- view doesn't give them.
--
-- Orientation. Standing at the gate, the way you walk in should be "up"
-- on the page. A map drawn north-up asks the visitor to do the rotation
-- in their head before they can take a step, and resorts are almost
-- never aligned to north. The bearing is normally worked out from the
-- entrance towards the middle of the resort, which is exactly "the way
-- you're facing when you walk in"; map_bearing_deg overrides that where
-- the automatic answer doesn't line up with the main boulevard.
--
-- Focus. The surrounding suburb is noise - other estates, main roads,
-- bare sand - and it competes with the thing the guest is looking for.
-- The boundary below is what lets the page grey everything else out.
-- ---------------------------------------------------------------------

alter table public.resorts
  add column if not exists map_bearing_deg double precision;

comment on column public.resorts.map_bearing_deg is
  'Compass bearing drawn straight up the visitor map. Null means work it out from the entrance towards the middle of the resort.';

-- The visitor page reads resorts through public_resorts, never the table
-- itself, so a new column on the table is invisible to it until the view
-- says so. Adding it here rather than leaving that to be noticed later:
-- a column the page selects and the view doesn't have isn't a missing
-- feature, it's an error that takes the whole page down.
--
-- Appended at the end because `create or replace view` can add columns
-- but cannot reorder or remove them.
create or replace view public.public_resorts as
  select
    id,
    name,
    slug,
    default_zoom,
    center_lat as entrance_lat,
    center_lng as entrance_lng,
    (entrance_node_id is not null) as is_routable,
    map_bearing_deg
  from public.resorts
  where is_published;

-- The resort's own outline, as the visitor page needs it.
--
-- Built from where the homes actually are rather than from a drawn
-- boundary, so it needs no extra work per resort and follows the resort
-- as more stages are captured. The entrance is included because it
-- often sits outside the homes, and the buffer keeps the perimeter
-- road and the gate inside the outline rather than cutting them off.
create or replace view public.public_resort_boundaries as
  select
    r.id as resort_id,
    ST_AsGeoJSON(
      ST_Buffer(ST_ConvexHull(ST_Collect(p.g))::geography, 45)::geometry,
      6
    )::jsonb as boundary
  from public.resorts r
  join lateral (
    select s.location::geometry as g
      from public.sites s
     where s.resort_id = r.id
       and s.status = 'active'
    union all
    select n.geom::geometry
      from public.graph_nodes n
     where n.id = r.entrance_node_id
  ) p on true
  where r.is_published
  group by r.id;

-- Same doctrine as the other public views (see 0001): no
-- security_invoker, so anon reads the outline without any grant on
-- sites or graph_nodes themselves.
grant select on public.public_resort_boundaries to anon, authenticated;
