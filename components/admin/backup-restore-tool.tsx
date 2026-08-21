"use client";

import { useState } from "react";
import type { RestoreResult } from "@/app/(admin)/admin/(protected)/backup/actions";

// Restoring is rare and consequential, so the flow is: pick the file,
// see what's in it, then confirm. Nothing is written until the second
// click.
export function BackupRestoreTool({
  restoreBackup,
}: {
  restoreBackup: (fileText: string) => Promise<RestoreResult>;
}) {
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);

  async function handleFile(file: File) {
    setResult(null);
    setReadError(null);
    setFileName(file.name);
    const text = await file.text();

    // Just enough of a peek to show what's about to happen - the real
    // validation runs on the server when Restore is clicked.
    try {
      const parsed = JSON.parse(text) as { resorts?: unknown[]; sites?: unknown[] };
      setFileText(text);
      setSummary(
        `${parsed.resorts?.length ?? 0} resorts and ${parsed.sites?.length ?? 0} sites`
      );
    } catch {
      setFileText(null);
      setSummary(null);
      setReadError("That file isn't valid JSON. Use the .json backup, not a CSV.");
    }
  }

  async function handleRestore() {
    if (!fileText) return;
    setIsRestoring(true);
    setResult(await restoreBackup(fileText));
    setIsRestoring(false);
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <div>
        <h2 className="text-sm font-semibold">Restore from a backup</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Adds everything in the file back. Resorts are matched by their
          address (slug) and sites by their number, so this merges with
          what&apos;s already here and never deletes anything — but it does
          overwrite a site&apos;s position with the one in the file.
        </p>
      </div>

      {/* Hidden input driven by the label: a native file control has a wide
          intrinsic size that won't shrink below a phone screen. */}
      <label className="inline-flex w-fit cursor-pointer items-center rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50">
        Choose backup file
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="sr-only"
        />
      </label>

      {fileName && <p className="break-all text-xs text-neutral-500">{fileName}</p>}
      {readError && <p className="text-sm text-red-600">{readError}</p>}

      {fileText && summary && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-700">This file contains {summary}.</p>
          <button
            type="button"
            onClick={handleRestore}
            disabled={isRestoring}
            className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isRestoring ? "Restoring..." : "Restore this backup"}
          </button>
        </div>
      )}

      {result && (
        <div className="text-sm">
          {result.sites > 0 || result.resorts > 0 ? (
            <p className="text-green-700">
              Restored {result.resorts} resorts and {result.sites} sites.
            </p>
          ) : (
            <p className="text-red-700">Nothing was restored.</p>
          )}
          {result.skippedSites > 0 && (
            <p className="mt-1 text-amber-700">
              {result.skippedSites} sites in the file had no coordinates and
              were skipped.
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-600">
              {result.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
