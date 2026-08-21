"use client";

import { useEffect } from "react";
import { MapContainer, Marker, Polyline, useMap } from "react-leaflet";
import { routeEndpointIcon } from "@/lib/map/site-icon";
import { BasemapTileLayer } from "@/components/map/basemap-tile-layer";
import type { LatLng } from "@/lib/geo/distance";
import "leaflet/dist/leaflet.css";

function FitBoundsOnMount({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(points, { padding: [40, 40] });
  }, [map, points]);
  return null;
}

export function LeafletRouteView({
  entrance,
  site,
  zoom,
  routePoints,
  siteLabel,
}: {
  entrance: LatLng;
  site: LatLng;
  zoom: number;
  siteLabel: string;
  /** The walk along the resort's own roads, when there is one. Null
   *  falls back to the dashed straight line. */
  routePoints: [number, number][] | null;
}) {
  const entrancePos: [number, number] = [entrance.lat, entrance.lng];
  const sitePos: [number, number] = [site.lat, site.lng];
  // Fit to the route when there is one - a walk that loops around the
  // far side of the resort needs the whole loop on screen, not just its
  // two ends.
  const bounds = routePoints && routePoints.length > 1 ? routePoints : [entrancePos, sitePos];

  return (
    <MapContainer center={sitePos} zoom={zoom} className="h-full min-h-96 w-full">
      <BasemapTileLayer />
      <Marker position={entrancePos} icon={routeEndpointIcon("entrance", "Entrance")} />
      <Marker position={sitePos} icon={routeEndpointIcon("site", siteLabel)} />
      {routePoints && routePoints.length > 1 ? (
        // Solid: this is the way to walk, not an estimate.
        <Polyline
          positions={routePoints}
          pathOptions={{ color: "#2563eb", weight: 6, opacity: 0.9 }}
        />
      ) : (
        <Polyline
          positions={[entrancePos, sitePos]}
          pathOptions={{ color: "#2563eb", dashArray: "8 8", weight: 4 }}
        />
      )}
      <FitBoundsOnMount points={bounds} />
    </MapContainer>
  );
}
