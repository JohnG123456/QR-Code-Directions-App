"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polygon, Polyline, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { BasemapTileLayer } from "@/components/map/basemap-tile-layer";
import { PlanImageOverlay } from "@/components/map/plan-image-overlay";
import { siteDivIcon } from "@/lib/map/site-icon";
import { georeferencePlan } from "@/lib/geo/plan-georeference";
import { loadMasterplanDraft } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/import-masterplan/actions";
import type { PointPair } from "@/lib/geo/similarity-transform";
import type { SiteStatus } from "@/lib/types";
import type { BoundarySaveState } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/boundary/actions";
import "leaflet/dist/leaflet.css";

// Tracing the resort's perimeter.
//
// Deliberately much simpler than the road editor: one closed ring, no
// junctions, no network. Tap to drop a corner, drag to nudge one, tap a
// corner to take it out, and the shape closes itself - which is why
// there is no "finish" step and no way to leave a boundary half-drawn.
//
// Traced over the master plan rather than satellite, because the plan is
// where the property line is actually drawn. On imagery you are guessing
// from kerbs and fence lines, and the corner behind the clubhouse is
// exactly the sort of thing imagery makes you guess at.

interface Point {
  lat: number;
  lng: number;
}

interface SiteMarker {
  id: string;
  lat: number;
  lng: number;
  status: SiteStatus;
}

const cornerIconCache = new Map<string, L.DivIcon>();
function cornerIcon(isFirst: boolean) {
  const key = String(isFirst);
  const cached = cornerIconCache.get(key);
  if (cached) return cached;
  const dot = 13;
  // Padded out so a corner can be hit on a touch screen without drawing
  // a target that hides the plan underneath it.
  const box = dot + 20;
  const icon = L.divIcon({
    className: "",
    html: `<span style="display:block;position:relative;width:${box}px;height:${box}px;">
      <span style="
        position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        width:${dot}px;height:${dot}px;border-radius:9999px;
        background:${isFirst ? "#c04890" : "#702890"};border:2px solid white;
        box-shadow:0 1px 3px rgba(0,0,0,0.5);
      "></span></span>`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
  });
  cornerIconCache.set(key, icon);
  return icon;
}

export function BoundaryEditor({
  resortId,
  centerLat,
  centerLng,
  defaultZoom,
  initialPoints,
  hasDrawnBoundary,
  sites,
  planCalibration,
  planUnavailable,
  saveResortBoundary,
  clearResortBoundary,
}: {
  resortId: string;
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  initialPoints: Point[];
  /** Whether what's shown was drawn, or is the fallback shape worked out
   *  from where the homes are. */
  hasDrawnBoundary: boolean;
  sites: SiteMarker[];
  planCalibration: {
    pairs: PointPair[];
    imageWidth: number;
    imageHeight: number;
    fileName: string | null;
  } | null;
  planUnavailable: "not-migrated" | "no-plan" | "not-calibrated" | null;
  saveResortBoundary: (input: {
    resortId: string;
    points: Point[];
  }) => Promise<BoundarySaveState>;
  clearResortBoundary: (input: { resortId: string }) => Promise<BoundarySaveState>;
}) {
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [history, setHistory] = useState<Point[][]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [showPlan, setShowPlan] = useState(true);
  const [planOpacity, setPlanOpacity] = useState(0.85);
  const [planImage, setPlanImage] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const georeference = useMemo(
    () =>
      planCalibration
        ? georeferencePlan(
            planCalibration.pairs,
            planCalibration.imageWidth,
            planCalibration.imageHeight,
            { lat: centerLat, lng: centerLng }
          )
        : null,
    [planCalibration, centerLat, centerLng]
  );

  // The plan is the point of this screen, so it loads without being
  // asked for - unlike the road editor, where satellite is often enough.
  //
  // Guarded by a ref rather than by the loading flag: the flag is state,
  // so depending on it would re-run the effect the moment it is set and
  // fetch the image twice.
  const planRequested = useRef(false);
  useEffect(() => {
    if (!georeference || planRequested.current) return;
    planRequested.current = true;
    let cancelled = false;
    setPlanLoading(true);
    void (async () => {
      try {
        const draft = await loadMasterplanDraft(resortId);
        if (!cancelled && draft?.imageDataUrl) setPlanImage(draft.imageDataUrl);
      } catch {
        if (!cancelled) {
          setMessage({ kind: "error", text: "Couldn't load the master plan image." });
        }
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [georeference, resortId]);

  function change(next: Point[]) {
    setHistory((prev) => [...prev, points].slice(-60));
    setPoints(next);
    setMessage(null);
  }

  function undo() {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      setPoints(prev[prev.length - 1]);
      return prev.slice(0, -1);
    });
    setMessage(null);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await saveResortBoundary({ resortId, points });
      setMessage(
        result.error
          ? { kind: "error", text: result.error }
          : {
              kind: "ok",
              text: result.hectares
                ? `Boundary saved — ${result.hectares.toFixed(1)} hectares. Visitors see it now.`
                : "Boundary saved. Visitors see it now.",
            }
      );
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (
      !window.confirm(
        "Remove the traced boundary? Visitors go back to the shape worked out from where the homes are."
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await clearResortBoundary({ resortId });
      if (result.error) setMessage({ kind: "error", text: result.error });
      else {
        setPoints([]);
        setHistory([]);
        setMessage({ kind: "ok", text: "Traced boundary removed." });
      }
    } finally {
      setBusy(false);
    }
  }

  const ring = points.map((p) => [p.lat, p.lng] as [number, number]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || points.length < 3}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save boundary"}
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={history.length === 0}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800 disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => change([])}
          disabled={points.length === 0}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800 disabled:opacity-40"
        >
          Start again
        </button>
        {hasDrawnBoundary && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-40"
          >
            Remove traced boundary
          </button>
        )}

        {georeference && planImage && (
          <>
            <label className="flex items-center gap-1.5 text-sm text-neutral-800">
              <input
                type="checkbox"
                checked={showPlan}
                onChange={(e) => setShowPlan(e.target.checked)}
              />
              Master plan
            </label>
            {showPlan && (
              <label className="flex items-center gap-2 text-xs text-neutral-600">
                Fade
                <input
                  type="range"
                  min={0.15}
                  max={1}
                  step={0.05}
                  value={planOpacity}
                  onChange={(e) => setPlanOpacity(Number(e.target.value))}
                />
              </label>
            )}
          </>
        )}
        {planLoading && <span className="text-xs text-neutral-500">Loading the master plan…</span>}
      </div>

      <div className="flex min-h-[3.5rem] flex-col gap-1">
        <p className="text-sm text-neutral-700">
          {points.length === 0
            ? "Tap each corner of the resort's boundary, working around the perimeter. The shape closes itself."
            : `Tap to add the next corner, drag one to move it, or tap a corner to take it out. ${
                points.length
              } corner${points.length === 1 ? "" : "s"} so far${
                points.length < 3 ? " — three is the fewest that enclose anything." : "."
              }`}
        </p>
        <p className="text-xs" aria-live="polite">
          {message ? (
            <span className={message.kind === "ok" ? "text-green-700" : "text-red-600"}>
              {message.text}
            </span>
          ) : !hasDrawnBoundary && points.length > 0 ? (
            <span className="text-neutral-500">
              This is the shape worked out from where the homes are. Adjust it and
              save to replace it with the real perimeter.
            </span>
          ) : (
            <span>&nbsp;</span>
          )}
        </p>
      </div>

      {!georeference && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {planUnavailable === "not-calibrated"
            ? "The master plan hasn't been matched to the map, so it can't be shown here. You can still trace on satellite imagery."
            : "No master plan is saved for this resort, so you're tracing on satellite imagery."}
        </p>
      )}

      <div className="h-[70vh] w-full overflow-hidden rounded-md border border-neutral-200">
        <MapContainer
          center={[centerLat, centerLng]}
          zoom={defaultZoom}
          className="h-full w-full"
        >
          <BasemapTileLayer />
          {showPlan && planImage && georeference && planCalibration && (
            <PlanImageOverlay
              imageUrl={planImage}
              imageWidth={planCalibration.imageWidth}
              imageHeight={planCalibration.imageHeight}
              topLeft={georeference.topLeft}
              topRight={georeference.topRight}
              bottomLeft={georeference.bottomLeft}
              opacity={planOpacity}
            />
          )}

          <AddCornerOnClick onAdd={(lat, lng) => change([...points, { lat, lng }])} />

          {sites.map((site) => (
            <Marker
              key={site.id}
              position={[site.lat, site.lng]}
              icon={siteDivIcon(site.status)}
              opacity={0.45}
              interactive={false}
            />
          ))}

          {ring.length >= 3 ? (
            <Polygon
              positions={ring}
              interactive={false}
              pathOptions={{ color: "#702890", weight: 3, fillColor: "#702890", fillOpacity: 0.12 }}
            />
          ) : ring.length === 2 ? (
            <Polyline
              positions={ring}
              interactive={false}
              pathOptions={{ color: "#702890", weight: 3, dashArray: "6 5" }}
            />
          ) : null}

          {points.map((point, index) => (
            <Marker
              key={index}
              position={[point.lat, point.lng]}
              icon={cornerIcon(index === 0)}
              draggable
              eventHandlers={{
                dragend: (event) => {
                  const { lat, lng } = (event.target as L.Marker).getLatLng();
                  change(points.map((p, i) => (i === index ? { lat, lng } : p)));
                },
                click: () => {
                  // Tapping a corner removes it - the quickest fix for
                  // one dropped in the wrong place, and undo covers a
                  // removal made by accident.
                  change(points.filter((_, i) => i !== index));
                },
              }}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

function AddCornerOnClick({ onAdd }: { onAdd: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (event) => onAdd(event.latlng.lat, event.latlng.lng),
  });
  return null;
}
