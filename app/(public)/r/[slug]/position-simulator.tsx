"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveFix } from "@/lib/navigation/use-live-position";
import { gradeAccuracy, usableHeading } from "@/lib/navigation/live-route";
import {
  offsetSideways,
  pointAlongRoute,
  routeLengthM,
} from "@/lib/navigation/simulate-position";

// A pretend visitor, for testing live directions from a desk.
//
// Only ever rendered when NEXT_PUBLIC_POSITION_SIM is set, which is
// meant to be set on Vercel's Preview environment and nowhere else - see
// the README. It is loaded lazily from route-map.tsx so that a build
// without that variable ships none of it to a guest.
//
// It stands in for the receiver rather than for the navigation: the
// fixes it emits go through exactly the same thresholds, the same
// recompute decisions and the same server call as real ones. What it
// removes is the need to be driving through a resort to produce them.
//
// Fixes arrive once a second whether or not the car is moving, because
// that is what a real receiver does, and some of the behaviour worth
// testing - the re-ask after twenty seconds - only happens when time
// passes without movement.
const TICK_MS = 1000;

export function PositionSimulator({
  routePoints,
  onFix,
  running,
}: {
  /** The line to walk along: the route from the entrance, which stays
   *  put, rather than the live route, which is being recomputed. */
  routePoints: [number, number][];
  onFix: (fix: LiveFix | null) => void;
  /** Only ticks while the page is actually following, so the panel costs
   *  nothing until it is being used. */
  running: boolean;
}) {
  const [distanceM, setDistanceM] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedKmh, setSpeedKmh] = useState(20);
  const [accuracyM, setAccuracyM] = useState(8);
  const [offsetM, setOffsetM] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  const totalM = useMemo(() => routeLengthM(routePoints), [routePoints]);

  // Read inside the interval without restarting it on every keystroke:
  // re-creating the timer each render would reset the tick and make the
  // dot stutter. Written after each render rather than during one -
  // a render that React throws away must not leave anything behind.
  const settings = useRef({ playing, speedKmh, accuracyM, offsetM });
  const emit = useRef(onFix);
  useEffect(() => {
    settings.current = { playing, speedKmh, accuracyM, offsetM };
    emit.current = onFix;
  });

  // How far along the pretend visitor is, kept in a ref as well as in
  // state. The ref is what the ticker advances and reads; the state is
  // only so the slider and the readout can show it. Advancing state
  // alone would mean emitting a fix from inside a setState updater,
  // which has to be pure - React runs it twice in development, and the
  // page would get two fixes a tick.
  const distanceRef = useRef(0);

  useEffect(() => {
    if (!running) {
      emit.current(null);
      return;
    }

    const id = setInterval(() => {
      const { playing, speedKmh, accuracyM, offsetM } = settings.current;
      const metresPerTick = (speedKmh / 3.6) * (TICK_MS / 1000);

      const next = playing
        ? Math.min(totalM, distanceRef.current + metresPerTick)
        : distanceRef.current;
      distanceRef.current = next;
      setDistanceM(next);

      const point = pointAlongRoute(routePoints, next);
      if (!point) return;

      const speedMs = playing ? speedKmh / 3.6 : 0;
      emit.current({
        position: offsetSideways(point, offsetM),
        accuracyM,
        grade: gradeAccuracy(accuracyM),
        // Through the same check a real fix goes through, so a parked
        // car gets no heading here either.
        headingDeg: usableHeading(point.headingDeg, speedMs),
        speedMs,
        at: Date.now(),
      });
    }, TICK_MS);

    return () => clearInterval(id);
  }, [running, routePoints, totalM]);

  if (!running) return null;

  return (
    <div className="absolute inset-x-2 bottom-2 z-[1100] rounded-lg border-2 border-amber-500 bg-amber-50/95 p-2.5 text-[13px] text-amber-950 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="rounded bg-amber-600 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
          Test mode
        </span>
        <span className="font-medium">Simulated position</span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto rounded border border-amber-600 px-2 py-0.5 text-[12px]"
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      {!collapsed && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="rounded bg-amber-600 px-3 py-1 font-medium text-white"
            >
              {playing ? "Pause" : "Drive"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                distanceRef.current = 0;
                setDistanceM(0);
              }}
              className="rounded border border-amber-600 px-3 py-1"
            >
              Back to start
            </button>
            <span className="ml-auto tabular-nums">
              {Math.round(distanceM)} / {Math.round(totalM)} m
            </span>
          </div>

          <label className="flex flex-col gap-0.5">
            <span>Along the route</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.round(totalM))}
              value={Math.round(distanceM)}
              onChange={(e) => {
                distanceRef.current = Number(e.target.value);
                setDistanceM(distanceRef.current);
              }}
              className="w-full accent-amber-600"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label="Speed km/h"
              value={speedKmh}
              min={0}
              max={80}
              onChange={setSpeedKmh}
            />
            {/* Over 100 is the coarse gate, 25-100 the "accuracy is
                poor" notice, under 25 a clean fix. */}
            <NumberField
              label="Accuracy m"
              value={accuracyM}
              min={1}
              max={500}
              onChange={setAccuracyM}
            />
            {/* Past 30m for three ticks triggers a reroute. */}
            <NumberField
              label="Sideways m"
              value={offsetM}
              min={-120}
              max={120}
              onChange={setOffsetM}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[12px]">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
        className="w-full rounded border border-amber-400 bg-white px-1.5 py-1 tabular-nums"
      />
    </label>
  );
}
