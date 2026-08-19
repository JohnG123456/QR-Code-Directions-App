"use client";

import { useEffect } from "react";
import { MapContainer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import { fixDefaultLeafletIcon } from "@/lib/map/fix-default-icon";
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
}: {
  entrance: LatLng;
  site: LatLng;
  zoom: number;
}) {
  useEffect(() => {
    fixDefaultLeafletIcon();
  }, []);

  const entrancePos: [number, number] = [entrance.lat, entrance.lng];
  const sitePos: [number, number] = [site.lat, site.lng];

  return (
    <MapContainer center={sitePos} zoom={zoom} className="h-full min-h-96 w-full">
      <BasemapTileLayer />
      <Marker position={entrancePos}>
        <Popup>Entrance</Popup>
      </Marker>
      <Marker position={sitePos}>
        <Popup>Your site</Popup>
      </Marker>
      <Polyline
        positions={[entrancePos, sitePos]}
        pathOptions={{ color: "#2563eb", dashArray: "8 8", weight: 4 }}
      />
      <FitBoundsOnMount points={[entrancePos, sitePos]} />
    </MapContainer>
  );
}
