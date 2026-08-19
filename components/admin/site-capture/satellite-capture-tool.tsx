"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, useMapEvents } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { fixDefaultLeafletIcon } from "@/lib/map/fix-default-icon";
import { siteDivIcon } from "@/lib/map/site-icon";
import { BasemapTileLayer } from "@/components/map/basemap-tile-layer";
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

function ClickToAdd({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function SatelliteCaptureTool({
  resortId,
  initialSites,
  totalHomes,
  centerLat,
  centerLng,
  defaultZoom,
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
  const mapRef = useRef<LeafletMap | null>(null);

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

    if (result.error) {
      setSaveError(result.error);
      return;
    }

    setSites((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        site_number: newSiteNumber.trim(),
        label: null,
        lat: pending.lat,
        lng: pending.lng,
        status: "draft",
      },
    ]);
    setPending(null);
    setNewSiteNumber("");
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
      setSites(previous); // revert on failure
    }
  }

  async function handleDelete(siteId: string) {
    if (!confirm("Delete this site?")) return;
    const previous = sites;
    setSites((prev) => prev.filter((s) => s.id !== siteId));

    const formData = new FormData();
    formData.set("siteId", siteId);
    formData.set("resortId", resortId);
    try {
      await deleteSite(formData);
    } catch {
      setSites(previous);
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
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        Click anywhere on the imagery to drop a pin for a new site. Drag an
        existing pin to correct its position. Amber = draft, green = active,
        gray = inactive.
      </p>

      <div className="flex-1 overflow-hidden rounded-md border border-neutral-300">
        <MapContainer
          center={initialCenter}
          zoom={sites.length > 0 ? defaultZoom : defaultZoom - 2}
          className="h-full w-full"
          ref={handleMapReady}
        >
          <BasemapTileLayer />
          <ClickToAdd onPick={(lat, lng) => setPending({ lat, lng })} />

          {sites.map((site) => (
            <Marker
              key={site.id}
              position={[site.lat, site.lng]}
              icon={siteDivIcon(site.status)}
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
                    onClick={() => handleDelete(site.id)}
                    className="text-left text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}

          {pending && (
            <Marker position={[pending.lat, pending.lng]} icon={siteDivIcon("draft", true)}>
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
