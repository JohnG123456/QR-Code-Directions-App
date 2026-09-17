import L from "leaflet";
import type { SiteStatus } from "@/lib/types";

// Icons are cached and shared between markers, and that is load-bearing,
// not an optimisation.
//
// react-leaflet re-applies a Marker's icon whenever the prop's identity
// changes, and Leaflet's setIcon rebuilds the marker's DOM element -
// which closes any popup that was open on it. Building a fresh divIcon on
// every render therefore made a popup shut the instant anything in the
// page re-rendered, so a control inside a popup could never be used: the
// first tap closed the thing it was in.
//
// A divIcon is a stateless description of how to draw a marker, so one
// instance is safe to share; keying the cache on everything that affects
// the drawing keeps them correct.
const iconCache = new Map<string, L.DivIcon>();

// A resort has a few hundred sites and three statuses, so the cache
// settles at a small size. The cap is only there so that a long session
// of renaming can't grow it without bound.
const ICON_CACHE_LIMIT = 4000;

function cachedIcon(key: string, build: () => L.DivIcon): L.DivIcon {
  const existing = iconCache.get(key);
  if (existing) return existing;
  if (iconCache.size >= ICON_CACHE_LIMIT) iconCache.clear();
  const icon = build();
  iconCache.set(key, icon);
  return icon;
}

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
  return cachedIcon(`labelled|${status}|${siteNumber}|${highlighted}`, () =>
    buildLabelledSiteDivIcon(status, siteNumber, highlighted)
  );
}

function buildLabelledSiteDivIcon(
  status: SiteStatus,
  siteNumber: string,
  highlighted: boolean
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
  return cachedIcon(`plain|${status}|${highlighted}`, () =>
    buildSiteDivIcon(status, highlighted)
  );
}

function buildSiteDivIcon(status: SiteStatus, highlighted: boolean) {
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
export function routeEndpointIcon(
  kind: "entrance" | "site",
  label: string,
  /** How far the map itself has been turned. The pin is counter-turned
   *  by the same amount so the words stay the right way up - a rotated
   *  map with sideways labels is harder to read than no rotation at
   *  all. */
  mapBearingDeg = 0
) {
  return cachedIcon(`route|${kind}|${label}|${mapBearingDeg}`, () =>
    buildRouteEndpointIcon(kind, label, mapBearingDeg)
  );
}

function buildRouteEndpointIcon(
  kind: "entrance" | "site",
  label: string,
  mapBearingDeg: number
) {
  const color = kind === "entrance" ? "#702890" : "#15803d";
  const safeLabel = label.replace(/[<>&"]/g, "");
  const upright =
    mapBearingDeg === 0
      ? ""
      : `transform:rotate(${mapBearingDeg}deg);transform-origin:9px 9px;`;
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;gap:4px;white-space:nowrap;${upright}">
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

// Where the visitor is right now, while live directions are running.
//
// Blue rather than the resort's purple, because it is the one thing on
// the map that is not part of the resort: purple is the route and the
// entrance, and a guest should be able to tell "you" from "the way" at a
// glance while driving.
//
// The arrow is only drawn when the heading is trustworthy - see
// usableHeading - so a stationary car gets a plain dot rather than one
// pointing confidently in an invented direction.
// Takes no map bearing, unlike the pins above, and that is the whole
// trick: the marker sits inside the map, so it has already been turned
// by -bearing along with everything else. Rotating it by the plain
// compass heading therefore lands it on screen at heading-minus-bearing,
// which is exactly where the visitor is pointing relative to the way the
// map is drawn. The pins need the bearing because they are counteracting
// that same rotation to keep their words upright.
export function livePositionIcon(headingDeg: number | null) {
  // Rounded before it reaches the cache key. A heading arrives as a raw
  // float and changes on every fix, so keying on it unrounded would mint
  // a fresh icon a second and churn through the cache for a difference
  // nobody can see at 20 pixels across.
  const stepped = headingDeg === null ? null : Math.round(headingDeg / 5) * 5;
  return cachedIcon(`live|${stepped ?? "none"}`, () => buildLivePositionIcon(stepped));
}

function buildLivePositionIcon(headingDeg: number | null) {
  const size = 20;
  const arrow =
    headingDeg === null
      ? ""
      : `<span style="
          position:absolute;
          left:50%;
          top:50%;
          width:0;
          height:0;
          border-left:6px solid transparent;
          border-right:6px solid transparent;
          border-bottom:14px solid #1d4ed8;
          transform:translate(-50%,-50%) rotate(${headingDeg}deg) translateY(-15px);
          filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35));
        "></span>`;

  return L.divIcon({
    className: "",
    html: `<span style="position:relative;display:block;width:${size}px;height:${size}px;">
      ${arrow}
      <span style="
        position:absolute;
        inset:0;
        border-radius:9999px;
        background:#2563eb;
        border:3px solid white;
        box-shadow:0 1px 4px rgba(0,0,0,0.5);
      "></span>
    </span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
