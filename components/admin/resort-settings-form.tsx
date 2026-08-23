"use client";

import { useActionState, useState } from "react";
import { CenterPicker } from "@/components/map/center-picker";
import { NameSlugFields } from "@/components/admin/name-slug-fields";
import type { ResortSaveState } from "@/app/(admin)/admin/(protected)/resorts/actions";

interface ResortSettingsFormProps {
  resortId: string;
  defaultName: string;
  defaultSlug: string;
  defaultIsPublished: boolean;
  defaultZoom: number;
  totalHomes: number | null;
  centerLat: number | null;
  centerLng: number | null;
  updateResort: (
    prevState: ResortSaveState,
    formData: FormData
  ) => Promise<ResortSaveState>;
  siteCount: number;
  deleteResort: (formData: FormData) => void;
}

export function ResortSettingsForm({
  resortId,
  defaultName,
  defaultSlug,
  defaultIsPublished,
  defaultZoom,
  totalHomes,
  centerLat,
  centerLng,
  updateResort,
  deleteResort,
  siteCount,
}: ResortSettingsFormProps) {
  const [saveState, saveAction, isSaving] = useActionState<ResortSaveState, FormData>(
    updateResort,
    {}
  );

  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    centerLat !== null && centerLng !== null
      ? { lat: centerLat, lng: centerLng }
      : null
  );

  return (
    <div className="flex flex-col gap-8">
      <form action={saveAction} className="flex max-w-md flex-col gap-3">
        <input type="hidden" name="resortId" value={resortId} />
        <NameSlugFields defaultName={defaultName} defaultSlug={defaultSlug} />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isPublished"
            defaultChecked={defaultIsPublished}
          />
          Published (visible at /r/{defaultSlug})
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Default map zoom
          <input
            type="number"
            name="defaultZoom"
            min={1}
            max={22}
            defaultValue={defaultZoom}
            className="w-24 rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Total homes (optional, for capture progress)
          <input
            type="number"
            name="totalHomes"
            min={1}
            max={5000}
            defaultValue={totalHomes ?? ""}
            placeholder="e.g. 352"
            className="w-24 rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>

        <input type="hidden" name="centerLat" value={center?.lat ?? ""} />
        <input type="hidden" name="centerLng" value={center?.lng ?? ""} />
        <CenterPicker
          initialLat={centerLat}
          initialLng={centerLng}
          onChange={(lat, lng) => setCenter({ lat, lng })}
        />
        {center && (
          <p className="text-xs text-neutral-500">
            {center.lat.toFixed(6)}, {center.lng.toFixed(6)}
          </p>
        )}

        <button
          type="submit"
          disabled={isSaving}
          className="mt-1 w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save changes"}
        </button>

        {/* Saving used to leave the screen looking identical, so there was
            no way to tell a successful save from a tap that missed. The
            confirmation says what the save actually did - publishing a
            resort is the moment it becomes visible to guests, and that
            deserves to be stated rather than inferred. */}
        {saveState.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {saveState.error}
          </p>
        )}
        {saveState.savedAt && !saveState.error && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
            <strong>Saved.</strong>{" "}
            {saveState.published
              ? `This resort is published — guests scanning the QR code will reach it at /r/${defaultSlug}.`
              : "This resort is not published, so guests scanning the QR code will get “not found”."}
          </p>
        )}
      </form>

      <form
        action={deleteResort}
        className="w-fit"
        onSubmit={(e) => {
          const stake =
            siteCount === 1 ? "1 captured site" : `all ${siteCount} captured sites`;
          if (
            !confirm(
              `Delete "${defaultName}" and ${stake}? This cannot be undone, and the QR code for this resort will stop working.`
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="resortId" value={resortId} />
        <button
          type="submit"
          className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
        >
          Delete resort
        </button>
      </form>
    </div>
  );
}
