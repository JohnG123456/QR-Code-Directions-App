import L from "leaflet";

// Leaflet's default marker icon paths are relative and break under
// bundlers like webpack/Turbopack. Point them at the CDN copy that ships
// alongside the exact leaflet version we depend on instead of trying to
// wire up bundler asset imports for three small PNGs.
let patched = false;

export function fixDefaultLeafletIcon() {
  if (patched) return;
  patched = true;

  const version = L.version;
  const base = `https://unpkg.com/leaflet@${version}/dist/images`;

  L.Icon.Default.mergeOptions({
    iconRetinaUrl: `${base}/marker-icon-2x.png`,
    iconUrl: `${base}/marker-icon.png`,
    shadowUrl: `${base}/marker-shadow.png`,
  });
}
