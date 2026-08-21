"use client";

import { useState } from "react";
import type { ActionState } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/sites/actions";

// Renders the site-number and label cells of a row, switching between
// display and edit mode. Returns a fragment of two <td>s so it can drop
// straight into the existing table row.
export function SiteDetailCells({
  siteId,
  resortId,
  siteNumber,
  label,
  updateSiteDetails,
}: {
  siteId: string;
  resortId: string;
  siteNumber: string;
  label: string | null;
  updateSiteDetails: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [editing, setEditing] = useState(false);
  const [numberValue, setNumberValue] = useState(siteNumber);
  const [labelValue, setLabelValue] = useState(label ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    setIsSaving(true);
    setError(null);

    const formData = new FormData();
    formData.set("siteId", siteId);
    formData.set("resortId", resortId);
    formData.set("siteNumber", numberValue);
    formData.set("label", labelValue);

    const result = await updateSiteDetails({}, formData);
    setIsSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    setEditing(false);
  }

  function cancel() {
    setNumberValue(siteNumber);
    setLabelValue(label ?? "");
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <>
        <td className="py-2 font-medium">
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit site number and label"
            className="underline decoration-dotted underline-offset-2 hover:text-neutral-600"
          >
            {siteNumber}
          </button>
        </td>
        <td className="py-2">{label ?? "—"}</td>
      </>
    );
  }

  return (
    <>
      <td className="py-2 align-top">
        <input
          autoFocus
          value={numberValue}
          onChange={(e) => setNumberValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          className="w-20 rounded border border-neutral-300 px-1 py-0.5 text-sm"
        />
      </td>
      <td className="py-2 align-top">
        <div className="flex flex-wrap items-center gap-1">
          <input
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            placeholder="Label (optional)"
            className="w-32 rounded border border-neutral-300 px-1 py-0.5 text-sm"
          />
          <button
            type="button"
            onClick={save}
            disabled={isSaving || !numberValue.trim()}
            className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={cancel}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </>
  );
}
