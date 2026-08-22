"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, useMapEvents } from "react-leaflet";
import type { ExtractedPlan, ExtractedLabel } from "@/lib/masterplan/extract-labels-server";
import { fitPlanToWorldTransform, type PointPair } from "@/lib/geo/similarity-transform";
import { toLocalMeters, fromLocalMeters } from "@/lib/geo/local-projection";
import { siteDivIcon } from "@/lib/map/site-icon";
import { ZoomablePlan } from "@/components/admin/masterplan/zoomable-plan";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  describeSavedAt,
  type MasterplanDraft,
} from "@/lib/masterplan/draft-store";
import {
  saveMasterplanDraft,
  loadMasterplanDraft,
  loadMasterplanDraftSummary,
  clearMasterplanDraft,
} from "@/app/(admin)/admin/(protected)/resorts/[resortId]/import-masterplan/actions";
import { BasemapTileLayer } from "@/components/map/basemap-tile-layer";
import type { ImportResult } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/sites/actions";
import "leaflet/dist/leaflet.css";

type Step = "upload" | "review" | "calibrate" | "preview" | "done";

// What the "pick up where I left off" banner needs. The local (IndexedDB)
// draft always carries its image; the remote one describes itself without
// it and fetches it only if the draft is actually resumed - it's a couple
// of MB, and most visits to this page are to start something new.
type DraftPreview = Omit<MasterplanDraft, "imageDataUrl"> & {
  imageDataUrl?: string;
};

interface ComputedSite {
  id: string;
  siteNumber: string;
  lat: number;
  lng: number;
  included: boolean;
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
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  // Off by default: at fit-to-width zoom on a phone the numbers overlap
  // into an unreadable band across the drawing. Zoom in first, then turn
  // them on to check specific ones.
  const [showNumbers, setShowNumbers] = useState(false);

  const [pairs, setPairs] = useState<PointPair[]>([]);
  const [pendingPlanPoint, setPendingPlanPoint] = useState<{ x: number; y: number } | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  const [computedSites, setComputedSites] = useState<ComputedSite[]>([]);
  const [fitStats, setFitStats] = useState<{
    rms: number;
    max: number;
    pointCount: number;
    residuals: number[];
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileNameRef = useRef<string | null>(null);
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [foundDraft, setFoundDraft] = useState<DraftPreview | null>(null);
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [lastImportedAt, setLastImportedAt] = useState<number | null>(null);
  // Tracked separately: a draft saved to the account but not to this
  // browser is still safe, and saying "nothing is being saved" then would
  // be wrong. Only losing both is worth a red warning.
  const [localSaveFailed, setLocalSaveFailed] = useState(false);
  const [remoteSaveFailed, setRemoteSaveFailed] = useState(false);
  const [remoteSaveError, setRemoteSaveError] = useState<string | null>(null);
  // True when this browser has a draft and the account has none - the
  // state someone lands in if they reviewed a plan before drafts were
  // kept on the server, or if the upload that should have created the
  // server copy failed.
  const [localDraft, setLocalDraft] = useState<MasterplanDraft | null>(null);
  const [accountDraftSavedAt, setAccountDraftSavedAt] = useState<number | null>(null);
  const [uploadingToAccount, setUploadingToAccount] = useState(false);

  // Offer to pick up an unfinished review from a previous sitting - from
  // this browser or from the account, whichever was saved more recently.
  // The remote copy is what makes "carry on from a different device" and
  // "carry on after clearing the browser" work at all.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadDraft(resortId),
      loadMasterplanDraftSummary(resortId).catch(() => null),
    ]).then(([local, remote]) => {
      if (cancelled) return;
      const newest = [local, remote]
        .filter((d): d is DraftPreview => d !== null)
        .sort((a, b) => b.savedAt - a.savedAt)[0];
      if (newest) setFoundDraft(newest);
      setLocalDraft(local);
      setAccountDraftSavedAt(remote?.savedAt ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [resortId]);

  // Autosave whatever's on screen to both copies, debounced so dragging a
  // marker around doesn't hammer IndexedDB or the network. The remote
  // save carries no image - the extract route already stored that.
  useEffect(() => {
    if (!plan || step === "done") return;
    const timer = setTimeout(() => {
      const savedAt = Date.now();
      saveDraft({
        resortId,
        fileName: fileNameRef.current,
        savedAt,
        step,
        imageDataUrl: plan.imageDataUrl,
        imageWidth: plan.imageWidth,
        imageHeight: plan.imageHeight,
        labels,
        pairs,
        lastImportedAt: lastImportedAt ?? undefined,
      }).then((ok) => {
        setLocalSaveFailed(!ok);
        if (ok) setDraftSavedAt(savedAt);
      });

      saveMasterplanDraft({
        resortId,
        fileName: fileNameRef.current,
        step,
        labels,
        pairs,
        lastImportedAt,
      })
        .then((outcome) => {
          setRemoteSaveFailed(!outcome.ok);
          setRemoteSaveError(outcome.error ?? null);
          if (outcome.ok) setDraftSavedAt(savedAt);
        })
        .catch((err) => {
          setRemoteSaveFailed(true);
          setRemoteSaveError(err instanceof Error ? err.message : null);
        });
    }, 1200);
    return () => clearTimeout(timer);
  }, [resortId, plan, labels, pairs, step, lastImportedAt]);

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
  const selectedLabel = labels.find((l) => l.id === selectedLabelId) ?? null;

  // Sends the draft as it stands to the account, image and all. The
  // alternative on offer was re-uploading the PDF, which re-scans the
  // sheet and discards the reviewed numbers and calibration - the very
  // work worth protecting.
  async function saveDraftToAccount(draft: {
    fileName: string | null;
    step: string;
    imageDataUrl: string;
    imageWidth: number;
    imageHeight: number;
    labels: ExtractedLabel[];
    pairs: PointPair[];
    lastImportedAt?: number | null;
  }) {
    setUploadingToAccount(true);
    setRemoteSaveError(null);
    try {
      const response = await fetch(`/api/resorts/${resortId}/masterplan/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: draft.fileName,
          step: draft.step,
          imageDataUrl: draft.imageDataUrl,
          imageWidth: draft.imageWidth,
          imageHeight: draft.imageHeight,
          labels: draft.labels,
          pairs: draft.pairs,
          lastImportedAt: draft.lastImportedAt ?? null,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setRemoteSaveError(result.error ?? "That didn't save to your account.");
        setRemoteSaveFailed(true);
        return false;
      }
      setAccountDraftSavedAt(Date.now());
      setRemoteSaveFailed(false);
      setDraftSavedAt(Date.now());
      return true;
    } catch {
      setRemoteSaveError("Couldn't reach the server.");
      setRemoteSaveFailed(true);
      return false;
    } finally {
      setUploadingToAccount(false);
    }
  }

  async function resumeDraft() {
    if (!foundDraft) return;
    setResumeError(null);

    // The remote draft describes itself without its image; fetch it now.
    let imageDataUrl = foundDraft.imageDataUrl;
    if (!imageDataUrl) {
      setIsResuming(true);
      try {
        const full = await loadMasterplanDraft(resortId);
        imageDataUrl = full?.imageDataUrl;
      } catch {
        imageDataUrl = undefined;
      } finally {
        setIsResuming(false);
      }
    }
    if (!imageDataUrl) {
      setResumeError(
        "Couldn't load the saved plan image. Check your connection and try again."
      );
      return;
    }

    fileNameRef.current = foundDraft.fileName;
    setPlan({
      imageDataUrl,
      imageWidth: foundDraft.imageWidth,
      imageHeight: foundDraft.imageHeight,
      labels: foundDraft.labels,
    });
    setLabels(foundDraft.labels);
    setPairs(foundDraft.pairs);
    setDraftSavedAt(foundDraft.savedAt);
    setLastImportedAt(foundDraft.lastImportedAt ?? null);
    setStep(foundDraft.step === "done" ? "review" : (foundDraft.step as Step));
    setFoundDraft(null);
  }

  async function discardDraft() {
    await Promise.all([
      clearDraft(resortId),
      clearMasterplanDraft(resortId).catch(() => undefined),
    ]);
    setFoundDraft(null);
    setDraftSavedAt(null);
  }

  async function handleFileSelected(file: File) {
    // Uploading replaces the saved draft outright - the site-number
    // positions belong to the sheet they were placed on. Hours of review
    // shouldn't go on a mis-tap, so confirm first when there's something
    // to lose.
    if (foundDraft || plan) {
      // Name the way out. Being told the plan isn't in your account and
      // then being warned that the only visible route to fix it destroys
      // your review is a dead end - the button above does it without
      // touching anything.
      const confirmed = window.confirm(
        "This replaces the saved review for this resort with a fresh scan of the new PDF. Your reviewed site numbers and calibration points will be lost.\n\nIf you only want the plan saved to your account, cancel and use \"Save this draft to my account\" instead - that keeps everything.\n\nContinue?"
      );
      if (!confirmed) {
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    }

    fileNameRef.current = file.name;
    setPickedFileName(file.name);
    setFoundDraft(null);
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
      setPairs([]);
      setLastImportedAt(null);
      setRemoteSaveFailed(result.draftSaved === false);
      setRemoteSaveError(result.draftError ?? null);
      setStep("review");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't read that PDF.");
    } finally {
      setIsParsing(false);
    }
  }

  function handleReviewImageClick(point: { x: number; y: number }) {
    if (!plan) return;
    // Tapping an existing marker selects it (handled by the marker's own
    // click handler); tapping bare drawing starts a new label here.
    setPendingNewLabel(point);
    setSelectedLabelId(null);
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

  function handleCalibratePlanClick(point: { x: number; y: number }) {
    if (!plan) return;
    setPendingPlanPoint(point);
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
      const fit = fitPlanToWorldTransform(pairs);
      setFitStats({
        rms: fit.rmsErrorMeters,
        max: fit.maxErrorMeters,
        pointCount: pairs.length,
        residuals: fit.residualsMeters,
      });

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

    // Deliberately keep the draft. A first import is usually partial - a
    // test run, or one stage of a resort - and the reviewed site numbers
    // and calibration are exactly what's needed to carry on afterwards.
    // Discarding them here meant coming back to nothing and starting over.
    if (result.inserted > 0 && plan) {
      const importedAt = Date.now();
      setLastImportedAt(importedAt);
      const [localOk, remoteOk] = await Promise.all([
        saveDraft({
          resortId,
          fileName: fileNameRef.current,
          savedAt: importedAt,
          lastImportedAt: importedAt,
          // Land back on the review step, where further numbers get added.
          step: "review",
          imageDataUrl: plan.imageDataUrl,
          imageWidth: plan.imageWidth,
          imageHeight: plan.imageHeight,
          labels,
          pairs,
        }),
        saveMasterplanDraft({
          resortId,
          fileName: fileNameRef.current,
          step: "review",
          labels,
          pairs,
          lastImportedAt: importedAt,
        }).catch((err) => ({
          ok: false,
          error: err instanceof Error ? err.message : undefined,
        })),
      ]);
      setLocalSaveFailed(!localOk);
      setRemoteSaveFailed(!remoteOk.ok);
      setRemoteSaveError(remoteOk.error ?? null);
    }
  }

  const includedCount = computedSites.filter((s) => s.included).length;

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator step={step} onGoToStep={plan ? setStep : undefined} />

      {plan && localSaveFailed && remoteSaveFailed && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Progress is not being saved.</strong> Neither this browser
          nor your account is accepting the draft. Finish and import in this
          sitting, or your review will be lost when you close the page.
          {remoteSaveError ? ` The server said: ${remoteSaveError}` : ""}
        </p>
      )}

      {plan && remoteSaveFailed && !localSaveFailed && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Saved on this device only.</strong> This draft isn&apos;t
          reaching your account, so it won&apos;t be there on another device -
          and the master plan won&apos;t be available as an overlay on the
          capture map or the road network.
          {remoteSaveError ? (
            <>
              {" "}
              The server said: <em>{remoteSaveError}</em>
            </>
          ) : (
            " No reason was given, which usually means the request never got through."
          )}
        </p>
      )}

      {plan && remoteSaveFailed && (
        <button
          type="button"
          disabled={uploadingToAccount}
          onClick={() =>
            void saveDraftToAccount({
              fileName: fileNameRef.current,
              step,
              imageDataUrl: plan.imageDataUrl,
              imageWidth: plan.imageWidth,
              imageHeight: plan.imageHeight,
              labels,
              pairs,
              lastImportedAt,
            })
          }
          className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {uploadingToAccount ? "Saving…" : "Save this draft to my account now"}
        </button>
      )}

      {plan && !remoteSaveFailed && draftSavedAt && step !== "done" && (
        <p className="text-xs text-neutral-500">
          Progress saved to your account {describeSavedAt(draftSavedAt)} — you
          can close this and pick it up later, on this or another device.
        </p>
      )}

      {step === "upload" && foundDraft && (
        <div className="flex flex-col gap-3 rounded-md border border-blue-300 bg-blue-50 p-4">
          <div>
            <p className="text-sm font-medium text-blue-900">
              Unfinished import found
            </p>
            {/* break-all, not break-words: overflow-wrap:break-word wraps
                visually but does NOT reduce the element's min-content
                width, so a long unbroken filename still forces the whole
                page wider than a phone screen. word-break:break-all does
                shrink it. */}
            <p className="mt-1 break-all text-sm text-blue-900">
              {foundDraft.labels.length} site numbers
              {foundDraft.pairs.length > 0 &&
                `, ${foundDraft.pairs.length} reference point${foundDraft.pairs.length === 1 ? "" : "s"}`}
              , saved {describeSavedAt(foundDraft.savedAt)}
              {foundDraft.fileName ? ` from ${foundDraft.fileName}` : ""}.
              {foundDraft.lastImportedAt
                ? ` Already imported ${describeSavedAt(foundDraft.lastImportedAt)} — pick up to add more or re-import.`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resumeDraft}
              disabled={isResuming}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isResuming ? "Loading..." : "Pick up where I left off"}
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm"
            >
              Discard and start fresh
            </button>
          </div>
          {resumeError && <p className="text-sm text-red-700">{resumeError}</p>}

          <p className="text-xs text-blue-800">
            {accountDraftSavedAt === null
              ? "Held on this device only — not in your account."
              : `Also in your account, saved ${describeSavedAt(accountDraftSavedAt)}.`}
          </p>

          {/* Offered whenever this device holds work the account doesn't
              have yet, not only when the account has nothing at all: a
              stale account copy is just as stuck, and re-uploading the
              PDF - the only other route - destroys the review. */}
          {localDraft && (accountDraftSavedAt === null || localDraft.savedAt > accountDraftSavedAt) && (
            <div className="flex flex-col gap-2 rounded-md bg-white/70 p-3">
              <p className="text-sm text-blue-900">
                {accountDraftSavedAt === null
                  ? "This draft is only on this device."
                  : "This device has newer work than your account copy."}{" "}
                Saving it to your account keeps it if this browser is cleared,
                makes it available on your other devices, and lets the plan be
                shown over the satellite map and the road network.{" "}
                <strong>
                  This does not re-scan the PDF — nothing you&apos;ve reviewed
                  is lost.
                </strong>
              </p>
              <button
                type="button"
                disabled={uploadingToAccount}
                onClick={() =>
                  void saveDraftToAccount({
                    fileName: localDraft.fileName,
                    step: localDraft.step,
                    imageDataUrl: localDraft.imageDataUrl,
                    imageWidth: localDraft.imageWidth,
                    imageHeight: localDraft.imageHeight,
                    labels: localDraft.labels,
                    pairs: localDraft.pairs,
                    lastImportedAt: localDraft.lastImportedAt,
                  })
                }
                className="w-fit rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {uploadingToAccount ? "Saving…" : "Save this draft to my account"}
              </button>
              {remoteSaveError && (
                <p className="text-sm text-red-700">{remoteSaveError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {step === "upload" && (
        <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
          <p className="text-sm text-neutral-600">
            Upload the resort&apos;s master plan PDF. It&apos;ll be scanned for
            site numbers, which you&apos;ll then review and calibrate against
            the satellite map.
          </p>
          {/* The native file input is visually hidden and driven by this
              label: rendered normally its control has a wide intrinsic
              size that refuses to shrink, which pushed the whole upload
              step wider than a phone screen. sr-only takes it out of flow
              so it can't affect layout at all. */}
          <label className="inline-flex w-fit cursor-pointer items-center rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50">
            Choose PDF
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
              className="sr-only"
            />
          </label>
          {pickedFileName && (
            <p className="break-all text-xs text-neutral-500">{pickedFileName}</p>
          )}
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
              Zoom in and tap a dot to check or remove a false positive (dates,
              scale bars and project numbers sometimes get picked up); tap a
              blank spot to add one that was missed.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                checked={showNumbers}
                onChange={(e) => setShowNumbers(e.target.checked)}
              />
              Show numbers
            </label>
            <span className="text-xs text-neutral-500">
              Pinch or scroll to zoom, drag to pan. Zoom in before turning
              numbers on.
            </span>
          </div>

          <ZoomablePlan
            imageUrl={plan.imageDataUrl}
            imageWidth={plan.imageWidth}
            imageHeight={plan.imageHeight}
            onPointClick={handleReviewImageClick}
            renderOverlay={(toScreen) => (
              <>
                {labels.map((label) => {
                  const p = toScreen(label);
                  const isSelected = selectedLabelId === label.id;
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLabelId(isSelected ? null : label.id);
                        setPendingNewLabel(null);
                      }}
                      title={`Site ${label.text}`}
                      className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
                      style={{ left: p.x, top: p.y }}
                    >
                      <span
                        className={
                          isSelected
                            ? "block h-3.5 w-3.5 rounded-full border-2 border-white bg-red-600 shadow"
                            : "block h-2 w-2 rounded-full border border-white/90 bg-blue-600/70"
                        }
                      />
                      {showNumbers && (
                        <span className="whitespace-nowrap rounded bg-white/85 px-0.5 text-[9px] font-medium leading-tight text-blue-900">
                          {label.text}
                        </span>
                      )}
                    </button>
                  );
                })}

                {selectedLabel && (
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute z-10 -translate-x-1/2 translate-y-2 rounded-md border border-neutral-300 bg-white p-2 shadow-lg"
                    style={{ left: toScreen(selectedLabel).x, top: toScreen(selectedLabel).y }}
                  >
                    <p className="mb-1 text-xs font-medium">Site {selectedLabel.text}</p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          removeLabel(selectedLabel.id);
                          setSelectedLabelId(null);
                        }}
                        className="rounded bg-red-600 px-2 py-0.5 text-xs text-white"
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedLabelId(null)}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
                      >
                        Keep
                      </button>
                    </div>
                  </div>
                )}

                {pendingNewLabel && (
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute z-10 -translate-x-1/2 translate-y-2 rounded-md border border-neutral-300 bg-white p-2 shadow-lg"
                    style={{
                      left: toScreen(pendingNewLabel).x,
                      top: toScreen(pendingNewLabel).y,
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        inputMode="numeric"
                        value={newLabelText}
                        onChange={(e) => setNewLabelText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && confirmNewLabel()}
                        placeholder="Site #"
                        className="w-16 rounded border border-neutral-300 px-1 py-0.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={confirmNewLabel}
                        className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingNewLabel(null)}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          />
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
              <ZoomablePlan
                imageUrl={plan.imageDataUrl}
                imageWidth={plan.imageWidth}
                imageHeight={plan.imageHeight}
                className="relative h-80 w-full touch-none overflow-hidden rounded-md border border-neutral-300 bg-neutral-100"
                onPointClick={handleCalibratePlanClick}
                renderOverlay={(toScreen) => (
                  <>
                    {pairs.map((pair, i) => {
                      const p = toScreen(pair.plan);
                      return (
                        <div
                          key={i}
                          className="pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white"
                          style={{ left: p.x, top: p.y }}
                        >
                          {i + 1}
                        </div>
                      );
                    })}
                    {pendingPlanPoint && (
                      <div
                        className="pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white"
                        style={{
                          left: toScreen(pendingPlanPoint).x,
                          top: toScreen(pendingPlanPoint).y,
                        }}
                      >
                        ?
                      </div>
                    )}
                  </>
                )}
              />
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

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep("review")}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
            >
              Back to site numbers
            </button>
            <button
              type="button"
              onClick={computePreview}
              disabled={pairs.length < 2}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Compute positions ({pairs.length} reference point{pairs.length === 1 ? "" : "s"})
            </button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="flex flex-col gap-3">
          {fitStats &&
            (fitStats.pointCount < 3 ? (
              // With 2 points the fit is exact by construction - there are
              // exactly as many equations as unknowns - so reporting "0.0 m
              // error" would look like a perfect calibration while actually
              // measuring nothing. Say so plainly instead.
              <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
                With only 2 reference points the fit always lands both
                exactly, so there&apos;s no error figure to report and no way
                to tell if a point was misplaced. Check the pins below against
                the imagery — and if anything looks off, go back and add a
                third point far from the other two.
              </p>
            ) : (
              <p className="text-sm text-neutral-600">
                Calibration fit across {fitStats.pointCount} reference points:
                average error <strong>{fitStats.rms.toFixed(1)} m</strong>,
                worst point <strong>{fitStats.max.toFixed(1)} m</strong>{" "}
                (point {fitStats.residuals.indexOf(fitStats.max) + 1}).{" "}
                {fitStats.rms > 5 && (
                  <span className="text-amber-600">
                    That&apos;s a loose fit — the worst point is the one most
                    likely misplaced, so go back and re-pick it.
                  </span>
                )}
              </p>
            ))}
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
          {importResult.inserted > 0 ? (
            <>
              <p className="text-sm text-green-700">
                Imported/updated {importResult.inserted} sites as drafts.
              </p>
              <p className="text-sm text-neutral-700">
                <strong>The import is done — carry on in the satellite
                capture tool.</strong> That&apos;s where numbers get corrected,
                pins moved, missing ones added and phantoms deleted, with the
                master plan laid over the imagery. There is no need to come
                back here unless the plan itself is revised.
              </p>
              <p className="text-sm text-neutral-600">
                Your reviewed site numbers and calibration are still saved on
                this device, so you can come back to this screen to add more
                numbers and import again without starting over.
              </p>
            </>
          ) : (
            <p className="text-sm text-red-700">
              Nothing was imported. Your reviewed site numbers and calibration
              are still saved on this device, so you can fix the problem below
              and try again.
            </p>
          )}
          {importResult.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-amber-700">
              {importResult.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}
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

// Steps already passed are clickable so a step can be revisited - it's
// easy to advance before finishing the site-number review, and without
// this the only way back was to re-upload and start over.
function StepIndicator({
  step,
  onGoToStep,
}: {
  step: Step;
  onGoToStep?: (step: Step) => void;
}) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "1. Upload" },
    { key: "review", label: "2. Review" },
    { key: "calibrate", label: "3. Calibrate" },
    { key: "preview", label: "4. Preview & import" },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {steps.map((s, i) => {
        const isDone = i <= activeIndex;
        const canGoBack = Boolean(onGoToStep) && i < activeIndex && s.key !== "upload";
        const className = isDone
          ? "rounded-full bg-neutral-900 px-2 py-1 text-white"
          : "rounded-full bg-neutral-100 px-2 py-1 text-neutral-500";

        return canGoBack ? (
          <button
            key={s.key}
            type="button"
            onClick={() => onGoToStep!(s.key)}
            className={`${className} underline underline-offset-2`}
          >
            {s.label}
          </button>
        ) : (
          <span key={s.key} className={className}>
            {s.label}
          </span>
        );
      })}
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
