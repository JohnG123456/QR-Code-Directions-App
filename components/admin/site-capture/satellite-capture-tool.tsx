"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, useMapEvents } from "react-leaflet";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { fixDefaultLeafletIcon } from "@/lib/map/fix-default-icon";
import { siteDivIcon, labelledSiteDivIcon } from "@/lib/map/site-icon";
import { findMissingSiteNumbers, summariseRanges } from "@/lib/sites/missing-site-numbers";
import { BasemapTileLayer } from "@/components/map/basemap-tile-layer";
import { PlanImageOverlay } from "@/components/map/plan-image-overlay";
import { georeferencePlan } from "@/lib/geo/plan-georeference";
import { loadMasterplanDraft } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/import-masterplan/actions";
import type { PointPair } from "@/lib/geo/similarity-transform";
import type { SiteStatus } from "@/lib/types";
import type { ActionState } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/sites/actions";
import "leaflet/dist/leaflet.css";

export interface CapturedSite {
  id: string;
  site_number: string;
  label: string | null;
  lat: number;
  lng: number;
  status: SiteStatus;
}

interface PendingPin {
  lat: number;
  lng: number;
}

// Drops a pin where the map is tapped - but not when the tap was really
// aimed at a popup.
//
// Pressing Save (or Cancel, or Delete) inside a popup also reaches the
// map underneath, which dropped a brand new unnamed pin exactly where you
// were working: the stray dots that had to be cleaned up afterwards, and
// a phantom extra "home captured" in the count.
//
// The check has to happen when the button is pressed, not when the click
// arrives. Leaflet delays the map click (it disambiguates taps on touch
// devices), so by the time it fires, the save has finished, React has
// unmounted the popup, and the event's target is an orphaned element
// whose ancestors no longer say it was ever in a popup.
function ClickToAdd({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const swallowNextClick = useRef(false);

  const map = useMapEvents({
    click(e) {
      if (swallowNextClick.current) {
        swallowNextClick.current = false;
        return;
      }
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });

  useEffect(() => {
    const container = map.getContainer();
    // Set on every press, so a popup press that never produces a map
    // click can't leave the flag armed and eat a later genuine tap.
    const onPointerDown = (event: Event) => {
      const target = event.target;
      swallowNextClick.current =
        target instanceof Element && target.closest(".leaflet-popup") !== null;
    };
    container.addEventListener("pointerdown", onPointerDown, true);
    return () => container.removeEventListener("pointerdown", onPointerDown, true);
  }, [map]);

  return null;
}

export function SatelliteCaptureTool({
  resortId,
  initialSites,
  totalHomes,
  centerLat,
  centerLng,
  defaultZoom,
  planCalibration,
  addSite,
  updateSiteLocation,
  deleteSite,
  setSiteStatus,
}: {
  resortId: string;
  initialSites: CapturedSite[];
  totalHomes: number | null;
  centerLat: number | null;
  centerLng: number | null;
  defaultZoom: number;
  planCalibration: {
    pairs: PointPair[];
    imageWidth: number;
    imageHeight: number;
  } | null;
  addSite: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  updateSiteLocation: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  deleteSite: (formData: FormData) => Promise<void>;
  setSiteStatus: (formData: FormData) => Promise<void>;
}) {
  const [sites, setSites] = useState<CapturedSite[]>(initialSites);
  const [pending, setPending] = useState<PendingPin | null>(null);
  const [newSiteNumber, setNewSiteNumber] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showNumbers, setShowNumbers] = useState(true);
  const [showMissing, setShowMissing] = useState(false);
  const [siteNumberToPlace, setSiteNumberToPlace] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [planOpacity, setPlanOpacity] = useState(0.6);
  const [planImage, setPlanImage] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const mapRef = useRef<LeafletMap | null>(null);
  const pendingMarkerRef = useRef<LeafletMarker | null>(null);

  // Open the number box as soon as a pin lands. Leaflet waits for a tap
  // on the marker otherwise, which just looks like a stray dot appeared -
  // and the dot is a smaller target than the map you just tapped.
  //
  // In an effect rather than the marker's ref callback: the popup binds
  // itself in its own effect, and children's effects run before the
  // parent's, so opening it from the ref sometimes lands too early and
  // does nothing.
  useEffect(() => {
    if (pending) pendingMarkerRef.current?.openPopup();
  }, [pending]);

  // The master plan, georeferenced by the calibration the import already
  // captured. Checking a number against the printed plan is the whole job
  // when the imagery is out of date or the roof is one of six identical
  // ones in a row.
  const georeference =
    planCalibration && centerLat !== null && centerLng !== null
      ? georeferencePlan(
          planCalibration.pairs,
          planCalibration.imageWidth,
          planCalibration.imageHeight,
          { lat: centerLat, lng: centerLng }
        )
      : null;

  // Fetched only when switched on: it's a couple of MB.
  function togglePlan(wanted: boolean) {
    setShowPlan(wanted);
    if (!wanted || planImage || planLoading || !georeference) return;
    setPlanLoading(true);
    setActionError(null);
    loadMasterplanDraft(resortId)
      .then((draft) => {
        if (draft?.imageDataUrl) setPlanImage(draft.imageDataUrl);
        else setActionError("There's no saved master plan image for this resort yet.");
      })
      .catch(() => setActionError("Couldn't load the master plan image."))
      .finally(() => setPlanLoading(false));
  }

  useEffect(() => {
    fixDefaultLeafletIcon();
  }, []);

  const initialCenter: [number, number] =
    sites.length > 0
      ? [sites[0].lat, sites[0].lng]
      : centerLat !== null && centerLng !== null
        ? [centerLat, centerLng]
        : [-31.9505, 115.8605];

  function handleMapReady(map: LeafletMap | null) {
    mapRef.current = map;
    if (map && sites.length > 1) {
      map.fitBounds(
        sites.map((s) => [s.lat, s.lng] as [number, number]),
        { padding: [50, 50] }
      );
    }
  }

  async function handleSaveNewSite() {
    if (!pending || !newSiteNumber.trim()) return;
    setIsSaving(true);
    setSaveError(null);

    const formData = new FormData();
    formData.set("resortId", resortId);
    formData.set("siteNumber", newSiteNumber.trim());
    formData.set("lat", String(pending.lat));
    formData.set("lng", String(pending.lng));

    const result = await addSite({}, formData);
    setIsSaving(false);

    if (result.error || !result.siteId) {
      setSaveError(result.error ?? "Saved, but the map couldn't track it — reload the page.");
      return;
    }

    setSites((prev) => [
      ...prev,
      {
        // The database's id, not an invented one: everything done to this
        // pin afterwards is addressed by it.
        id: result.siteId!,
        site_number: newSiteNumber.trim(),
        label: null,
        lat: pending.lat,
        lng: pending.lng,
        status: "draft",
      },
    ]);
    setPending(null);
    setNewSiteNumber("");
    setSiteNumberToPlace(null);
  }

  async function handleDragEnd(siteId: string, lat: number, lng: number) {
    const previous = sites;
    setSites((prev) => prev.map((s) => (s.id === siteId ? { ...s, lat, lng } : s)));

    const formData = new FormData();
    formData.set("siteId", siteId);
    formData.set("resortId", resortId);
    formData.set("lat", String(lat));
    formData.set("lng", String(lng));

    const result = await updateSiteLocation({}, formData);
    if (result.error) {
      // Put the pin back where it was and say so - a pin that springs
      // back with no explanation looks like the map is broken.
      setSites(previous);
      setActionError(result.error);
    }
  }

  async function handleDelete(siteId: string, siteNumber: string) {
    if (!confirm(`Delete site ${siteNumber}? The pin and the site both go.`)) return;
    const previous = sites;
    setActionError(null);
    setSites((prev) => prev.filter((s) => s.id !== siteId));

    const formData = new FormData();
    formData.set("siteId", siteId);
    formData.set("resortId", resortId);
    try {
      await deleteSite(formData);
    } catch {
      setSites(previous);
      setActionError(`Site ${siteNumber} couldn't be deleted — it's still there.`);
    }
  }

  async function handleStatusChange(siteId: string, status: SiteStatus) {
    const previous = sites;
    setSites((prev) => prev.map((s) => (s.id === siteId ? { ...s, status } : s)));

    const formData = new FormData();
    formData.set("siteId", siteId);
    formData.set("resortId", resortId);
    formData.set("status", status);
    try {
      await setSiteStatus(formData);
    } catch {
      setSites(previous);
      setActionError("That status change didn't save.");
    }
  }

  function handleSearch() {
    const match = sites.find(
      (s) => s.site_number.toLowerCase() === searchTerm.trim().toLowerCase()
    );
    if (match && mapRef.current) {
      mapRef.current.flyTo([match.lat, match.lng], 21);
    }
  }

  const missingSummary = findMissingSiteNumbers(
    sites.map((s) => s.site_number),
    totalHomes
  );

  const progressLabel = totalHomes
    ? `${sites.length} of ${totalHomes} homes captured`
    : `${sites.length} homes captured`;
  const progressPct = totalHomes ? Math.min(100, (sites.length / totalHomes) * 100) : null;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-48 flex-1">
          <p className="text-sm font-medium">{progressLabel}</p>
          {progressPct !== null && (
            <div className="mt-1 h-2 w-full max-w-xs rounded-full bg-neutral-100">
              <div
                className="h-2 rounded-full bg-green-600"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Jump to site #"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={handleSearch}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50"
          >
            Go
          </button>
          <button
            type="button"
            onClick={() =>
              sites.length > 0 &&
              mapRef.current?.fitBounds(
                sites.map((s) => [s.lat, s.lng] as [number, number]),
                { padding: [50, 50] }
              )
            }
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50"
          >
            Fit to all sites
          </button>
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm">
            <input
              type="checkbox"
              checked={showNumbers}
              onChange={(e) => setShowNumbers(e.target.checked)}
            />
            Numbers
          </label>
          {georeference && (
            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm">
              <input
                type="checkbox"
                checked={showPlan}
                onChange={(e) => togglePlan(e.target.checked)}
              />
              Master plan
            </label>
          )}
          {showPlan && planImage && (
            <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-neutral-500">
              Fade
              <input
                type="range"
                min={0.15}
                max={1}
                step={0.05}
                value={planOpacity}
                onChange={(e) => setPlanOpacity(Number(e.target.value))}
                className="w-20"
              />
            </label>
          )}
        </div>
      </div>

      {planLoading && (
        <p className="text-xs text-neutral-500">Loading the master plan image…</p>
      )}

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>
      )}

      {/* The unsaved pin can lose its popup with one stray tap, and until
          now the only way to get rid of it was to find the popup again.
          A pin you can't put down is alarming when you're not sure
          whether it saved. */}
      {pending && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            Unsaved pin dropped{newSiteNumber.trim() ? ` for site ${newSiteNumber.trim()}` : ""}.
            Tap it to enter a number, or remove it.
          </span>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              setNewSiteNumber("");
              setSaveError(null);
            }}
            className="rounded-md border border-amber-400 bg-white px-2 py-1 text-xs font-medium"
          >
            Remove pin
          </button>
        </div>
      )}

      {missingSummary.missing.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <button
            type="button"
            onClick={() => setShowMissing((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-amber-900"
          >
            <span>
              {missingSummary.missing.length} site number
              {missingSummary.missing.length === 1 ? "" : "s"} still to capture
              (checked 1-{missingSummary.upTo})
            </span>
            <span aria-hidden>{showMissing ? "-" : "+"}</span>
          </button>

          {showMissing && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs text-amber-900">
                Tap a number to load it, then tap its spot on the map.
              </p>
              <div className="flex max-h-32 flex-wrap gap-1 overflow-auto">
                {missingSummary.missing.map((number) => (
                  <button
                    key={number}
                    type="button"
                    onClick={() => setSiteNumberToPlace(number)}
                    className={
                      siteNumberToPlace === number
                        ? "rounded bg-amber-600 px-1.5 py-0.5 text-xs font-medium text-white"
                        : "rounded bg-white px-1.5 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
                    }
                  >
                    {number}
                  </button>
                ))}
              </div>
              <p className="break-words text-xs text-amber-800">
                Gaps: {summariseRanges(missingSummary.missing).join(", ")}
              </p>
              {missingSummary.ignored.length > 0 && (
                <p className="break-words text-xs text-amber-800">
                  Not included in this check (not plain numbers):{" "}
                  {missingSummary.ignored.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-neutral-500">
        {siteNumberToPlace
          ? `Site ${siteNumberToPlace} loaded — tap its position on the map.`
          : "Tap the imagery to drop a pin for a new site. Tap an existing pin to change its status or delete it, or drag it to correct its position. Amber = draft, green = active, gray = inactive."}
      </p>

      <div className="flex-1 overflow-hidden rounded-md border border-neutral-300">
        <MapContainer
          center={initialCenter}
          zoom={sites.length > 0 ? defaultZoom : defaultZoom - 2}
          className="h-full w-full"
          ref={handleMapReady}
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

          <ClickToAdd
            onPick={(lat, lng) => {
              setPending({ lat, lng });
              // If staff picked one of the outstanding numbers from the
              // panel, use it rather than making them retype it.
              if (siteNumberToPlace) setNewSiteNumber(siteNumberToPlace);
              setSaveError(null);
            }}
          />

          {sites.map((site) => (
            <Marker
              key={site.id}
              position={[site.lat, site.lng]}
              icon={
                showNumbers
                  ? labelledSiteDivIcon(site.status, site.site_number)
                  : siteDivIcon(site.status)
              }
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const latlng = e.target.getLatLng();
                  handleDragEnd(site.id, latlng.lat, latlng.lng);
                },
              }}
            >
              <Popup>
                <div className="flex flex-col gap-2 text-sm">
                  <strong>Site {site.site_number}</strong>
                  <label className="flex flex-col gap-1">
                    Status
                    <select
                      value={site.status}
                      onChange={(e) =>
                        handleStatusChange(site.id, e.target.value as SiteStatus)
                      }
                      className="rounded border border-neutral-300 px-1 py-0.5"
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleDelete(site.id, site.site_number)}
                    className="text-left text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}

          {pending && (
            <Marker
              position={[pending.lat, pending.lng]}
              icon={siteDivIcon("draft", true)}
              ref={(marker) => {
                pendingMarkerRef.current = marker;
              }}
            >
              <Popup autoClose={false} closeOnClick={false}>
                <div className="flex flex-col gap-2 text-sm">
                  <label className="flex flex-col gap-1">
                    Site number
                    <input
                      autoFocus
                      value={newSiteNumber}
                      onChange={(e) => setNewSiteNumber(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveNewSite()}
                      className="rounded border border-neutral-300 px-1 py-0.5"
                    />
                  </label>
                  {saveError && <p className="text-red-600">{saveError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isSaving || !newSiteNumber.trim()}
                      onClick={handleSaveNewSite}
                      className="rounded bg-neutral-900 px-2 py-1 text-white disabled:opacity-50"
                    >
                      {isSaving ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPending(null);
                        setSaveError(null);
                      }}
                      className="rounded border border-neutral-300 px-2 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  );
}
