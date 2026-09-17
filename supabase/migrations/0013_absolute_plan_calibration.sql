-- ---------------------------------------------------------------------
-- Master plan calibration, stored as coordinates instead of offsets
--
-- A calibration point pairs a spot on the plan image with the real place
-- it sits. The second half used to be written as metres east and north
-- of the resort's reference point - the same record the visitor page
-- serves as the entrance.
--
-- That coupling was invisible and expensive. Moving the entrance to the
-- actual gate, months after a plan was calibrated, left every stored
-- point measured from a landmark that had moved, so anything that
-- re-derived the sheet's position placed the whole drawing off by
-- exactly that distance. Site pins, traced roads and the boundary stayed
-- put, because those are absolute, so the drawing and everything drawn
-- over it disagreed with no indication of why. Worse, the published
-- overlay is a snapshot of absolute corners precisely to avoid this, so
-- the drift only appeared on republish - the one thing anyone would try
-- when a plan looked wrong.
--
-- So `pairs` now holds { plan: {x,y}, world: {lat,lng} }, and nothing
-- about the resort record can move a calibrated plan again.
--
-- The conversion below reproduces where each plan sits TODAY: it uses
-- the resort's current reference point, which is the same one the code
-- reads now. A plan that already drifted is still drifted afterwards and
-- has to be recalibrated by hand - the old measurement simply doesn't
-- carry the information needed to undo it. What this buys is that it
-- cannot happen again.
--
-- Safe to run twice: points already holding a coordinate are left alone.
-- ---------------------------------------------------------------------

-- The same sphere and equirectangular approximation as
-- lib/geo/local-projection.ts, so converted points land exactly where
-- the application would have drawn them.
--   metres per degree of latitude = 6371000 * pi() / 180
--   metres per degree of longitude = that, times cos(latitude)

-- The trigger stamps updated_at, which is what the admin panel compares
-- against a published overlay to decide whether it is out of date. This
-- conversion changes where nothing sits, so letting it mark every plan
-- as needing a republish would be a false alarm - and republishing is
-- the exact action that used to make things worse.
alter table public.masterplan_drafts disable trigger trg_masterplan_drafts_updated_at;

update public.masterplan_drafts d
set pairs = (
  select coalesce(
    jsonb_agg(
      case
        when e.pair -> 'world' ->> 'lat' is not null then e.pair
        else jsonb_build_object(
          'plan', e.pair -> 'plan',
          'world', jsonb_build_object(
            'lat',
            r.center_lat
              + ((e.pair -> 'world' ->> 'y')::double precision)
                / (6371000 * pi() / 180),
            'lng',
            r.center_lng
              + ((e.pair -> 'world' ->> 'x')::double precision)
                / ((6371000 * pi() / 180) * cos(radians(r.center_lat)))
          )
        )
      end
      order by e.ord
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(d.pairs) with ordinality as e(pair, ord)
)
from public.resorts r
where r.id = d.resort_id
  -- Without a reference point there is nothing to convert an offset
  -- from. Such a draft can't have been calibrated in the first place
  -- (the tool refuses to open the satellite map without one), so this
  -- only ever skips empty `pairs`.
  and r.center_lat is not null
  and r.center_lng is not null
  and exists (
    select 1
    from jsonb_array_elements(d.pairs) as stale(pair)
    where stale.pair -> 'world' ->> 'lat' is null
  );

alter table public.masterplan_drafts enable trigger trg_masterplan_drafts_updated_at;

comment on column public.masterplan_drafts.pairs is
  '[{ plan: {x,y}, world: {lat,lng} }] calibration reference points: a spot on the plan image and the real coordinate it sits at. Deliberately absolute - see 0013.';
