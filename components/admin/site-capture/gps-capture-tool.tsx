"use client";

import { useState } from "react";
import type { ActionState } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/sites/actions";

interface CapturedSite {
  siteNumber: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  capturedAt: string;
}

const ACCURACY_WARNING_THRESHOLD_M = 15;

function nextSiteNumber(last: string): string {
  const match = last.match(/^(\D*)(\d+)(\D*)$/);
  if (!match) return "";
  const [, prefix, digits, suffix] = match;
  const next = (parseInt(digits, 10) + 1).toString().padStart(digits.length, "0");
  return `${prefix}${next}${suffix}`;
}

export function GpsCaptureTool({
  resortId,
  addSite,
}: {
  resortId: string;
  addSite: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [captured, setCaptured] = useState<CapturedSite[]>([]);
  const [siteNumber, setSiteNumber] = useState("");
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<ActionState>({});
  const [isSaving, setIsSaving] = useState(false);

  function handleLocate() {
    if (!navigator.geolocation) {
      setGeoError("This device/browser doesn't support GPS location.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition(pos);
        setLocating(false);
      },
      (err) => {
        setGeoError(err.message);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function handleSubmit(formData: FormData) {
    if (!position) return;
    setIsSaving(true);
    const result = await addSite({}, formData);
    setSaveState(result);
    setIsSaving(false);
    if (!result.error) {
      setCaptured((prev) => [
        {
          siteNumber,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
      setSiteNumber(nextSiteNumber(siteNumber));
      setPosition(null);
    }
  }

  const accuracy = position?.coords.accuracy ?? null;
  const poorAccuracy = accuracy !== null && accuracy > ACCURACY_WARNING_THRESHOLD_M;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-neutral-200 p-4">
        <button
          type="button"
          onClick={handleLocate}
          disabled={locating}
          className="w-full rounded-md bg-neutral-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {locating ? "Getting location..." : "1. Get current location"}
        </button>

        {geoError && <p className="mt-2 text-sm text-red-600">{geoError}</p>}

        {position && (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm">
              Accuracy: ±{Math.round(accuracy ?? 0)} m
              {poorAccuracy && (
                <span className="ml-2 text-amber-600">
                  Low accuracy — move to open sky and retry for a better fix.
                </span>
              )}
            </p>

            <form action={handleSubmit} className="flex items-end gap-2">
              <input type="hidden" name="resortId" value={resortId} />
              <input type="hidden" name="lat" value={position.coords.latitude} />
              <input type="hidden" name="lng" value={position.coords.longitude} />
              <input type="hidden" name="accuracy" value={position.coords.accuracy} />
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Site number
                <input
                  name="siteNumber"
                  required
                  autoFocus
                  value={siteNumber}
                  onChange={(e) => setSiteNumber(e.target.value)}
                  className="rounded-md border border-neutral-300 px-3 py-2"
                />
              </label>
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                2. Save site
              </button>
            </form>
            {saveState.error && <p className="text-sm text-red-600">{saveState.error}</p>}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">
          Captured this session ({captured.length})
        </h2>
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 text-sm">
          {captured.map((site, i) => (
            <li key={i} className="flex justify-between px-3 py-2">
              <span className="font-medium">Site {site.siteNumber}</span>
              <span className="text-neutral-500">
                {site.capturedAt} · ±{Math.round(site.accuracy ?? 0)}m
              </span>
            </li>
          ))}
          {captured.length === 0 && (
            <li className="px-3 py-4 text-center text-neutral-500">
              Nothing captured yet.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
