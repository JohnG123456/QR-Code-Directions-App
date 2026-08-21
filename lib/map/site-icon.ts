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
