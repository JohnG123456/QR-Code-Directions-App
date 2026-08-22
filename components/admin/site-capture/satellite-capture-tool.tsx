"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
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

// One step of history, holding whatever is needed to put things back.
//
// Pins are draggable so positions can be corrected, which means a pinch
// to zoom that lands slightly off nudges a house across the map instead -
// easy to do on a phone, and easy not to notice until much later.
type UndoEntry =
  | { kind: "move"; siteId: string; siteNumber: string; lat: number; lng: number }
  | { kind: "add"; siteId: string; siteNumber: string }
  | { kind: "delete"; site: CapturedSite }
  | { kind: "status"; siteId: string; siteNumber: string; status: SiteStatus };

const UNDO_LIMIT = 25;
const PINS_LOCKED_KEY = "capture-pins-locked";

/** Which site a step refers to, whatever kind of step it is. */
function undoTarget(entry: UndoEntry): string {
  return entry.kind === "delete" ? entry.site.id : entry.siteId;
}

function describeUndo(entry: UndoEntry): string {
  switch (entry.kind) {
    case "move":
      return `move of ${entry.siteNumber}`;
    case "add":
      return `adding ${entry.siteNumber}`;
    case "delete":
      return `deleting ${entry.site.site_number}`;
    case "status":
      return `status of ${entry.siteNumber}`;
  }
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
// Says why the master plan can't be laid over the imagery. Hiding the
// control and saying nothing left no way to tell an un-run migration from
// a plan that was never uploaded.
function PlanOverlayNote({
  reason,
  resortId,
}: {
  reason: "not-migrated" | "no-plan" | "not-calibrated";
  resortId: string;
}) {
  // Deliberately quiet, not a warning. The captured sites on the map have
  // nothing to do with this, and an amber panel saying "no master plan is
  // saved" above a map covered in pins reads as "your work is missing".
  const shell =
    "rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600";

  if (reason === "not-migrated") {
    return (
      <p className={shell}>
        <strong>Optional backdrop unavailable.</strong> The plan drawing
        can&apos;t be laid over the imagery yet: the database is missing the
        table that holds it. Run{" "}
        <code>supabase/migrations/0002_masterplan_drafts.sql</code> in the
        Supabase SQL editor. Your captured sites aren&apos;t affected.
      </p>
    );
  }

  if (reason === "not-calibrated") {
    return (
      <p className={shell}>
        <strong>Optional backdrop unavailable.</strong> A plan drawing is
        saved for this resort but was never matched to the map, so there&apos;s
        nowhere to put it. Add at least two reference points in{" "}
        <a href={`/admin/resorts/${resortId}/import-masterplan`} className="underline">
          Import from master plan
        </a>
        . Your captured sites aren&apos;t affected.
      </p>
    );
  }

  return (
    <p className={shell}>
      <strong>Optional backdrop unavailable.</strong> The plan <em>drawing</em>
      {" "}
      isn&apos;t saved to your account, so it can&apos;t be shown underneath
      these pins. This is only about the drawing — your captured sites are
      safe. To add it, open{" "}
      <a href={`/admin/resorts/${resortId}/import-masterplan`} className="underline">
        Import from master plan
      </a>{" "}
      and either save the draft already on this device to your account, or
      upload the PDF once. Either way you don&apos;t have to import the sites
      again.
    </p>
  );
}

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

// Frames the resort once, when the map first has sites to show.
//
// This used to live in the map's ref callback, which is the bug behind
// the view snapping back: a ref callback declared inline is a new
// function every render, so React detached and reattached it each time
// and re-ran the fit. Saving a pin, deleting one, ticking Numbers, even
// typing a character in the "jump to site" box threw the view back out
// to the whole resort - far too small to work at with a few hundred
// homes on it.
//
// It lives inside the map rather than beside it because useMap() is
// guaranteed to have the map instance; the parent's ref isn't set yet
// when the parent's own effects first run, so the fit would be skipped at
// mount and then fire on the first edit instead - which looked identical
// to the original bug.
function FitToAllSitesOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || points.length < 2) return;
    done.current = true;
    map.fitBounds(points, { padding: [50, 50] });
  }, [map, points]);

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
  planUnavailable,
  addSite,
  updateSiteLocation,
  deleteSite,
  restoreSite,
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
  /** Why there's no overlay to offer, when there isn't. */
  planUnavailable: "not-migrated" | "no-plan" | "not-calibrated" | null;
  addSite: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  updateSiteLocation: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  deleteSite: (formData: FormData) => Promise<void>;
  restoreSite: (input: {
    resortId: string;
    siteNumber: string;
    label: string | null;
    status: SiteStatus;
    lat: number;
    lng: number;
  }) => Promise<ActionState>;
  setSiteStatus: (formData: FormData) => Promise<void>;
}) {
  const [sites, setSites] = useState<CapturedSite[]>(initialSites);
  const [pending, setPending] = useState<PendingPin | null>(null);
  const [newSiteNumber, setNewSiteNumber] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showNumbers, setShowNumbers] = useState(true);
  // Locked by default: reviewing and zooming is most of the work, and an
  // accidental nudge is silent - the pin just ends up somewhere slightly
  // wrong, which is exactly the kind of error this tool exists to find.
  // Moving a pin is the rarer, deliberate act, so it's the one that asks
  // for a tick.
  const [pinsLocked, setPinsLocked] = useState<boolean>(() => {
    // Remembered per browser. Wrapped because storage can be unavailable
    // (private browsing, blocked site data) and a missing preference must
    // not stop the tool loading.
    try {
      return window.localStorage.getItem(PINS_LOCKED_KEY) !== "false";
    } catch {
      return true;
    }
  });

  function togglePinsLocked(locked: boolean) {
    setPinsLocked(locked);
    try {
      window.localStorage.setItem(PINS_LOCKED_KEY, String(locked));
    } catch {
      // A preference that can't be remembered still works for this sitting.
    }
  }
  const [showMissing, setShowMissing] = useState(false);
  const [siteNumberToPlace, setSiteNumberToPlace] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [isUndoing, setIsUndoing] = useState(false);
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
    pushUndo({
      kind: "add",
      siteId: result.siteId,
      siteNumber: newSiteNumber.trim(),
    });
    setPending(null);
    setNewSiteNumber("");
    setSiteNumberToPlace(null);
  }

  function pushUndo(entry: UndoEntry) {
    setUndoStack((prev) => [...prev, entry].slice(-UNDO_LIMIT));
  }

  async function handleDragEnd(siteId: string, lat: number, lng: number) {
    const previous = sites;
    const before = previous.find((s) => s.id === siteId);
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
      return;
    }
    if (before) {
      pushUndo({
        kind: "move",
        siteId,
        siteNumber: before.site_number,
        lat: before.lat,
        lng: before.lng,
      });
    }
  }

  async function handleDelete(siteId: string, siteNumber: string) {
    if (!confirm(`Delete site ${siteNumber}? The pin and the site both go.`)) return;
    const previous = sites;
    const removed = previous.find((s) => s.id === siteId);
    setActionError(null);
    setSites((prev) => prev.filter((s) => s.id !== siteId));

    const formData = new FormData();
    formData.set("siteId", siteId);
    formData.set("resortId", resortId);
    try {
      await deleteSite(formData);
      if (removed) pushUndo({ kind: "delete", site: removed });
    } catch {
      setSites(previous);
      setActionError(`Site ${siteNumber} couldn't be deleted — it's still there.`);
    }
  }

  async function handleStatusChange(siteId: string, status: SiteStatus) {
    const previous = sites;
    const before = previous.find((s) => s.id === siteId);
    setSites((prev) => prev.map((s) => (s.id === siteId ? { ...s, status } : s)));

    const formData = new FormData();
    formData.set("siteId", siteId);
    formData.set("resortId", resortId);
    formData.set("status", status);
    try {
      await setSiteStatus(formData);
      if (before) {
        pushUndo({
          kind: "status",
          siteId,
          siteNumber: before.site_number,
          status: before.status,
        });
      }
    } catch {
      setSites(previous);
      setActionError("That status change didn't save.");
    }
  }

  // Reverses the last change. Each step is undone against the database
  // too, not just on screen - the point is to put right something that
  // was already saved.
  async function handleUndo() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;

    setIsUndoing(true);
    setActionError(null);
    setUndoStack((prev) => prev.slice(0, -1));

    // Undo failures put the step back on the stack: better to be able to
    // try again than to lose the only record of what happened.
    const failed = (message: string) => {
      setActionError(message);
      setUndoStack((prev) => [...prev, entry]);
    };

    try {
      if (entry.kind === "move") {
        const formData = new FormData();
        formData.set("siteId", entry.siteId);
        formData.set("resortId", resortId);
        formData.set("lat", String(entry.lat));
        formData.set("lng", String(entry.lng));
        const result = await updateSiteLocation({}, formData);
        if (result.error) {
          failed(result.error);
        } else {
          setSites((prev) =>
            prev.map((s) =>
              s.id === entry.siteId ? { ...s, lat: entry.lat, lng: entry.lng } : s
            )
          );
        }
      } else if (entry.kind === "add") {
        const formData = new FormData();
        formData.set("siteId", entry.siteId);
        formData.set("resortId", resortId);
        await deleteSite(formData);
        setSites((prev) => prev.filter((s) => s.id !== entry.siteId));
        // Anything earlier in the history about a row that no longer
        // exists can never be undone, so drop it rather than leave a step
        // that fails every time it's reached.
        setUndoStack((prev) => prev.filter((e) => undoTarget(e) !== entry.siteId));
      } else if (entry.kind === "delete") {
        const result = await restoreSite({
          resortId,
          siteNumber: entry.site.site_number,
          label: entry.site.label,
          status: entry.site.status,
          lat: entry.site.lat,
          lng: entry.site.lng,
        });
        if (result.error || !result.siteId) {
          failed(result.error ?? "Couldn't put that site back.");
        } else {
          // A restored row is a new row, so the map takes the new id -
          // and so does any earlier step in the history that referred to
          // the old one, which would otherwise fail on a row that's gone.
          const newId = result.siteId;
          setSites((prev) => [...prev, { ...entry.site, id: newId }]);
          setUndoStack((prev) =>
            prev.map((e) =>
              e.kind !== "delete" && e.siteId === entry.site.id ? { ...e, siteId: newId } : e
            )
          );
        }
      } else {
        const formData = new FormData();
        formData.set("siteId", entry.siteId);
        formData.set("resortId", resortId);
        formData.set("status", entry.status);
        await setSiteStatus(formData);
        setSites((prev) =>
          prev.map((s) => (s.id === entry.siteId ? { ...s, status: entry.status } : s))
        );
      }
    } catch {
      failed("That couldn't be undone — check your connection and try again.");
    } finally {
      setIsUndoing(false);
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
        <div className="flex flex-wrap items-center gap-2">
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
            className="shrink-0 whitespace-nowrap rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50"
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
            className="shrink-0 whitespace-nowrap rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50"
          >
            Fit to all sites
          </button>
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0 || isUndoing}
            className="shrink-0 whitespace-nowrap rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 disabled:opacity-40"
          >
            {isUndoing
              ? "Undoing…"
              : undoStack.length > 0
                ? `Undo ${describeUndo(undoStack[undoStack.length - 1])}`
                : "Undo"}
          </button>
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm">
            <input
              type="checkbox"
              checked={showNumbers}
              onChange={(e) => setShowNumbers(e.target.checked)}
            />
            Numbers
          </label>
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm">
            <input
              type="checkbox"
              checked={pinsLocked}
              onChange={(e) => togglePinsLocked(e.target.checked)}
            />
            Lock pins
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

      {planUnavailable && <PlanOverlayNote reason={planUnavailable} resortId={resortId} />}

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
          : pinsLocked
            ? "Tap the imagery to drop a pin for a new site. Tap an existing pin to change its status or delete it. Pins are locked so they can't be nudged while you pan and zoom — untick Lock pins to move one. Amber = draft, green = active, gray = inactive."
            : "Pins are unlocked: drag one to correct its position. Tap the imagery to drop a pin for a new site, or tap an existing pin to change its status or delete it. Amber = draft, green = active, gray = inactive."}
      </p>

      <div className="flex-1 overflow-hidden rounded-md border border-neutral-300">
        <MapContainer
          center={initialCenter}
          zoom={sites.length > 0 ? defaultZoom : defaultZoom - 2}
          className="h-full w-full"
          ref={mapRef}
        >
          <BasemapTileLayer />

          <FitToAllSitesOnce
            points={sites.map((s) => [s.lat, s.lng] as [number, number])}
          />

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
              draggable={!pinsLocked}
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
                  {pinsLocked && (
                    <button
                      type="button"
                      onClick={() => togglePinsLocked(false)}
                      className="text-left text-neutral-500 underline"
                    >
                      Locked — unlock to drag pins
                    </button>
                  )}
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
