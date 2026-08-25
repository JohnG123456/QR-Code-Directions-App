"use client";

import type { ImportResult } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/sites/actions";

// Shown between asking to import and anything being written. The counts
// come from the same code path that does the write, run with dryRun, so
// what it promises is what happens.
//
// The number that matters is "moving": those homes are already placed, and
// re-importing puts them back where the plan says they are, undoing any
// position corrected by hand on the satellite imagery afterwards.
export function ImportConfirmation({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: ImportResult;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const adding = preview.adding ?? 0;
  const moving = preview.moving ?? 0;
  const skipped = preview.skipped ?? 0;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">
        Before importing, here is what this will do:
      </p>
      <ul className="list-disc pl-5 text-sm text-amber-900">
        <li>
          <strong>{adding}</strong> new {adding === 1 ? "home" : "homes"} added.
        </li>
        <li>
          <strong>{moving}</strong> already-placed{" "}
          {moving === 1 ? "home" : "homes"} moved back to where the plan puts{" "}
          {moving === 1 ? "it" : "them"}.
          {moving > 0 && (
            <>
              {" "}
              Any of these you have nudged into place on the satellite imagery
              will lose that correction.
            </>
          )}
        </li>
        {skipped > 0 && (
          <li>
            <strong>{skipped}</strong> {skipped === 1 ? "number" : "numbers"} you
            deleted before left out, so this import will not bring{" "}
            {skipped === 1 ? "it" : "them"} back.
          </li>
        )}
      </ul>
      {preview.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-amber-800">
          {preview.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Importing..." : "Import"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
