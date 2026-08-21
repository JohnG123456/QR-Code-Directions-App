"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { LatLng } from "@/lib/geo/distance";

// Draws the master plan image on the map in its real-world position and
// rotation.
//
// Leaflet's own ImageOverlay only takes an axis-aligned lat/lng box, so
// it can't show a sheet that's rotated relative to north - and plan
// sheets almost never are north-up. Instead this places a plain <img> in
// the overlay pane and gives it the CSS matrix that maps image pixels to
// current screen positions, recomputed whenever the map moves. Three
// corners fully determine that matrix.
export function PlanImageOverlay({
  imageUrl,
  imageWidth,
  imageHeight,
  topLeft,
  topRight,
  bottomLeft,
  opacity,
}: {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  topLeft: LatLng;
  topRight: LatLng;
  bottomLeft: LatLng;
  opacity: number;
}) {
  const map = useMap();
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Corner objects are rebuilt on every render, so the effect depends on
  // their numbers instead: re-running it would re-decode a couple of MB
  // of image on every keystroke elsewhere in the page.
  const { lat: tlLat, lng: tlLng } = topLeft;
  const { lat: trLat, lng: trLng } = topRight;
  const { lat: blLat, lng: blLng } = bottomLeft;

  useEffect(() => {
    const img = L.DomUtil.create("img") as HTMLImageElement;
    img.src = imageUrl;
    // Sized in CSS, not just via the width/height attributes: a CSS reset
    // that sets `img { max-width: 100%; height: auto }` - Tailwind's
    // preflight does exactly that - resolves against Leaflet's overlay
    // pane, which has no width of its own, and collapses the plan to
    // nothing. It renders, it's just 0x0.
    img.style.width = `${imageWidth}px`;
    img.style.height = `${imageHeight}px`;
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.position = "absolute";
    img.style.transformOrigin = "0 0";
    // The plan is a backdrop to trace over - clicks must reach the map
    // and the node/edge markers on top of it.
    img.style.pointerEvents = "none";
    img.style.willChange = "transform";
    imgRef.current = img;

    map.getPanes().overlayPane?.appendChild(img);

    const reposition = () => {
      const tl = map.latLngToLayerPoint([tlLat, tlLng]);
      const tr = map.latLngToLayerPoint([trLat, trLng]);
      const bl = map.latLngToLayerPoint([blLat, blLng]);

      // Columns of the affine matrix: where one pixel step along the
      // image's x and y axes lands on screen.
      const ax = (tr.x - tl.x) / imageWidth;
      const ay = (tr.y - tl.y) / imageWidth;
      const bx = (bl.x - tl.x) / imageHeight;
      const by = (bl.y - tl.y) / imageHeight;

      img.style.transform = `matrix(${ax}, ${ay}, ${bx}, ${by}, ${tl.x}, ${tl.y})`;
    };

    reposition();
    // "zoom" fires on each frame of the zoom animation and "move" on each
    // frame of a pan - without both, the plan visibly lags the imagery.
    map.on("move zoom zoomend viewreset resize", reposition);

    return () => {
      map.off("move zoom zoomend viewreset resize", reposition);
      img.remove();
      imgRef.current = null;
    };
  }, [
    map,
    imageUrl,
    imageWidth,
    imageHeight,
    tlLat,
    tlLng,
    trLat,
    trLng,
    blLat,
    blLng,
  ]);

  useEffect(() => {
    if (imgRef.current) imgRef.current.style.opacity = String(opacity);
  }, [opacity]);

  return null;
}
