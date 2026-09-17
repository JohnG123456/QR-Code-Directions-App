-- ---------------------------------------------------------------------
-- One entrance, not two
--
-- A resort has carried two different ideas of where its entrance is.
-- `center` is the reference point staff click on a map in Settings, and
-- it is what the visitor page has been drawing as the Entrance pin,
-- measuring the straight-line distance from, and rotating the map
-- around. `entrance_node_id` is a junction on the traced road network,
-- and it is where `route_to_site` actually starts the walk.
--
-- Nothing kept the two in step, so a resort could show its guests a pin
-- in one place while the purple line they were told to follow began in
-- another, with nothing on screen to say why. The original schema
-- already called this out - "superseded (but not replaced) by
-- entrance_node_id once the Phase 2 road graph exists" - and the road
-- graph now exists.
--
-- So the view prefers the entrance junction whenever a resort has one,
-- and falls back to the reference point when it doesn't. A resort with
-- no network behaves exactly as before. A resort with one stops being
-- able to disagree with itself, and gets there without anybody having
-- to remember to keep two records aligned by hand.
--
-- The reference point keeps its other jobs: it is where the admin maps
-- open, and what a resort measures from before any road is traced.
--
-- Appended nothing and reordered nothing: `create or replace view` can
-- add columns at the end but cannot rename, reorder or drop them, and
-- the visitor page selects these by name.
-- ---------------------------------------------------------------------

create or replace view public.public_resorts as
  select
    r.id,
    r.name,
    r.slug,
    r.default_zoom,
    coalesce(n.lat, r.center_lat) as entrance_lat,
    coalesce(n.lng, r.center_lng) as entrance_lng,
    (r.entrance_node_id is not null) as is_routable,
    r.map_bearing_deg
  from public.resorts r
  -- A left join, not an inner one: a resort without a network, or one
  -- whose entrance node has since been deleted, must still appear.
  left join public.graph_nodes n on n.id = r.entrance_node_id
  where r.is_published;

comment on view public.public_resorts is
  'Published resorts as the visitor page sees them. entrance_lat/lng is the entrance junction on the road network where one is set, otherwise the resort reference point - see 0014.';
