"use client";

import { useRef, useState } from "react";
import { MapContainer, Marker, useMapEvents } from "react-leaflet";
import type { ExtractedPlan, ExtractedLabel } from "@/lib/masterplan/extract-labels-server";
import { fitSimilarityTransform, type PointPair } from "@/lib/geo/similarity-transform";
import { toLocalMeters, fromLocalMeters } from "@/lib/geo/local-projection";
import { siteDivIcon } from "@/lib/map/site-icon";
import { BasemapTileLayer } from "@/components/map/basemap-tile-layer";
import type { ImportResult } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/sites/actions";
import "leaflet/dist/leaflet.css";

type Step = "upload" | "review" | "calibrate" | "preview" | "done";

interface ComputedSite {
  id: string;
  siteNumber: string;
  lat: number;
  lng: number;
  included: boolean;
}

function relativeClickPosition(
  e: React.MouseEvent<HTMLElement>,
  imageWidth: number,
  imageHeight: number
) {
  const rect = e.currentTarget.getBoundingClientRect();
  const pctX = (e.clientX - rect.left) / rect.width;
  const pctY = (e.clientY - rect.top) / rect.height;
  return { x: pctX * imageWidth, y: pctY * imageHeight };
}

export function MasterplanImportTool({
  resortId,
  centerLat,
  centerLng,
  defaultZoom,
  bulkUpsertSites,
}: {
  resortId: string;
  centerLat: number | null;
  centerLng: number | null;
  defaultZoom: number;
  bulkUpsertSites: (resortId: string, rows: Record<string, string>[]) => Promise<ImportResult>;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ExtractedPlan | null>(null);
  const [labels, setLabels] = useState<ExtractedLabel[]>([]);
  const [pendingNewLabel, setPendingNewLabel] = useState<{ x: number; y: number } | null>(null);
  const [newLabelText, setNewLabelText] = useState("");

  const [pairs, setPairs] = useState<PointPair[]>([]);
  const [pendingPlanPoint, setPendingPlanPoint] = useState<{ x: number; y: number } | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  const [computedSites, setComputedSites] = useState<ComputedSite[]>([]);
  const [fitStats, setFitStats] = useState<{ rms: number; max: number } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (centerLat === null || centerLng === null) {
    return (
      <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This resort doesn&apos;t have a reference point set yet. Set one first
        under the resort&apos;s Settings (used as the anchor for converting the
        plan into real coordinates).
      </p>
    );
  }
  const reference = { lat: centerLat, lng: centerLng };

  async function handleFileSelected(file: File) {
    setIsParsing(true);
    setParseError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(`/api/resorts/${resortId}/masterplan/extract`, {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Couldn't read that PDF.");
      }
      setPlan(result as ExtractedPlan);
      setLabels((result as ExtractedPlan).labels);
      setStep("review");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't read that PDF.");
    } finally {
      setIsParsing(false);
    }
  }

  function handleReviewImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!plan) return;
    const pos = relativeClickPosition(e, plan.imageWidth, plan.imageHeight);
    setPendingNewLabel(pos);
    setNewLabelText("");
  }

  function confirmNewLabel() {
    if (!pendingNewLabel || !newLabelText.trim()) return;
    setLabels((prev) => [
      ...prev,
      { id: `manual-${Date.now()}`, text: newLabelText.trim(), ...pendingNewLabel },
    ]);
    setPendingNewLabel(null);
    setNewLabelText("");
  }

  function removeLabel(id: string) {
    setLabels((prev) => prev.filter((l) => l.id !== id));
  }

  function handleCalibratePlanClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!plan) return;
    setPendingPlanPoint(relativeClickPosition(e, plan.imageWidth, plan.imageHeight));
  }

  function handleCalibrateMapClick(lat: number, lng: number) {
    if (!pendingPlanPoint) return;
    const world = toLocalMeters({ lat, lng }, reference);
    setPairs((prev) => [...prev, { plan: pendingPlanPoint, world }]);
    setPendingPlanPoint(null);
  }

  function removePair(index: number) {
    setPairs((prev) => prev.filter((_, i) => i !== index));
  }

  function computePreview() {
    setCalibrationError(null);
    try {
      const fit = fitSimilarityTransform(pairs);
      setFitStats({ rms: fit.rmsErrorMeters, max: fit.maxErrorMeters });

      const sites: ComputedSite[] = labels.map((label) => {
        const worldXY = fit.transform.apply({ x: label.x, y: label.y });
        const latLng = fromLocalMeters(worldXY, reference);
        return {
          id: label.id,
          siteNumber: label.text,
          lat: latLng.lat,
          lng: latLng.lng,
          included: true,
        };
      });
      setComputedSites(sites);
      setStep("preview");
    } catch (err) {
      setCalibrationError(err instanceof Error ? err.message : "Couldn't fit a transform.");
    }
  }

  function toggleIncluded(id: string) {
    setComputedSites((prev) =>
      prev.map((s) => (s.id === id ? { ...s, included: !s.included } : s))
    );
  }

  async function handleImport() {
    setIsImporting(true);
    const rows = computedSites
      .filter((s) => s.included)
      .map((s) => ({
        site_number: s.siteNumber,
        latitude: String(s.lat),
        longitude: String(s.lng),
      }));
    const result = await bulkUpsertSites(resortId, rows);
    setImportResult(result);
    setIsImporting(false);
    setStep("done");
  }

  const includedCount = computedSites.filter((s) => s.included).length;

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator step={step} />

      {step === "upload" && (
        <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
          <p className="text-sm text-neutral-600">
            Upload the resort&apos;s master plan PDF. It&apos;ll be scanned for
            site numbers, which you&apos;ll then review and calibrate against
            the satellite map.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
            className="text-sm"
          />
          {isParsing && <p className="text-sm text-neutral-500">Reading PDF...</p>}
          {parseError && <p className="text-sm text-red-600">{parseError}</p>}
        </div>
      )}

      {step === "review" && plan && (
        <div className="flex flex-col gap-3">
          {plan.extractionError ? (
            <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Automatic site-number detection didn&apos;t work on this
              device, but the plan rendered fine — click each site&apos;s
              position below and type in its number to add it manually.
            </p>
          ) : (
            <p className="text-sm text-neutral-600">
              Found <strong>{labels.length}</strong> candidate site numbers.
              Click a marker to remove a false positive (dates, scale, project
              numbers etc. sometimes get picked up); click a blank spot to add
              one that was missed.
            </p>
          )}
          <div
            className="relative inline-block w-full cursor-crosshair overflow-hidden rounded-md border border-neutral-300"
            onClick={handleReviewImageClick}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={plan.imageDataUrl} alt="Master plan" className="block w-full" />
            {labels.map((label) => (
              <button
                key={label.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeLabel(label.id);
                }}
                title="Click to remove"
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-blue-600/90 px-1 text-[10px] font-medium leading-tight text-white hover:bg-red-600"
                style={{
                  left: `${(label.x / plan.imageWidth) * 100}%`,
                  top: `${(label.y / plan.imageHeight) * 100}%`,
                }}
              >
                {label.text}
              </button>
            ))}
            {pendingNewLabel && (
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-white p-1 shadow-lg"
                style={{
                  left: `${(pendingNewLabel.x / plan.imageWidth) * 100}%`,
                  top: `${(pendingNewLabel.y / plan.imageHeight) * 100}%`,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={newLabelText}
                  onChange={(e) => setNewLabelText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirmNewLabel()}
                  placeholder="Site #"
                  className="w-16 rounded border border-neutral-300 px-1 py-0.5 text-xs"
                />
                <button
                  type="button"
                  onClick={confirmNewLabel}
                  className="ml-1 rounded bg-neutral-900 px-1.5 py-0.5 text-xs text-white"
                >
                  Add
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setStep("calibrate")}
            disabled={labels.length === 0}
            className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Continue to calibration ({labels.length} sites)
          </button>
        </div>
      )}

      {step === "calibrate" && plan && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-600">
            Click a distinctive point on the plan (a corner, an intersection),
            then click the <em>same</em> real point on the satellite map. Do
            this for at least 2 points spread across the site - more points
            improve accuracy.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-500">Plan</p>
              <div
                className="relative inline-block w-full cursor-crosshair overflow-hidden rounded-md border border-neutral-300"
                onClick={handleCalibratePlanClick}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={plan.imageDataUrl} alt="Master plan" className="block w-full" />
                {pairs.map((pair, i) => (
                  <div
                    key={i}
                    className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white"
                    style={{
                      left: `${(pair.plan.x / plan.imageWidth) * 100}%`,
                      top: `${(pair.plan.y / plan.imageHeight) * 100}%`,
                    }}
                  >
                    {i + 1}
                  </div>
                ))}
                {pendingPlanPoint && (
                  <div
                    className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white"
                    style={{
                      left: `${(pendingPlanPoint.x / plan.imageWidth) * 100}%`,
                      top: `${(pendingPlanPoint.y / plan.imageHeight) * 100}%`,
                    }}
                  >
                    ?
                  </div>
                )}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-neutral-500">
                Satellite map {pendingPlanPoint ? "- click the matching point" : ""}
              </p>
              <div className="h-80 overflow-hidden rounded-md border border-neutral-300">
                <CalibrationMap
                  centerLat={centerLat}
                  centerLng={centerLng}
                  defaultZoom={defaultZoom}
                  onPick={handleCalibrateMapClick}
                />
              </div>
            </div>
          </div>

          {pairs.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-neutral-200 p-2 text-sm">
              {pairs.map((_, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span>Reference point {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => removePair(i)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {calibrationError && <p className="text-sm text-red-600">{calibrationError}</p>}

          <button
            type="button"
            onClick={computePreview}
            disabled={pairs.length < 2}
            className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Compute positions ({pairs.length} reference point{pairs.length === 1 ? "" : "s"})
          </button>
        </div>
      )}

      {step === "preview" && (
        <div className="flex flex-col gap-3">
          {fitStats && (
            <p className="text-sm text-neutral-600">
              Calibration fit: average error{" "}
              <strong>{fitStats.rms.toFixed(1)} m</strong>, worst point{" "}
              <strong>{fitStats.max.toFixed(1)} m</strong>.{" "}
              {fitStats.rms > 5 && (
                <span className="text-amber-600">
                  That&apos;s a fairly loose fit - consider going back and
                  adding a couple more spread-out reference points.
                </span>
              )}
            </p>
          )}
          <div className="h-96 overflow-hidden rounded-md border border-neutral-300">
            <PreviewMap
              centerLat={centerLat}
              centerLng={centerLng}
              defaultZoom={defaultZoom}
              sites={computedSites}
            />
          </div>
          <div className="max-h-64 overflow-auto rounded-md border border-neutral-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-neutral-200 bg-neutral-50">
                <tr>
                  <th className="px-3 py-2">Include</th>
                  <th className="px-3 py-2">Site #</th>
                  <th className="px-3 py-2">Lat</th>
                  <th className="px-3 py-2">Lng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {computedSites.map((site) => (
                  <tr key={site.id} className={site.included ? undefined : "opacity-40"}>
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={site.included}
                        onChange={() => toggleIncluded(site.id)}
                      />
                    </td>
                    <td className="px-3 py-1.5">{site.siteNumber}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{site.lat.toFixed(6)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{site.lng.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("calibrate")}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
            >
              Back to calibration
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={includedCount === 0 || isImporting}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isImporting ? "Importing..." : `Import ${includedCount} sites as drafts`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && importResult && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-green-700">
            Imported/updated {importResult.inserted} sites as drafts. Review
            and activate them from the Sites list, or fine-tune positions in
            the satellite capture tool.
          </p>
          {importResult.errors.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-red-600">
              {importResult.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "1. Upload" },
    { key: "review", label: "2. Review" },
    { key: "calibrate", label: "3. Calibrate" },
    { key: "preview", label: "4. Preview & import" },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="flex gap-2 text-xs">
      {steps.map((s, i) => (
        <span
          key={s.key}
          className={
            i <= activeIndex
              ? "rounded-full bg-neutral-900 px-2 py-1 text-white"
              : "rounded-full bg-neutral-100 px-2 py-1 text-neutral-500"
          }
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}

function CalibrationMapClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function CalibrationMap({
  centerLat,
  centerLng,
  defaultZoom,
  onPick,
}: {
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  onPick: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer center={[centerLat, centerLng]} zoom={defaultZoom} className="h-full w-full">
      <BasemapTileLayer />
      <CalibrationMapClickHandler onPick={onPick} />
    </MapContainer>
  );
}

function PreviewMap({
  centerLat,
  centerLng,
  defaultZoom,
  sites,
}: {
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  sites: ComputedSite[];
}) {
  return (
    <MapContainer center={[centerLat, centerLng]} zoom={defaultZoom} className="h-full w-full">
      <BasemapTileLayer />
      {sites
        .filter((s) => s.included)
        .map((site) => (
          <Marker key={site.id} position={[site.lat, site.lng]} icon={siteDivIcon("draft")} />
        ))}
    </MapContainer>
  );
}
