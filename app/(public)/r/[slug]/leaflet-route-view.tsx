"use client";

import { useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, useMap } from "react-leaflet";
import type L from "leaflet";
import { routeEndpointIcon } from "@/lib/map/site-icon";
import { BasemapTileLayer } from "@/components/map/basemap-tile-layer";
import { PlanImageOverlay } from "@/components/map/plan-image-overlay";
import { RotatedMapFrame, type PanTarget } from "@/components/map/rotated-map-frame";
import { OutsideMask, BoundaryOutline, type BoundaryRings } from "@/components/map/outside-mask";
import type { PlanOverlayPlacement } from "@/lib/masterplan/published-overlay";
import type { LatLng } from "@/lib/geo/distance";
import "leaflet/dist/leaflet.css";

// Frames the walk when it changes - and only then. The dependency is a
// string, not the array: a fresh array on every render would re-frame the
// map continuously and undo the visitor's own panning and zooming.
function FitBoundsOnRouteChange({
  points,
  padding,
}: {
  points: [number, number][];
  /** Rotation means the visible area is a rotated rectangle inside a
   *  bigger square, so the fit needs more room than the padding a
   *  north-up map would want, or the ends of the walk sit off-screen. */
  padding: number;
}) {
  const map = useMap();
  const key = points.map(([lat, lng]) => `${lat},${lng}`).join(";");
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(points, { padding: [padding, padding] });
    // points is derived from key; depending on it directly would defeat
    // the point of keying on the string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key, padding]);
  return null;
}

/** Hands the map out so the rotated frame can pan it. */
function ExposeMap({ onMap }: { onMap: (map: L.Map | null) => void }) {
  const map = useMap();
  useEffect(() => {
    onMap(map);
    return () => onMap(null);
  }, [map, onMap]);
  return null;
}

export function LeafletRouteView({
  entrance,
  site,
  zoom,
  routePoints,
  siteLabel,
  plan,
  planImageUrl,
  planOpacity,
  bearingDeg,
  boundary,
}: {
  entrance: LatLng;
  site: LatLng;
  zoom: number;
  siteLabel: string;
  /** The walk along the resort's own roads, when there is one. Null
   *  falls back to the dashed straight line. */
  routePoints: [number, number][] | null;
  /** Where the published master plan sits in the world, when there is
   *  one. Null means satellite imagery alone. */
  plan: PlanOverlayPlacement | null;
  planImageUrl: string | null;
  /** 0 hides the plan without unmounting it, so toggling back doesn't
   *  re-download the image. */
  planOpacity: number;
  /** Compass bearing drawn straight up the page. */
  bearingDeg: number;
  /** The resort's outline; everything outside it is greyed out. */
  boundary: BoundaryRings;
}) {
  const entrancePos: [number, number] = [entrance.lat, entrance.lng];
  const sitePos: [number, number] = [site.lat, site.lng];
  // Fit to the route when there is one - a walk that loops around the
  // far side of the resort needs the whole loop on screen, not just its
  // two ends.
  const bounds = routePoints && routePoints.length > 1 ? routePoints : [entrancePos, sitePos];

  const [map, setMap] = useState<L.Map | null>(null);
  const rotated = bearingDeg !== 0;

  // Leaflet's own drag reads pointer positions from an upright bounding
  // box, so it can't be trusted once the container is turned; the frame
  // does the panning instead. Zooming is pinned to the centre for the
  // same reason.
  const panTarget: PanTarget | null = map
    ? {
        panBy: (dx, dy) => map.panBy([dx, dy], { animate: false }),
        invalidateSize: () => map.invalidateSize({ animate: false }),
      }
    : null;

  const inner = (fitPadding: number) => (
    <MapContainer
      center={sitePos}
      zoom={zoom}
      className="h-full w-full"
      dragging={!rotated}
      touchZoom={rotated ? "center" : true}
      scrollWheelZoom={rotated ? "center" : true}
      doubleClickZoom={rotated ? "center" : true}
      zoomControl={!rotated}
      attributionControl={false}
    >
      <ExposeMap onMap={setMap} />
      <BasemapTileLayer withControl={false} />
      {plan && planImageUrl && (
        <PlanImageOverlay
          imageUrl={planImageUrl}
          imageWidth={plan.imageWidth}
          imageHeight={plan.imageHeight}
          topLeft={plan.topLeft}
          topRight={plan.topRight}
          bottomLeft={plan.bottomLeft}
          opacity={planOpacity}
        />
      )}
      <OutsideMask rings={boundary} />
      <BoundaryOutline rings={boundary} />
      {routePoints && routePoints.length > 1 ? (
        // Solid: this is the way to walk, not an estimate.
        <Polyline
          positions={routePoints}
          pathOptions={{ color: "#702890", weight: 6, opacity: 0.95 }}
        />
      ) : (
        <Polyline
          positions={[entrancePos, sitePos]}
          pathOptions={{ color: "#702890", dashArray: "8 8", weight: 4 }}
        />
      )}
      <Marker
        position={entrancePos}
        icon={routeEndpointIcon("entrance", "Entrance", bearingDeg)}
      />
      <Marker position={sitePos} icon={routeEndpointIcon("site", siteLabel, bearingDeg)} />
      <FitBoundsOnRouteChange points={bounds} padding={fitPadding} />
    </MapContainer>
  );

  if (!rotated) return <div className="h-full w-full">{inner(40)}</div>;

  return (
    <RotatedMapFrame bearingDeg={bearingDeg} panTarget={panTarget} className="h-full w-full">
      {/* Padded past the part of the square that the rotation pushes
          off-screen, plus a margin so the pins aren't against the edge. */}
      {({ safeInset }) => inner(Math.round(safeInset) + 34)}
    </RotatedMapFrame>
  );
}
