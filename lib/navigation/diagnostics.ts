"use client";

import { createClient } from "@/lib/supabase/client";
import { OFF_ROUTE_M } from "./live-route";

// Recording what the receiver saw, so the thresholds can be tuned from
// evidence instead of from guesses.
//
// Silent by design - there is nothing for a visitor to see or agree to,
// which is exactly why the limits matter. It only runs where
// NEXT_PUBLIC_ROUTE_DIAGNOSTICS is set, the database refuses the writes
// after a fixed date regardless (see migration 0016), and nothing
// recorded identifies a person: no account, no device, no browser, no
// address. The session id is random per trip and joins to nothing.
//
// Buffered rather than written per fix. Fixes arrive about once a
// second, and a request each would be the same shape of mistake as a
// route request each - a lot of traffic to record that somebody moved
// three metres.

export const DIAGNOSTICS_ENABLED =
  process.env.NEXT_PUBLIC_ROUTE_DIAGNOSTICS === "1";

/** How often the buffer is emptied. */
const FLUSH_MS = 15000;

/** And how full it can get before it is emptied early, whatever the
 *  clock says. Comfortably under the 200 the database will accept. */
const FLUSH_AT_ROWS = 60;

export type DiagnosticEvent = "fix" | "reroute" | "unplaced" | "arrived";

export interface DiagnosticRow {
  /** ISO timestamp. */
  t: string;
  lat: number;
  lng: number;
  /** Accuracy in metres, as the receiver reported it. */
  acc: number | null;
  spd: number | null;
  hdg: number | null;
  /** Distance from the route on screen - the number the off-route
   *  decision turns on. */
  off: number | null;
  rem: number | null;
  fixes: number;
  ev: DiagnosticEvent;
}

export class DiagnosticsRecorder {
  private buffer: DiagnosticRow[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly resortId: string,
    private readonly siteId: string | null
  ) {}

  start() {
    if (!DIAGNOSTICS_ENABLED || this.timer !== null) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
  }

  add(row: DiagnosticRow) {
    if (!DIAGNOSTICS_ENABLED) return;
    this.buffer.push(row);
    if (this.buffer.length >= FLUSH_AT_ROWS) void this.flush();
  }

  /** Empties the buffer. Called on a timer, when it fills, and when the
   *  trip ends - the last one matters most, because the end of a drive
   *  is where the interesting rows are. */
  async flush() {
    if (!DIAGNOSTICS_ENABLED || this.buffer.length === 0) return;

    const rows = this.buffer;
    this.buffer = [];

    try {
      await createClient().rpc("record_route_diagnostics", {
        p_session_id: this.sessionId,
        p_resort_id: this.resortId,
        p_site_id: this.siteId,
        p_off_route_m: OFF_ROUTE_M,
        p_rows: rows,
      });
    } catch {
      // Dropped on the floor, deliberately. This is a recording of
      // someone's drive, not the drive itself; a visitor must never wait
      // on it, see an error from it, or lose directions because of it.
    }
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    void this.flush();
  }
}

/** A fresh id per trip. Identifies a journey so its fixes can be read in
 *  order, and nothing else - it is not stored anywhere on the device and
 *  does not survive a reload. */
export function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
