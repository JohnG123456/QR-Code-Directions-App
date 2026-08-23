"use client";

import { useState, useTransition } from "react";
import type { PublishOverlayOutcome } from "@/app/(admin)/admin/(protected)/resorts/[resortId]/plan-overlay/actions";

// Whether the master plan drawing is shown to visitors, and the state
// staff need to reason about it: is one published, when, and is the
// draft newer than what guests are actually seeing.

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatSize(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1000)} KB`;
}

export function PlanOverlayPanel({
  resortId,
  resortIsPublished,
  published,
  draftSavedAt,
  planIssue,
  publishPlanOverlay,
  unpublishPlanOverlay,
}: {
  resortId: string;
  resortIsPublished: boolean;
  published: { publishedAt: string; sourceFileName: string | null; bytes: number } | null;
  /** When the working copy of the plan last changed, so an overlay that
   *  has fallen behind can say so. */
  draftSavedAt: string | null;
  /** Why there's nothing publishable, when there isn't. */
  planIssue: "not-migrated" | "no-plan" | "not-calibrated" | null;
  publishPlanOverlay: (input: { resortId: string }) => Promise<PublishOverlayOutcome>;
  unpublishPlanOverlay: (input: { resortId: string }) => Promise<PublishOverlayOutcome>;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { kind: "ok"; message: string } | { kind: "error"; message: string } | null
  >(null);

  const stale =
    published !== null &&
    draftSavedAt !== null &&
    new Date(draftSavedAt).getTime() > new Date(published.publishedAt).getTime();

  function run(action: () => Promise<PublishOverlayOutcome>, successMessage: string) {
    setResult(null);
    startTransition(async () => {
      const outcome = await action();
      setResult(
        outcome.ok
          ? {
              kind: "ok",
              message: outcome.bytes
                ? `${successMessage} Visitors download ${formatSize(outcome.bytes)}.`
                : successMessage,
            }
          : { kind: "error", message: outcome.error ?? "That didn't work." }
      );
    });
  }

  return (
    <div className="flex max-w-md flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="text-sm font-semibold text-neutral-900">
        Master plan on the visitor page
      </h2>
      <p className="text-sm text-neutral-600">
        Shows the plan drawing over the satellite view, so a guest sees site
        numbers and street names instead of rows of identical roofs.
      </p>

      {planIssue === "not-migrated" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The database hasn&apos;t been updated for this yet. Run{" "}
          <code>0005_public_plan_overlay.sql</code> in Supabase, then reload
          this page.
        </p>
      )}
      {planIssue === "no-plan" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No master plan has been uploaded for this resort yet. Upload one under{" "}
          <strong>Import from master plan</strong> first.
        </p>
      )}
      {planIssue === "not-calibrated" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The uploaded plan hasn&apos;t been calibrated, so there&apos;s nothing
          to say where it sits on the map. Add at least two reference points
          under <strong>Import from master plan</strong>.
        </p>
      )}

      {published ? (
        <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
          <p>
            <strong>Published</strong> {formatWhen(published.publishedAt)}
            {published.sourceFileName ? ` from ${published.sourceFileName}` : ""}.
          </p>
          <p className="mt-1 text-neutral-600">
            Visitors download {formatSize(published.bytes)}.
          </p>
          {!resortIsPublished && (
            <p className="mt-1 text-neutral-600">
              The resort itself isn&apos;t published, so nobody can see it yet.
            </p>
          )}
        </div>
      ) : (
        planIssue === null && (
          <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
            Not published. Visitors see satellite imagery only.
          </p>
        )
      )}

      {stale && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The master plan has been edited since this was published. Visitors are
          still seeing the older version until you publish again.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending || planIssue !== null}
          onClick={() =>
            run(
              () => publishPlanOverlay({ resortId }),
              published ? "Updated what visitors see." : "The plan is now on the visitor page."
            )
          }
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {pending ? "Working…" : published ? "Publish again" : "Show plan to visitors"}
        </button>
        {published && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => unpublishPlanOverlay({ resortId }),
                "Removed. Visitors now see satellite imagery only."
              )
            }
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-800 disabled:opacity-40"
          >
            Remove from visitor page
          </button>
        )}
      </div>

      {result && (
        <p
          className={
            result.kind === "ok"
              ? "rounded-md bg-green-50 px-3 py-2 text-sm text-green-900"
              : "rounded-md bg-red-50 px-3 py-2 text-sm text-red-900"
          }
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
