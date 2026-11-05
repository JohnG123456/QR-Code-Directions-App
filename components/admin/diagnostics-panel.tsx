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
  recordingUntil,
  sessions,
  rowCount,
  openUntil,
  setRecordDiagnostics,
  clearDiagnostics,
}: {
  resortId: string;
  recording: boolean;
  /** When the current session stops by itself (migration 0018). */
  recordingUntil: string | null;
  /** Whether the database runs recording in timed sessions (0018). */
  sessions: boolean;
  /** How much has been collected for this resort so far. */
  rowCount: number | null;
  /** The date after which the database stops accepting these, whatever
   *  this switch says. Null if the migration isn't applied. */
  openUntil: string | null;
  setRecordDiagnostics: (input: {
    resortId: string;
    on: boolean;
    hours?: number;
  }) => Promise<DiagnosticsOutcome>;
  clearDiagnostics: (input: { resortId: string }) => Promise<DiagnosticsOutcome>;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Which action is running, so each button can say what it is doing
  // rather than all of them going quiet together.
  const [busy, setBusy] = useState<"toggle" | "clear" | null>(null);
  // How long the next session runs. Short by default: it is meant for
  // one afternoon's test driving, and stops by itself either way.
  const [hours, setHours] = useState(4);

  function toggle() {
    setError(null);
    setBusy("toggle");
    startTransition(async () => {
      const result = await setRecordDiagnostics({
        resortId,
        on: !recording,
        ...(sessions && !recording ? { hours } : {}),
      });
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

        {sessions && !recording && (
          <label className="flex items-center gap-1.5 text-sm text-neutral-700">
            for
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              disabled={isPending}
              className="rounded border border-neutral-300 px-2 py-1.5"
            >
              {[1, 2, 4, 8, 12].map((h) => (
                <option key={h} value={h}>
                  {h} {h === 1 ? "hour" : "hours"}
                </option>
              ))}
            </select>
          </label>
        )}

        {recording && recordingUntil && (
          <span className="text-sm font-medium text-amber-800">
            Stops by itself at {formatUntil(recordingUntil)}
          </span>
        )}

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

      {sessions && (
        <p className="mt-3 text-[13px] leading-snug text-neutral-500">
          Each recording stops by itself at the end of the time you pick (12
          hours at most), so it can&apos;t be left running over a resort full
          of guests by forgetting about it. Recordings older than 30 days are
          deleted automatically.
        </p>
      )}

      {!sessions && openUntil && (
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

/** "2:30 pm", or "Tue 2:30 pm" when it isn't today. Pinned to Perth
 *  time: the panel is first drawn on the server, which runs in UTC, and
 *  every resort this serves is in WA. */
function formatUntil(iso: string): string {
  const zone = "Australia/Perth";
  const when = new Date(iso);
  const day = (d: Date) => d.toLocaleDateString("en-AU", { timeZone: zone });
  const time = when.toLocaleTimeString("en-AU", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  });
  return day(when) === day(new Date())
    ? time
    : `${when.toLocaleDateString("en-AU", { timeZone: zone, weekday: "short" })} ${time}`;
}
