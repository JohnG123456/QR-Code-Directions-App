"use client";

import { TileLayer, LayersControl } from "react-leaflet";

const ESRI_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Satellite is the default because resort internal paths/buildings are
// visible there; OSM street tiles show almost nothing useful inside a
// private resort but help orient visitors to the surrounding area.
export function BasemapTileLayer({
  /** The visitor map turns the whole container, which would take the
   *  layer switcher with it and leave it lying on its side; that page
   *  draws its own controls outside the rotation instead. */
  withControl = true,
}: {
  withControl?: boolean;
} = {}) {
  if (!withControl) {
    return <TileLayer url={ESRI_IMAGERY_URL} attribution={ESRI_ATTRIBUTION} maxZoom={20} />;
  }

  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Satellite">
        <TileLayer url={ESRI_IMAGERY_URL} attribution={ESRI_ATTRIBUTION} maxZoom={20} />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Street map">
        <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} />
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}
