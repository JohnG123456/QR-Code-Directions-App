"use client";

import { useState, useTransition } from "react";
import type {
  DiagnosticsOutcome,
} from "@/app/(admin)/admin/(protected)/resorts/[resortId]/diagnostics/actions";

// The switch for recording what a visitor's phone saw during live
// directions.
//
// Deliberately blunt about what it does. This records people's positions
// as they drive through the resort, and the person turning it on should
// be reading that sentence rather than inferring it from the word
// "diagnostics".

export function DiagnosticsPanel({
  resortId,
  recording,
  rowCount,
  openUntil,
  setRecordDiagnostics,
  clearDiagnostics,
}: {
  resortId: string;
  recording: boolean;
  /** How much has been collected for this resort so far. */
  rowCount: number | null;
  /** The date after which the database stops accepting these, whatever
   *  this switch says. Null if the migration isn't applied. */
  openUntil: string | null;
  setRecordDiagnostics: (input: {
    resortId: string;
    on: boolean;
  }) => Promise<DiagnosticsOutcome>;
  clearDiagnostics: (input: { resortId: string }) => Promise<DiagnosticsOutcome>;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Which action is running, so each button can say what it is doing
  // rather than all of them going quiet together.
  const [busy, setBusy] = useState<"toggle" | "clear" | null>(null);

  function toggle() {
    setError(null);
    setBusy("toggle");
    startTransition(async () => {
      const result = await setRecordDiagnostics({ resortId, on: !recording });
      if (!result.ok) setError(result.error ?? "Couldn't change that.");
      setBusy(null);
    });
  }

  function clear() {
    setError(null);
    setBusy("clear");
    startTransition(async () => {
      const result = await clearDiagnostics({ resortId });
      if (!result.ok) setError(result.error ?? "Couldn't clear that.");
      setConfirmingClear(false);
      setBusy(null);
    });
  }

  return (
    <section className="rounded-lg border border-neutral-200 p-4">
      <h2 className="font-semibold text-neutral-900">Record live directions</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Records where a visitor&apos;s phone was, how accurate it said it
        was, and how far it fell from the route — so the wrong-turn
        thresholds can be set from what actually happens here rather than
        from general figures. Guests are shown nothing and asked nothing.
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        Leave it off unless someone is driving the resort to test it.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={isPending}
          className={
            recording
              ? "rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              : "rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-800 disabled:opacity-60"
          }
        >
          {busy === "toggle"
            ? recording
              ? "Stopping…"
              : "Starting…"
            : recording
              ? "Recording — tap to stop"
              : "Start recording"}
        </button>

        <span className="text-sm text-neutral-600">
          {rowCount === null
            ? "Not set up on this database yet."
            : `${rowCount.toLocaleString()} ${rowCount === 1 ? "row" : "rows"} held.`}
        </span>

        {rowCount !== null && rowCount > 0 && !confirmingClear && (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            disabled={isPending}
            className="ml-auto text-sm text-neutral-500 underline"
          >
            Delete them
          </button>
        )}
        {confirmingClear && (
          <span className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-neutral-700">Delete all {rowCount} rows?</span>
            <button
              type="button"
              onClick={clear}
              disabled={isPending}
              className="rounded border border-red-600 px-2 py-1 text-red-700 disabled:opacity-60"
            >
              {busy === "clear" ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              className="text-neutral-500 underline"
            >
              Keep
            </button>
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      {openUntil && (
        <p className="mt-3 text-[13px] leading-snug text-neutral-500">
          Stops by itself after{" "}
          {new Date(openUntil).toLocaleDateString("en-AU", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          , whatever this switch says — so it can&apos;t be left running
          over a resort full of guests by forgetting about it. Extending
          that needs a change to the database.
        </p>
      )}
    </section>
  );
}
