import L from "leaflet";
import type { SiteStatus } from "@/lib/types";

const STATUS_COLOR: Record<SiteStatus, string> = {
  draft: "#d97706", // amber - captured but not yet reviewed
  active: "#15803d", // green - live/published
  inactive: "#6b7280", // gray - excluded from visitor lookup
};

// Same dot, with the site number alongside it. Once a couple of hundred
// pins are on the map, unlabelled dots make it impossible to tell which
// homes are already done.
export function labelledSiteDivIcon(
  status: SiteStatus,
  siteNumber: string,
  highlighted = false
) {
  const color = STATUS_COLOR[status];
  const size = highlighted ? 22 : 14;
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;gap:3px;white-space:nowrap;">
      <span style="
        display:block;
        width:${size}px;
        height:${size}px;
        border-radius:9999px;
        background:${color};
        border:2px solid white;
        box-shadow:0 1px 3px rgba(0,0,0,0.4);
        flex:0 0 auto;
      "></span>
      <span style="
        font:600 10px/1.1 system-ui,sans-serif;
        color:#111;
        background:rgba(255,255,255,0.85);
        padding:0 2px;
        border-radius:2px;
      ">${siteNumber.replace(/[<>&"]/g, "")}</span>
    </span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function siteDivIcon(status: SiteStatus, highlighted = false) {
  const color = STATUS_COLOR[status];
  const size = highlighted ? 22 : 16;
  return L.divIcon({
    className: "",
    html: `<span style="
      display:block;
      width:${size}px;
      height:${size}px;
      border-radius:9999px;
      background:${color};
      border:2px solid white;
      box-shadow:0 1px 3px rgba(0,0,0,0.4);
    "></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// The two pins on the visitor's map.
//
// Drawn in HTML/CSS rather than as Leaflet's default marker images,
// which load from a CDN: this is the one page a guest opens standing at
// a resort gate on whatever signal they have, and a third party being
// slow or blocked shouldn't leave them with a line and no idea which end
// is their house. It also lets the pins say what they are.
export function routeEndpointIcon(kind: "entrance" | "site", label: string) {
  const color = kind === "entrance" ? "#7c3aed" : "#15803d";
  const safeLabel = label.replace(/[<>&"]/g, "");
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;gap:4px;white-space:nowrap;">
      <span style="
        display:block;
        width:18px;
        height:18px;
        border-radius:9999px;
        background:${color};
        border:3px solid white;
        box-shadow:0 1px 4px rgba(0,0,0,0.5);
        flex:0 0 auto;
      "></span>
      <span style="
        font:600 12px/1.2 system-ui,sans-serif;
        color:#111;
        background:rgba(255,255,255,0.9);
        padding:1px 4px;
        border-radius:3px;
        box-shadow:0 1px 2px rgba(0,0,0,0.25);
      ">${safeLabel}</span>
    </span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}
