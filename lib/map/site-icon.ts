import L from "leaflet";
import type { SiteStatus } from "@/lib/types";

const STATUS_COLOR: Record<SiteStatus, string> = {
  draft: "#d97706", // amber - captured but not yet reviewed
  active: "#15803d", // green - live/published
  inactive: "#6b7280", // gray - excluded from visitor lookup
};

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
