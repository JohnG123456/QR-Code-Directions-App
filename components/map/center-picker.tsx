"use client";

import { useEffect, useState } from "react";
import { MapContainer, Marker, useMapEvents } from "react-leaflet";
import { fixDefaultLeafletIcon } from "@/lib/map/fix-default-icon";
import { BasemapTileLayer } from "./basemap-tile-layer";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER: [number, number] = [-31.9505, 115.8605]; // Perth, WA

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function CenterPicker({
  initialLat,
  initialLng,
  onChange,
}: {
  initialLat: number | null;
  initialLng: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const [position, setPosition] = useState<[number, number] | null>(
    initialLat !== null && initialLng !== null ? [initialLat, initialLng] : null
  );

  useEffect(() => {
    fixDefaultLeafletIcon();
  }, []);

  function handlePick(lat: number, lng: number) {
    setPosition([lat, lng]);
    onChange(lat, lng);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-500">
        Click the map to set the resort&apos;s reference point (used as the
        default map center and as the starting point for directions).
      </p>
      <div className="h-80 w-full overflow-hidden rounded-md border border-neutral-300">
        <MapContainer
          center={position ?? DEFAULT_CENTER}
          zoom={position ? 18 : 12}
          className="h-full w-full"
        >
          <BasemapTileLayer />
          <ClickToPlace onPick={handlePick} />
          {position && <Marker position={position} />}
        </MapContainer>
      </div>
    </div>
  );
}
